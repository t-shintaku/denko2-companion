import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/data';
import {
  xpForLesson,
  applyStep,
  completionRatio,
  isLessonComplete,
  modeForBudget,
  nextStep,
  requiredSteps,
} from '../src/domain/lessons';

const lesson = curriculum.lessons.find((l) => l.id === 'p0-l1')!;
const now = new Date('2026-08-11T20:00:00+09:00');

describe('AT-003 レッスンの4段階完了', () => {
  it('4段階すべてが必須', () => {
    expect(requiredSteps(lesson)).toEqual(['input', 'recall', 'practice', 'takeaway']);
  });

  it('動画を見ただけでは完了にならず、XPも0のまま', () => {
    const p = applyStep(lesson, undefined, 'input', {}, now);
    expect(isLessonComplete(lesson, p)).toBe(false);
    expect(p.completedAt).toBeUndefined();
    expect(p.xpAwarded).toBe(0);
    expect(completionRatio(lesson, p)).toBeCloseTo(0.25);
    expect(nextStep(lesson, p)).toBe('recall');
  });

  it('Recall と Practice だけでも完了にならない', () => {
    let p = applyStep(lesson, undefined, 'input', {}, now);
    p = applyStep(lesson, p, 'recall', { recallAnswers: ['答え'] }, now);
    p = applyStep(lesson, p, 'practice', { practiceNote: 'やった' }, now);
    expect(isLessonComplete(lesson, p)).toBe(false);
    expect(p.xpAwarded).toBe(0);
    expect(nextStep(lesson, p)).toBe('takeaway');
  });

  it('1点残すまで済ませて初めて完了し、XPが付く', () => {
    let p = applyStep(lesson, undefined, 'input', {}, now);
    p = applyStep(lesson, p, 'recall', { recallAnswers: ['答え'] }, now);
    p = applyStep(lesson, p, 'practice', { practiceNote: 'やった' }, now);
    p = applyStep(lesson, p, 'takeaway', { takeaway: '接地の意味を毎回忘れる' }, now);
    expect(isLessonComplete(lesson, p)).toBe(true);
    expect(p.completedAt).toBe('2026-08-11T20:00:00+09:00');
    expect(p.xpAwarded).toBe(xpForLesson(lesson));
    expect(p.takeaway).toBe('接地の意味を毎回忘れる');
  });

  it('完了後に上書きしても完了日時とXPは二重に増えない', () => {
    let p = applyStep(lesson, undefined, 'input', {}, now);
    p = applyStep(lesson, p, 'recall', { recallAnswers: ['a'] }, now);
    p = applyStep(lesson, p, 'practice', { practiceNote: 'b' }, now);
    p = applyStep(lesson, p, 'takeaway', { takeaway: 'c' }, now);
    const later = new Date('2026-08-12T20:00:00+09:00');
    const again = applyStep(lesson, p, 'takeaway', { takeaway: 'c2' }, later);
    expect(again.completedAt).toBe(p.completedAt);
    expect(again.xpAwarded).toBe(xpForLesson(lesson));
  });

  it('かかった時間に応じて、長い模試ほどXPが増える', () => {
    const short = curriculum.lessons.find((l) => l.estimatedMinutes.standard < 20)!;
    const long = curriculum.lessons.find((l) => l.estimatedMinutes.standard >= 90)!;
    expect(xpForLesson(short)).toBe(10);
    expect(xpForLesson(long)).toBe(30);
  });

  it('10/30/60分の持ち時間からモードが決まる', () => {
    expect(modeForBudget(10)).toBe('minimum');
    expect(modeForBudget(30)).toBe('standard');
    expect(modeForBudget(60)).toBe('deep');
    expect(lesson.estimatedMinutes.minimum).toBeLessThan(lesson.estimatedMinutes.standard);
    expect(lesson.estimatedMinutes.standard).toBeLessThan(lesson.estimatedMinutes.deep);
  });

  it('すべてのレッスンが10/30/60分の3段階を持つ', () => {
    for (const l of curriculum.lessons) {
      expect(l.estimatedMinutes.minimum).toBeGreaterThan(0);
      expect(l.estimatedMinutes.minimum).toBeLessThanOrEqual(l.estimatedMinutes.standard);
      expect(l.estimatedMinutes.standard).toBeLessThanOrEqual(l.estimatedMinutes.deep);
    }
  });
});
