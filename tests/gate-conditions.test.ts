/**
 * ゲートの条件が「画面に書いてあるとおり」であることを守るテスト。
 *
 * 表示より甘い条件で通すのは、合格判断としては嘘に等しい。
 * どれも「本人は通ったと思って進み、本番で落ちる」種類の欠陥。
 */

import { describe, expect, it } from 'vitest';
import { topicIds } from '../src/data';
import {
  ACADEMIC_EXAM_MINUTES,
  RECENT_WINDOW,
  TOPIC_MIN_SAMPLE,
  academicGate,
  isTimedMock,
  timedMockCount,
  topicStats,
  untimedMockCount,
} from '../src/domain/academic';
import { DEFECT_CLEAR_RUNS, repeatDefects } from '../src/domain/practical';
import type { MockExam, QuestionAttempt, SkillAttempt, TopicId } from '../src/domain/types';

function mock(id: string, patch: Partial<MockExam> = {}): MockExam {
  return {
    id,
    takenAt: '2026-10-01T10:00:00+09:00',
    jstDate: '2026-10-01',
    kind: 'mock-50',
    label: id,
    totalQuestions: 50,
    correctCount: 40,
    timed: true,
    updatedAt: '2026-10-01T10:00:00+09:00',
    ...patch,
  };
}

let n = 0;
function q(topicId: TopicId, correct: boolean): QuestionAttempt {
  n += 1;
  const at = `2026-10-01T${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00+09:00`;
  return {
    id: `q${n}`,
    attemptedAt: at,
    jstDate: '2026-10-01',
    source: 'test',
    questionRef: `第${n}問`,
    topicId,
    correct,
    confidence: 3,
    scored: true,
    updatedAt: at,
  };
}

describe('120分模試は時間を記録した回だけ数える', () => {
  it('【回帰】時間未記録の「本番同様」2件では条件が通らない', () => {
    // 以前は timed のチェックだけを見ていたので、タイマーも時間入力も無い2件で
    // 「120分模試2回」が達成になっていた
    const exams = [mock('a', { minutes: undefined }), mock('b', { minutes: undefined })];
    expect(timedMockCount(exams)).toBe(0);
    expect(untimedMockCount(exams)).toBe(2);

    const stats = topicStats([], topicIds);
    const gate = academicGate([], exams, stats);
    const timed = gate.criteria.find((c) => c.id === 'timed-mocks')!;
    expect(timed.passed).toBe(false);
    expect(timed.evidence).toContain('時間未記録');
  });

  it('時間を入れた回は数える。早く終わった回も本番同様として認める', () => {
    expect(isTimedMock(mock('a', { minutes: 118 }))).toBe(true);
    expect(isTimedMock(mock('b', { minutes: 95 }))).toBe(true);
    expect(timedMockCount([mock('a', { minutes: 118 }), mock('b', { minutes: 95 })])).toBe(2);
  });

  it('本番の時間を超えた回は「本番同様」として数えない', () => {
    expect(isTimedMock(mock('slow', { minutes: ACADEMIC_EXAM_MINUTES + 1 }))).toBe(false);
  });
});

describe('「直近20問で60%以上」は本当に20問要る', () => {
  it('【回帰】各科目10問の全問正解では達成にならない', () => {
    // 表示は「直近20問」なのに、判定は10問で通っていた
    const attempts = topicIds.flatMap((t) => Array.from({ length: 10 }, () => q(t, true)));
    const stats = topicStats(attempts, topicIds);
    expect(stats.every((s) => s.recentAccuracy === 1)).toBe(true);
    expect(stats.every((s) => s.hasSample)).toBe(false);
    expect(stats.every((s) => !s.meetsMinimum)).toBe(true);

    const gate = academicGate(attempts, [], stats);
    const perTopic = gate.criteria.find((c) => c.id === 'per-topic')!;
    expect(perTopic.passed).toBe(false);
    expect(perTopic.evidence).toContain('判定不能');
  });

  it('20問そろえば判定できる', () => {
    const attempts = topicIds.flatMap((t) =>
      Array.from({ length: RECENT_WINDOW }, (_, i) => q(t, i < 15)),
    );
    const stats = topicStats(attempts, topicIds);
    expect(stats.every((s) => s.hasSample)).toBe(true);
    expect(stats.every((s) => s.meetsMinimum)).toBe(true);
    expect(TOPIC_MIN_SAMPLE).toBe(RECENT_WINDOW);
  });
});

describe('反復欠陥の自動解除は、完成させた作品だけで数える', () => {
  let seq = 0;
  const attempt = (patch: Partial<SkillAttempt> & { candidateNo: number }): SkillAttempt => {
    seq += 1;
    return {
      id: `s${seq}`,
      attemptedAt: `2026-11-01T${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}:00+09:00`,
      updatedAt: '2026-01-01T00:00:00+09:00',
      kind: 'candidate',
      workMinutes: 30,
      completed: true,
      defectFree: true,
      defectCodes: [],
      photoIds: [],
      ...patch,
    };
  };

  it('【回帰】未完成の作品を並べても解除されない', () => {
    const twice = [
      attempt({ candidateNo: 1, defectFree: false, defectCodes: ['core-cut'] }),
      attempt({ candidateNo: 2, defectFree: false, defectCodes: ['core-cut'] }),
    ];
    const unfinished = [3, 4, 5].map((no) =>
      attempt({ candidateNo: no, completed: false, defectFree: false }),
    );
    const repeats = repeatDefects([...twice, ...unfinished]);
    expect(repeats[0]?.cleanRuns).toBe(0);
    expect(repeats[0]?.resolved).toBe(false);
  });

  it('完成させた作品なら数える', () => {
    const twice = [
      attempt({ candidateNo: 1, defectFree: false, defectCodes: ['core-cut'] }),
      attempt({ candidateNo: 2, defectFree: false, defectCodes: ['core-cut'] }),
    ];
    const finished = [3, 4, 5].map((no) => attempt({ candidateNo: no }));
    const repeats = repeatDefects([...twice, ...finished]);
    expect(repeats[0]?.cleanRuns).toBe(DEFECT_CLEAR_RUNS);
    expect(repeats[0]?.resolved).toBe(true);
  });
});
