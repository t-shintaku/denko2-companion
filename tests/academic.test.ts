import { describe, expect, it } from 'vitest';
import { topicIds } from '../src/data';
import {
  OFFICIAL_PASS_SCORE,
  TOPIC_MIN_SAMPLE,
  academicGate,
  buildExamRecords,
  recentAverageScore,
  reviewQueue,
  scoreOf,
  timedMockCount,
  topWeaknesses,
  topicStats,
} from '../src/domain/academic';
import type { MockExam, QuestionAttempt, TopicId } from '../src/domain/types';

function attempt(
  i: number,
  topicId: TopicId,
  correct: boolean,
  confidence: 1 | 2 | 3 = 3,
  day = '2026-09-01',
): QuestionAttempt {
  return {
    id: `a${i}`,
    attemptedAt: `${day}T10:${String(i % 60).padStart(2, '0')}:00+09:00`,
    jstDate: day,
    source: 'test',
    questionRef: `第${i}問`,
    topicId,
    correct,
    confidence,
    scored: true,
  };
}

function mock(id: string, correct: number, timed = false, day = '2026-10-01'): MockExam {
  return {
    id,
    takenAt: `${day}T10:00:00+09:00`,
    jstDate: day,
    kind: 'mock-50',
    label: id,
    totalQuestions: 50,
    correctCount: correct,
    timed,
  };
}

describe('AT-005 学科の集計', () => {
  it('79・80・81点の平均を80と算出する', () => {
    // 1問2点なので 39.5問…にはならない。得点から逆算した正答数で作る
    const exams = [mock('m1', 39), mock('m2', 40), mock('m3', 41)];
    expect(exams.map(scoreOf)).toEqual([78, 80, 82]);
    expect(recentAverageScore(exams, 3)).toBe(80);
  });

  it('模試が3回に満たなければ平均を出さない(足りない平均で通さない)', () => {
    expect(recentAverageScore([mock('m1', 45), mock('m2', 40)], 3)).toBeUndefined();
  });

  it('直近3回だけを見る', () => {
    const exams = [mock('m0', 20, false, '2026-09-01'), mock('m1', 40, false, '2026-10-01'), mock('m2', 40, false, '2026-10-08'), mock('m3', 40, false, '2026-10-15')];
    expect(recentAverageScore(exams, 3)).toBe(80);
  });

  it('平均80点でも1科目が60%未満なら学科ゲートを通さない', () => {
    const attempts: QuestionAttempt[] = [];
    let n = 0;
    for (const t of topicIds) {
      // 各科目 50問。法令だけ正答率50%にする
      const accuracy = t === 'law' ? 0.5 : 0.9;
      for (let i = 0; i < 50; i += 1) attempts.push(attempt(n++, t, i < 50 * accuracy));
    }
    const exams = [mock('m1', 40), mock('m2', 40), mock('m3', 40, true), mock('m4', 40, true)];
    const stats = topicStats(attempts, topicIds);
    const gate = academicGate(attempts, exams, stats);

    expect(recentAverageScore(exams, 3)).toBe(80);
    expect(gate.criteria.find((c) => c.id === 'recent-average')?.passed).toBe(true);
    expect(gate.criteria.find((c) => c.id === 'per-topic')?.passed).toBe(false);
    expect(gate.passed).toBe(false);
  });

  it('全科目60%以上・累計300問・120分模試2回で学科ゲートを通す', () => {
    const attempts: QuestionAttempt[] = [];
    let n = 0;
    for (const t of topicIds) {
      for (let i = 0; i < 50; i += 1) attempts.push(attempt(n++, t, i < 45));
    }
    const exams = [mock('m1', 41), mock('m2', 41), mock('m3', 41, true), mock('m4', 41, true)];
    const stats = topicStats(attempts, topicIds);
    const gate = academicGate(attempts, exams, stats);
    expect(timedMockCount(exams)).toBe(2);
    expect(gate.passed).toBe(true);
  });

  it('サンプルが少ない科目を「達成」と呼ばない', () => {
    const attempts = [attempt(1, 'law', true), attempt(2, 'law', true), attempt(3, 'law', true)];
    const stats = topicStats(attempts, topicIds);
    const law = stats.find((s) => s.topicId === 'law')!;
    expect(law.accuracy).toBe(1);
    expect(law.hasSample).toBe(false);
    expect(law.meetsMinimum).toBe(false); // 3問で100%を得意と呼ばない
    expect(TOPIC_MIN_SAMPLE).toBe(10);
  });

  it('公式基準(60点)と運用目標(80点)を別々に持つ', () => {
    expect(OFFICIAL_PASS_SCORE).toBe(60);
    expect(scoreOf(mock('m', 30))).toBe(60);
  });

  it('無採点(scored:false)は一切集計に入れない', () => {
    const ungraded: QuestionAttempt = { ...attempt(1, 'law', false), scored: false };
    const stats = topicStats([ungraded], topicIds);
    expect(stats.find((s) => s.topicId === 'law')?.total).toBe(0);
    expect(stats.every((s) => !s.started)).toBe(true);
  });
});

describe('FR-009 復習キュー', () => {
  it('誤答と「自信の低い正解」を拾い、誤答を先に出す', () => {
    const attempts = [
      attempt(1, 'law', true, 3),
      attempt(2, 'law', true, 2), // まぐれ当たり
      attempt(3, 'law', false, 3),
    ];
    const q = reviewQueue(attempts, topicStats(attempts, topicIds));
    expect(q.map((i) => i.reason)).toEqual(['wrong', 'low-confidence']);
    expect(q[0]?.attempt.id).toBe('a3');
  });

  it('解き直したものはキューから外れる', () => {
    const attempts = [
      { ...attempt(1, 'law', false), reviewedAt: '2026-09-02T10:00:00+09:00' },
      attempt(2, 'law', false),
    ];
    const q = reviewQueue(attempts, topicStats(attempts, topicIds));
    expect(q).toHaveLength(1);
    expect(q[0]?.attempt.id).toBe('a2');
  });

  it('自信3の正解は、その科目が弱いときだけ拾う', () => {
    const strong = [attempt(1, 'law', true, 3)];
    expect(reviewQueue(strong, topicStats(strong, topicIds))).toHaveLength(0);

    // 直近が60%未満の科目なら、確実だと思った正解も復習対象にする
    const weak = [
      ...Array.from({ length: 6 }, (_, i) => attempt(i + 10, 'law', false, 3)),
      attempt(1, 'law', true, 3),
    ];
    const q = reviewQueue(weak, topicStats(weak, topicIds));
    expect(q.some((i) => i.reason === 'stale-weak')).toBe(true);
  });
});

describe('FR-010 模試の記録', () => {
  it('入力から模試と1問ごとの記録を組み立てる', () => {
    const { exam, attempts } = buildExamRecords(
      {
        kind: 'mock-50',
        label: '令和7年度上期',
        timed: true,
        minutes: 118,
        questions: [
          { topicId: 'law', correct: true, confidence: 3 },
          { topicId: 'law', correct: false, confidence: 1, errorReason: 'knowledge' },
          { topicId: 'basic-theory', correct: false, confidence: 2, errorReason: 'calculation' },
        ],
      },
      { examId: 'e1', attemptId: (i) => `e1_q${i + 1}` },
      '2026-10-01T10:00:00+09:00',
      '2026-10-01',
    );

    expect(exam.correctCount).toBe(1);
    expect(exam.totalQuestions).toBe(3);
    expect(exam.timed).toBe(true);
    expect(exam.minutes).toBe(118);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((a) => a.examId === 'e1' && a.scored)).toBe(true);
    // 正解に誤答理由を残さない
    expect(attempts[0]?.errorReason).toBeUndefined();
    expect(attempts[1]?.errorReason).toBe('knowledge');
  });

  it('模試のあと「次までに直す上位3つ」を誤答数の多い順に出す', () => {
    const attempts: QuestionAttempt[] = [
      { ...attempt(1, 'law', false), examId: 'e1' },
      { ...attempt(2, 'law', false), examId: 'e1' },
      { ...attempt(3, 'law', false), examId: 'e1' },
      { ...attempt(4, 'basic-theory', false), examId: 'e1' },
      { ...attempt(5, 'wiring-diagram', true), examId: 'e1' },
      { ...attempt(6, 'inspection', false), examId: 'other' },
    ];
    const top = topWeaknesses(attempts, 'e1', topicStats(attempts, topicIds));
    expect(top[0]).toMatchObject({ topicId: 'law', wrong: 3 });
    expect(top.map((t) => t.topicId)).not.toContain('inspection'); // 別の回は混ぜない
    expect(top.length).toBeLessThanOrEqual(3);
  });
});
