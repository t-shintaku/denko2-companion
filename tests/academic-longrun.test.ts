/**
 * 学科側の長期利用テスト。
 * 点数の水増し・復習の取りこぼし・判定窓のずれを止める。
 */

import { describe, expect, it } from 'vitest';
import {
  RECENT_WINDOW,
  applyReview,
  buildExamRecords,
  excludedMocks,
  mocks,
  nextReviewDate,
  recentAverageScore,
  reviewQueue,
  topicStats,
} from '../src/domain/academic';
import { reviewProgress, weekSummary, comebackCount, startOfWeek } from '../src/domain/growth';
import { validateBackup } from '../src/domain/backup';
import { SCHEMA_VERSION } from '../src/domain/types';
import type { MockExam, QuestionAttempt, StudySession, TopicId } from '../src/domain/types';

function exam(patch: Partial<MockExam> & { id: string }): MockExam {
  return {
    takenAt: '2026-10-01T10:00:00+09:00',
    jstDate: '2026-10-01',
    kind: 'mock-50',
    label: '令和7年度上期',
    totalQuestions: 50,
    correctCount: 40,
    timed: true,
    updatedAt: '2026-10-01T10:00:00+09:00',
    ...patch,
  };
}

let qseq = 0;
function q(patch: Partial<QuestionAttempt> = {}): QuestionAttempt {
  qseq += 1;
  const at = `2026-10-01T${String(Math.floor(qseq / 60)).padStart(2, '0')}:${String(qseq % 60).padStart(2, '0')}:00+09:00`;
  return {
    id: `q${qseq}`,
    attemptedAt: at,
    jstDate: '2026-10-01',
    source: 'test',
    questionRef: `第${qseq}問`,
    topicId: 'law' as TopicId,
    correct: true,
    confidence: 3,
    scored: true,
    updatedAt: at,
    ...patch,
  };
}

describe('点数の値域を集計側でも弾く', () => {
  it('50問で80問正解の行は集計に入らない(160点にならない)', () => {
    const exams = [exam({ id: 'ok', correctCount: 40 }), exam({ id: 'broken', correctCount: 80 })];
    expect(mocks(exams).map((e) => e.id)).toEqual(['ok']);
    expect(excludedMocks(exams).map((e) => e.id)).toEqual(['broken']);
  });

  it('負の正答数も弾く', () => {
    expect(mocks([exam({ id: 'neg', correctCount: -1 })])).toHaveLength(0);
  });

  it('壊れた行が混ざっても平均点が水増しされない', () => {
    const exams = [
      exam({ id: 'a', correctCount: 30 }),
      exam({ id: 'b', correctCount: 31 }),
      exam({ id: 'c', correctCount: 32 }),
      exam({ id: 'x', correctCount: 80 }),
    ];
    expect(recentAverageScore(exams, 3)).toBe(62);
  });

  it('バックアップ検証でも値域外の模試はファイルごと弾く', () => {
    const file = {
      kind: 'denko2-companion-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-10-01T10:00:00+09:00',
      appVersion: '0.1.0',
      data: {
        settings: [],
        lessonProgress: [],
        adminTaskStates: [],
        studySessions: [],
        questionAttempts: [],
        mockExams: [exam({ id: 'broken', correctCount: 80 })],
        unknownTerms: [],
        skillAttempts: [],
        budgetItems: [],
      },
    };
    const result = validateBackup(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path.includes('correctCount'))).toBe(true);
    }
  });
});

describe('復習は1回で終わらない(間隔をあけて戻る)', () => {
  it('解けたら翌日→3日→7日→14日と広がり、すべて通ると卒業する', () => {
    expect(nextReviewDate(1, true, '2026-10-01')).toBe('2026-10-02');
    expect(nextReviewDate(2, true, '2026-10-01')).toBe('2026-10-04');
    expect(nextReviewDate(3, true, '2026-10-01')).toBe('2026-10-08');
    expect(nextReviewDate(4, true, '2026-10-01')).toBe('2026-10-15');
    expect(nextReviewDate(5, true, '2026-10-01')).toBeUndefined();
  });

  it('解けなければ翌日へ戻る', () => {
    expect(nextReviewDate(3, false, '2026-10-01')).toBe('2026-10-02');
  });

  it('【回帰】解き直した当日はキューから消え、予定日に戻ってくる', () => {
    const wrong = q({ correct: false, confidence: 1 });
    const stats = topicStats([wrong], ['law']);
    expect(reviewQueue([wrong], stats, 30, '2026-10-01')).toHaveLength(1);

    const reviewed = applyReview(wrong, true, '2026-10-01T12:00:00+09:00', '2026-10-01');
    expect(reviewed.nextReviewOn).toBe('2026-10-02');
    expect(reviewQueue([reviewed], stats, 30, '2026-10-01')).toHaveLength(0);
    const back = reviewQueue([reviewed], stats, 30, '2026-10-02');
    expect(back).toHaveLength(1);
    expect(back[0]?.reason).toBe('spaced');
  });

  it('4つの間隔をすべて通過した問題はもう出ない', () => {
    let a = q({ correct: false });
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-12', '2026-10-26']) {
      a = applyReview(a, true, `${day}T12:00:00+09:00`, day);
    }
    expect(a.reviewCount).toBe(5);
    expect(a.nextReviewOn).toBeUndefined();
    const stats = topicStats([a], ['law']);
    expect(reviewQueue([a], stats, 30, '2027-01-01')).toHaveLength(0);
  });

  it('解けた問題数が「間違いが減った」証拠として数えられる', () => {
    const solved = applyReview(q({ correct: false }), true, '2026-10-01T12:00:00+09:00', '2026-10-01');
    const still = q({ correct: false });
    const p = reviewProgress([solved, still]);
    expect(p.solved).toBe(1);
    expect(p.pending).toBe(1);
  });
});

describe('まとめ入力の復習キュー', () => {
  it('【回帰】40問正解・10問誤答なら、復習キューに入るのは10問だけ', () => {
    // まとめ入力は正解を confidence 3、誤答を 2 で入れる。
    // 以前は全問を 2 にしていたため、50問すべてが「自信の低い正解」として入っていた
    const { attempts } = buildExamRecords(
      {
        kind: 'mock-50',
        label: '令和7年度上期',
        timed: true,
        questions: Array.from({ length: 50 }, (_, i) => ({
          topicId: 'law' as TopicId,
          correct: i < 40,
          confidence: (i < 40 ? 3 : 2) as 1 | 2 | 3,
          questionRef: i < 40 ? '令和7年度上期 法令(まとめ入力・正解)' : `令和7年度上期 第${i + 1}問`,
        })),
      },
      { examId: 'e1', attemptId: (i) => `e1_q${i}` },
      '2026-10-01T10:00:00+09:00',
      '2026-10-01',
    );
    const stats = topicStats(attempts, ['law']);
    const queue = reviewQueue(attempts, stats, 60, '2026-10-01');
    expect(queue).toHaveLength(10);
    expect(queue.every((i) => !i.attempt.correct)).toBe(true);
    // 誤答には本物の問題番号が残る(解き直す問題を特定できる)
    expect(queue[0]?.attempt.questionRef).toMatch(/第\d+問/);
  });
});

describe('科目の判定は直近の窓で行う', () => {
  it('昔の失点が残っていても、直近20問が良ければ達成になる', () => {
    const old = Array.from({ length: 40 }, () => q({ correct: false }));
    const recent = Array.from({ length: RECENT_WINDOW }, () => q({ correct: true }));
    const stat = topicStats([...old, ...recent], ['law'])[0]!;
    expect(stat.recentAccuracy).toBe(1);
    expect(stat.meetsMinimum).toBe(true);
    // 累計は隠さない。両方見せた上で、判定は直近
    expect(stat.accuracy).toBeLessThan(0.6);
  });

  it('昔の貯金があっても、直近が崩れていれば未達になる', () => {
    const old = Array.from({ length: 60 }, () => q({ correct: true }));
    const recent = Array.from({ length: RECENT_WINDOW }, () => q({ correct: false }));
    const stat = topicStats([...old, ...recent], ['law'])[0]!;
    expect(stat.accuracy).toBeGreaterThan(0.6);
    expect(stat.meetsMinimum).toBe(false);
  });
});

describe('今週の学習日数', () => {
  function session(jstDate: string): StudySession {
    return {
      id: `s-${jstDate}-${Math.random()}`,
      startedAt: `${jstDate}T20:00:00+09:00`,
      jstDate,
      durationMinutes: 30,
      kind: 'theory',
      countsAsBasics: true,
      updatedAt: `${jstDate}T20:00:00+09:00`,
    };
  }

  it('週の始まりは月曜', () => {
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28'); // 木 → 月
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28'); // 日 → 同じ週
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05'); // 月
  });

  it('先週の同じ時点と比べる(週の途中で不当に負けさせない)', () => {
    const sessions = [
      session('2026-09-21'),
      session('2026-09-22'),
      session('2026-09-25'), // 先週の後半。今週の水曜時点との比較には入れない
      session('2026-09-28'),
      session('2026-09-30'),
    ];
    const w = weekSummary(sessions, '2026-09-30'); // 水
    expect(w.days).toBe(2);
    expect(w.daysDelta).toBe(0); // 先週も月・火の2日
  });

  it('空白のあと戻った回数を数える(途切れた回数ではない)', () => {
    const sessions = [session('2026-09-01'), session('2026-09-10'), session('2026-09-11')];
    expect(comebackCount(sessions)).toBe(1);
  });
});
