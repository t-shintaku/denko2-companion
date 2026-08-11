/**
 * 「言った時間で終わる」の検証。
 * 時間が動かない作業を、比率配分で短く見せていないこと。
 */

import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/data';
import { planForBudget, requiredSteps, stepMinutes, scheduleCost } from '../src/domain/lessons';
import type { CurriculumLesson, LessonMode } from '../src/domain/types';

const MODES: LessonMode[] = ['minimum', 'standard', 'deep'];

function lessonById(id: string): CurriculumLesson {
  const l = curriculum.lessons.find((x) => x.id === id);
  if (!l) throw new Error(`no lesson ${id}`);
  return l;
}

describe('固定時間の作業を短く見せない', () => {
  it('【回帰】120分の模試は、どの持ち時間でも120分と出る', () => {
    const mock = lessonById('p4-l1'); // 本番模試(週2回まで)
    for (const mode of MODES) {
      expect(stepMinutes(mock, mode, 'practice'), mode).toBe(120);
    }
    // 10分の持ち時間で開いても「120分の作業」だと伝わり、収まらないと明示される
    const plan = planForBudget(mock, 'minimum', { lessonId: mock.id, xpAwarded: 0, updatedAt: '', inputViewedAt: 'x', recallSubmittedAt: 'x' }, 10);
    expect(plan.step).toBe('practice');
    expect(plan.minutes).toBe(120);
    expect(plan.fitsBudget).toBe(false);
  });

  it('【回帰】候補問題1題は12分ではない', () => {
    for (const no of [1, 7, 13]) {
      const l = lessonById(`p5-c${String(no).padStart(2, '0')}`);
      expect(stepMinutes(l, 'minimum', 'practice')).toBeGreaterThanOrEqual(55);
    }
  });

  it('明示時間のないレッスンは、従来どおり見積を比率で割る', () => {
    const plain = curriculum.lessons.find((l) => l.stepMinutes === undefined)!;
    const total = requiredSteps(plain).reduce((n, s) => n + stepMinutes(plain, 'standard', s), 0);
    expect(Math.abs(total - plain.estimatedMinutes.standard)).toBeLessThanOrEqual(2);
  });

  it('予定表に積む所要は、明示時間を下回らない', () => {
    for (const l of curriculum.lessons) {
      const fixed = requiredSteps(l).reduce((n, s) => n + (l.stepMinutes?.[s] ?? 0), 0);
      expect(scheduleCost(l), l.id).toBeGreaterThanOrEqual(fixed);
    }
  });

  it('全レッスン・全モードで、段階の合計が見積を大きく超えない', () => {
    for (const l of curriculum.lessons) {
      for (const mode of MODES) {
        const total = requiredSteps(l).reduce((n, s) => n + stepMinutes(l, mode, s), 0);
        const floor = Math.max(l.estimatedMinutes[mode], scheduleCost(l));
        expect(total, `${l.id} ${mode}`).toBeLessThanOrEqual(floor + 5);
      }
    }
  });
});
