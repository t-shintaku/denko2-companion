/**
 * アプリ内出題のドメイン。**採点結果が準備度と復習へ正しく流れること**を守る。
 */
import { describe, expect, it } from 'vitest';
import {
  IN_APP_SOURCE,
  grade,
  isCorrect,
  pickMistakes,
  pickWeakTopic,
  toAttemptInput,
} from '../src/domain/quiz';
import { reviewQueue, topicStats } from '../src/domain/academic';
import { questions, topicIds } from '../src/data';
import type { QuestionAttempt, QuizQuestion } from '../src/domain/types';

const q = (id: string, topicId: QuizQuestion['topicId']): QuizQuestion => ({
  id,
  lessonId: 'p0-l2',
  topicId,
  sourceResourceId: 'gami-start',
  sourceWatch: 'テスト',
  stem: `${id} の問題`,
  choices: ['ア', 'イ', 'ウ', 'エ'],
  answerIndex: 0,
  explanation: '解説',
  origin: 'original',
  syllabusIds: ['bt-ohm'],
});

const attempt = (over: Partial<QuestionAttempt>): QuestionAttempt => ({
  id: `a-${Math.random()}`,
  attemptedAt: '2026-09-01T10:00:00+09:00',
  jstDate: '2026-09-01',
  source: IN_APP_SOURCE,
  questionRef: 'q-1',
  topicId: 'basic-theory',
  correct: true,
  confidence: 3,
  scored: true,
  updatedAt: '2026-09-01T10:00:00+09:00',
  ...over,
});

describe('採点', () => {
  it('選んだ番号が正解番号と一致したときだけ正解', () => {
    const question = q('q-1', 'basic-theory');
    expect(isCorrect(question, { questionId: 'q-1', choiceIndex: 0, sure: true })).toBe(true);
    expect(isCorrect(question, { questionId: 'q-1', choiceIndex: 1, sure: true })).toBe(false);
    // 未選択(時間切れ等)は誤答として扱う。空欄を正解にしない
    expect(isCorrect(question, { questionId: 'q-1', sure: false })).toBe(false);
  });

  it('答えていない問題は結果に混ぜない(途中の点数を成績へ入れない)', () => {
    const list = [q('q-1', 'basic-theory'), q('q-2', 'law')];
    const results = grade(list, [{ questionId: 'q-1', choiceIndex: 0, sure: true }]);
    expect(results).toHaveLength(1);
    expect(results[0]!.question.id).toBe('q-1');
  });

  it('誤答の自信は必ず1になる(「間違えたが自信はあった」を残さない)', () => {
    const question = q('q-1', 'law');
    const wrong = toAttemptInput({
      question,
      answer: { questionId: 'q-1', choiceIndex: 2, sure: true },
      correct: false,
    });
    expect(wrong.confidence).toBe(1);
    expect(wrong.topicId).toBe('law');
    expect(wrong.questionRef).toBe('q-1');
  });

  it('「あやふや」で正解した問題は、復習キューへ入る', () => {
    const unsure = toAttemptInput({
      question: q('q-1', 'basic-theory'),
      answer: { questionId: 'q-1', choiceIndex: 0, sure: false },
      correct: true,
    });
    expect(unsure.confidence).toBe(1);

    const stats = topicStats([attempt({ ...unsure, id: 'a1' })], topicIds, '2026-09-02');
    const queue = reviewQueue([attempt({ ...unsure, id: 'a1' })], stats, 30, '2026-09-02');
    expect(queue).toHaveLength(1);
    expect(queue[0]!.reason).toBe('low-confidence');
  });

  it('「バッチリ」で正解した問題は、復習キューへ入らない', () => {
    const sure = toAttemptInput({
      question: q('q-1', 'basic-theory'),
      answer: { questionId: 'q-1', choiceIndex: 0, sure: true },
      correct: true,
    });
    const rows = [attempt({ ...sure, id: 'a1' })];
    const queue = reviewQueue(rows, topicStats(rows, topicIds, '2026-09-02'), 30, '2026-09-02');
    expect(queue).toHaveLength(0);
  });
});

describe('誤答から出し直す', () => {
  const bank = [
    q('q-1', 'basic-theory'),
    q('q-2', 'basic-theory'),
    q('q-3', 'law'),
    q('q-4', 'law'),
  ];

  it('落とした問題 → あやふやだった正解 → 誤答が出ている科目の未着手、の順に出す', () => {
    const rows = [
      attempt({ id: 'a1', questionRef: 'q-3', topicId: 'law', correct: false, confidence: 1 }),
      attempt({ id: 'a2', questionRef: 'q-1', correct: true, confidence: 1 }),
      // バッチリで正解した問題は戻さない。ここを戻すと直すべき問題が埋もれる
      attempt({ id: 'a3', questionRef: 'q-2', correct: true, confidence: 3 }),
    ];
    const picked = pickMistakes(bank, rows, 3);
    expect(picked.map((x) => x.id)).toEqual(['q-3', 'q-1', 'q-4']);
  });

  /**
   * 公式の50問で配線図を落としても、アプリ内では未着手ということがある。
   * そこを拾わないと、直前期の誤答潰し画面が「出す問題なし」で空になる。
   */
  it('外部教材で落とした科目からも、まだ解いていない問題を拾う', () => {
    const rows = [
      attempt({
        id: 'a1',
        source: '令和7年度上期 学科',
        questionRef: '第12問',
        topicId: 'law',
        correct: false,
      }),
    ];
    const picked = pickMistakes(bank, rows, 2);
    expect(picked.every((x) => x.topicId === 'law')).toBe(true);
    expect(picked).toHaveLength(2);
  });

  it('同じ問題を二重に出さない', () => {
    const rows = [
      attempt({ id: 'a1', questionRef: 'q-3', topicId: 'law', correct: false }),
      attempt({ id: 'a2', questionRef: 'q-3', topicId: 'law', correct: false }),
    ];
    const picked = pickMistakes(bank, rows, 4);
    expect(new Set(picked.map((x) => x.id)).size).toBe(picked.length);
  });
});

describe('弱点から出し直す', () => {
  it('未着手の科目を最優先で出す(0問の科目はゲートを永久に閉じる)', () => {
    const rows = [attempt({ id: 'a1', topicId: 'basic-theory', correct: false })];
    const picked = pickWeakTopic(questions, rows, topicIds, 5);
    expect(picked.length).toBe(5);
    // basic-theory は着手済みなので、未着手の科目が先に来る
    expect(picked[0]!.topicId).not.toBe('basic-theory');
  });

  it('全科目に着手済みなら、正答率のいちばん低い科目から出す', () => {
    const rows = topicIds.flatMap((topicId) =>
      Array.from({ length: 4 }, (_, i) =>
        attempt({
          id: `${topicId}-${i}`,
          topicId,
          // 法令だけ全問不正解にする
          correct: topicId === 'law' ? false : true,
          questionRef: `${topicId}-${i}`,
        }),
      ),
    );
    const picked = pickWeakTopic(questions, rows, topicIds, 3);
    expect(picked.every((x) => x.topicId === 'law')).toBe(true);
  });
});

describe('解き直しが間隔反復につながる(週末チェック・誤答潰し)', () => {
  it('同じ問題を解き直すと、前の誤答が復習キューから降り、間隔が付く', async () => {
    const { repo } = await import('../src/db/repo');
    await repo.wipe();

    const target = questions[0]!;
    // 1回目: 落とす
    await repo.recordQuiz('p0-l2', [
      { topicId: target.topicId, correct: false, confidence: 1, questionRef: target.id },
    ]);
    let rows = (await repo.load()).questionAttempts;
    expect(reviewQueue(rows, topicStats(rows, topicIds), 30)).toHaveLength(1);

    // 2回目(週末チェック): 解ける
    await repo.recordQuiz('p1-w1-l3', [
      { topicId: target.topicId, correct: true, confidence: 3, questionRef: target.id },
    ]);
    rows = (await repo.load()).questionAttempts;
    expect(rows).toHaveLength(2);

    const first = rows.find((a) => !a.correct)!;
    expect(first.reviewedAt).toBeTruthy();
    expect(first.reviewCount).toBe(1);
    // 翌日ではなく、1回クリアぶんの間隔が付く
    expect(first.nextReviewOn).toBeTruthy();
    // 今日のキューには出ない(予定日が先)
    expect(reviewQueue(rows, topicStats(rows, topicIds), 30)).toHaveLength(0);
  });

  it('解き直して落としたら、間隔は翌日へ戻る', async () => {
    const { repo } = await import('../src/db/repo');
    await repo.wipe();

    const target = questions[1]!;
    await repo.recordQuiz('p0-l2', [
      { topicId: target.topicId, correct: false, confidence: 1, questionRef: target.id },
    ]);
    await repo.recordQuiz('p1-w1-l3', [
      { topicId: target.topicId, correct: false, confidence: 1, questionRef: target.id },
    ]);
    const rows = (await repo.load()).questionAttempts;
    const first = rows.sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
    expect(first.reviewCount).toBe(0);
    expect(first.lastReviewCorrect).toBe(false);
  });

  it('別の問題の記録は巻き添えにしない', async () => {
    const { repo } = await import('../src/db/repo');
    await repo.wipe();

    const a = questions[0]!;
    const b = questions[1]!;
    await repo.recordQuiz('p0-l2', [
      { topicId: a.topicId, correct: false, confidence: 1, questionRef: a.id },
      { topicId: b.topicId, correct: false, confidence: 1, questionRef: b.id },
    ]);
    await repo.recordQuiz('p1-w1-l3', [
      { topicId: a.topicId, correct: true, confidence: 3, questionRef: a.id },
    ]);
    const rows = (await repo.load()).questionAttempts;
    const untouched = rows.find((r) => r.questionRef === b.id)!;
    expect(untouched.reviewedAt).toBeUndefined();
  });
});
