/**
 * 出題範囲のカバレッジ。**「合格ラインに乗っている」を数字で言い切れるか**を守る。
 *
 * ここが甘いと、レッスンを全部終えた画面で100%と出るのに、
 * 実際には一度も正解していない項目が残る。準備度の嘘は受験判断を直接誤らせる。
 */
import { describe, expect, it } from 'vitest';
import {
  coverageGaps,
  overallCoverage,
  syllabusStatus,
  topicCoverage,
} from '../src/domain/coverage';
import { IN_APP_SOURCE } from '../src/domain/quiz';
import { curriculum, questions, syllabus, topicIds } from '../src/data';
import type { LessonProgress, QuestionAttempt } from '../src/domain/types';

const completed = (lessonId: string): LessonProgress => ({
  lessonId,
  inputViewedAt: '2026-09-01T10:00:00+09:00',
  recallSubmittedAt: '2026-09-01T10:10:00+09:00',
  practiceSubmittedAt: '2026-09-01T10:20:00+09:00',
  takeawaySavedAt: '2026-09-01T10:25:00+09:00',
  completedAt: '2026-09-01T10:25:00+09:00',
  xpAwarded: 10,
  updatedAt: '2026-09-01T10:25:00+09:00',
});

const solved = (questionRef: string, correct: boolean): QuestionAttempt => ({
  id: `a-${questionRef}`,
  attemptedAt: '2026-09-01T10:20:00+09:00',
  jstDate: '2026-09-01',
  source: IN_APP_SOURCE,
  questionRef,
  topicId: questions.find((q) => q.id === questionRef)!.topicId,
  correct,
  confidence: 3,
  scored: true,
  updatedAt: '2026-09-01T10:20:00+09:00',
});

const statusOf = (
  progress: Record<string, LessonProgress> = {},
  attempts: QuestionAttempt[] = [],
) => syllabusStatus(syllabus, curriculum.lessons, questions, progress, attempts);

describe('出題項目の状態', () => {
  it('何もしていなければ、どの項目も埋まっていない', () => {
    const statuses = statusOf();
    expect(statuses.every((s) => !s.taught && !s.confirmed)).toBe(true);
    expect(overallCoverage(topicCoverage(statuses, topicIds))).toBe(0);
  });

  it('レッスンを完了しただけでは「確認済み」にならない', () => {
    const lesson = curriculum.lessons.find((l) => l.id === 'p2-w5-l3')!;
    const statuses = statusOf({ [lesson.id]: completed(lesson.id) });
    const branch = statuses.find((s) => s.item.id === 'dd-branch-circuit')!;
    expect(branch.taught).toBe(true);
    expect(branch.confirmed).toBe(false);
  });

  it('1問でも正解すると「確認済み」になり、不正解だけでは、ならない', () => {
    const wrongOnly = statusOf({}, [solved('q-dd-001', false)]);
    expect(wrongOnly.find((s) => s.item.id === 'dd-branch-circuit')!.confirmed).toBe(false);

    const rightOnce = statusOf({}, [solved('q-dd-001', false), solved('q-dd-002', true)]);
    expect(rightOnce.find((s) => s.item.id === 'dd-branch-circuit')!.confirmed).toBe(true);
  });

  it('外部教材の記録は、出題項目の確認には使わない(どの項目かが分からないため)', () => {
    const external: QuestionAttempt = {
      ...solved('q-dd-001', true),
      source: '令和7年度上期 学科',
      questionRef: '第10問',
    };
    const statuses = statusOf({}, [external]);
    expect(statuses.every((s) => !s.confirmed)).toBe(true);
  });
});

describe('科目ごとの重み付け', () => {
  it('項目数ではなく本番の出題数で加重する(配線図が空なら数字は伸びない)', () => {
    // 法令(4問ぶん)を全部埋めたときと、配線図(20問ぶん)を全部埋めたときを比べる
    const fill = (topicId: string) => {
      const items = syllabus.filter((s) => s.topicId === topicId);
      const attempts = items.flatMap((item) =>
        questions
          .filter((q) => q.syllabusIds.includes(item.id))
          .slice(0, 1)
          .map((q) => solved(q.id, true)),
      );
      const progress: Record<string, LessonProgress> = {};
      for (const l of curriculum.lessons) {
        const teaches = (l.practice.questionIds ?? []).some((id) =>
          questions.find((q) => q.id === id)?.syllabusIds.some((s) =>
            items.some((i) => i.id === s),
          ),
        );
        if (teaches) progress[l.id] = completed(l.id);
      }
      return overallCoverage(topicCoverage(statusOf(progress, attempts), topicIds));
    };
    expect(fill('wiring-diagram')).toBeGreaterThan(fill('law') * 3);
  });

  it('全項目を教わって全項目で正解すれば100%になる', () => {
    const progress: Record<string, LessonProgress> = {};
    for (const l of curriculum.lessons) progress[l.id] = completed(l.id);
    const attempts = questions.map((q) => solved(q.id, true));
    const ratio = overallCoverage(topicCoverage(statusOf(progress, attempts), topicIds));
    expect(Math.round(ratio * 100)).toBe(100);
  });
});

describe('次に埋める穴', () => {
  it('「習ったのに正解していない」項目を先に出す(今日すぐ取り返せるため)', () => {
    const lesson = curriculum.lessons.find((l) => l.id === 'p2-w5-l3')!;
    const gaps = coverageGaps(statusOf({ [lesson.id]: completed(lesson.id) }), 3);
    expect(gaps[0]!.taught).toBe(true);
    expect(gaps[0]!.confirmed).toBe(false);
  });

  it('同じ状態なら、本番の配点が大きい項目から出す', () => {
    const gaps = coverageGaps(statusOf(), 3);
    const weights = gaps.map((g) => g.item.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(gaps[0]!.item.topicId).toBe('wiring-diagram');
  });
});
