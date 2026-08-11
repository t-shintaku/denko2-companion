import { describe, expect, it } from 'vitest';
import { buildSchedule, lessonsOnDate } from '../src/domain/schedule';
import { curriculum as realCurriculum } from '../src/data';
import type { Curriculum, CurriculumLesson, LessonProgress } from '../src/domain/types';

function lesson(
  id: string,
  order: number,
  minutes: number,
  required = true,
  phaseId = 'phase-x',
): CurriculumLesson {
  return {
    id,
    phaseId,
    order,
    stage: 'regular',
    title: id,
    objective: '',
    prerequisites: [],
    estimatedMinutes: { minimum: 10, standard: minutes, deep: minutes * 2 },
    resources: [],
    recallPrompts: [],
    practice: { kind: 'checklist', instruction: '', scored: false },
    officialTopicIds: [],
    required,
  };
}

function fakeCurriculum(lessons: CurriculumLesson[]): Curriculum {
  return {
    schemaVersion: 1,
    id: 'test',
    title: 'test',
    examCycleId: '2026-h2',
    phases: [
      {
        id: 'phase-x',
        order: 0,
        title: 'x',
        goal: '',
        anchor: { kind: 'flow', weightWeeks: 1 },
        segment: 'academic',
      },
      {
        id: 'phase-tail',
        order: 1,
        title: 'tail',
        goal: '',
        anchor: { kind: 'before-academic', durationDays: 2 },
        segment: 'academic',
      },
    ],
    lessons,
  };
}

const base = {
  weekdayMinutes: 30,
  weekendMinutes: 30,
  progress: {} as Record<string, LessonProgress>,
};

describe('AT-004 再計画', () => {
  it('1日の容量を超えて積まない — 3日休んでも4日目に全部載せない', () => {
    const lessons = ['a', 'b', 'c', 'd'].map((id, i) => lesson(id, i + 1, 30));
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-11', // 3日サボった
      academicDate: '2026-08-20',
      curriculum: fakeCurriculum(lessons),
    });
    // 過去日(08-11〜13)へは配置し直さない
    expect(result.days[0]?.date).toBe('2026-08-14');
    expect(lessonsOnDate(result, '2026-08-14')).toEqual(['a']);
    expect(lessonsOnDate(result, '2026-08-15')).toEqual(['b']);
    expect(lessonsOnDate(result, '2026-08-16')).toEqual(['c']);
    expect(result.days.every((d) => d.lessonIds.length <= 1)).toBe(true);
  });

  it('完了済みレッスンは再配置の対象から外れる', () => {
    const lessons = ['a', 'b'].map((id, i) => lesson(id, i + 1, 30));
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-20',
      curriculum: fakeCurriculum(lessons),
      progress: {
        a: { lessonId: 'a', xpAwarded: 10, updatedAt: '', completedAt: '2026-08-13T10:00:00+09:00' },
      },
    });
    expect(result.byLessonId.a).toBeUndefined();
    expect(lessonsOnDate(result, '2026-08-14')).toEqual(['b']);
  });

  it('容量が足りないとき、必須を黙って落とさず警告として出す', () => {
    const lessons = ['a', 'b', 'c', 'd', 'e'].map((id, i) => lesson(id, i + 1, 30));
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-15', // 2日しかない
      curriculum: fakeCurriculum(lessons),
    });
    expect(result.compressed).toBe(true);
    expect(result.unplacedRequiredLessonIds).toEqual(['c', 'd', 'e']);
    expect(result.droppedOptionalLessonIds).toEqual([]);
  });

  it('容量不足では任意レッスンを先に外し、必須を守る', () => {
    // 任意(order 1)が必須(order 2,3)より前にあっても、必須が優先される
    const lessons = [
      lesson('opt', 1, 30, false),
      lesson('req1', 2, 30, true),
      lesson('req2', 3, 30, true),
    ];
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-15',
      curriculum: fakeCurriculum(lessons),
    });
    expect(result.unplacedRequiredLessonIds).toEqual([]);
    expect(result.droppedOptionalLessonIds).toEqual(['opt']);
  });

  it('直前期フェーズは試験日の直前に予約される', () => {
    const lessons = [
      lesson('a', 1, 30),
      lesson('b', 2, 30),
      lesson('t1', 1, 30, true, 'phase-tail'),
      lesson('t2', 2, 30, true, 'phase-tail'),
    ];
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-18',
      curriculum: fakeCurriculum(lessons),
    });
    expect(lessonsOnDate(result, '2026-08-17')).toEqual(['t1']);
    expect(lessonsOnDate(result, '2026-08-18')).toEqual(['t2']);
  });

  it('受験日を変えると負荷上限の中で配置し直す', () => {
    const lessons = ['a', 'b', 'c'].map((id, i) => lesson(id, i + 1, 30));
    const tight = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-15',
      curriculum: fakeCurriculum(lessons),
    });
    expect(tight.unplacedRequiredLessonIds).toEqual(['c']);

    const relaxed = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      academicDate: '2026-08-31',
      curriculum: fakeCurriculum(lessons),
    });
    expect(relaxed.unplacedRequiredLessonIds).toEqual([]);
    expect(relaxed.days.every((d) => d.usedMinutes <= d.capacityMinutes)).toBe(true);
  });

  it('休日は容量が大きく、平日より多く入る', () => {
    const lessons = ['a', 'b', 'c'].map((id, i) => lesson(id, i + 1, 30));
    const result = buildSchedule({
      ...base,
      weekdayMinutes: 30,
      weekendMinutes: 90,
      today: '2026-08-14', // 金
      startDate: '2026-08-14',
      academicDate: '2026-08-20',
      curriculum: fakeCurriculum(lessons),
    });
    expect(lessonsOnDate(result, '2026-08-14')).toEqual(['a']);
    expect(lessonsOnDate(result, '2026-08-15')).toEqual(['b', 'c']); // 土
  });

  it('【回帰】1日の容量を超えるレッスンは、空の日でも置かない', () => {
    // 以前は「空の日なら容量超過でも1件は置く」という例外があり、
    // 平日35分の日に120分の模試が載っていた
    const lessons = [lesson('mock', 1, 120)];
    const weekdayOnly = buildSchedule({
      ...base,
      weekdayMinutes: 35,
      weekendMinutes: 35,
      today: '2026-08-17', // 月
      startDate: '2026-08-17',
      academicDate: '2026-08-21', // 金まで。休日なし
      curriculum: fakeCurriculum(lessons),
    });
    expect(weekdayOnly.days.every((d) => d.lessonIds.length === 0)).toBe(true);
    expect(weekdayOnly.unplacedRequiredLessonIds).toEqual(['mock']);
    // 「日数が足りない」ではなく「1日の枠より重い」と原因を分けて出す
    expect(weekdayOnly.oversizedLessonIds).toEqual(['mock']);
  });

  it('重いレッスンは容量のある休日へ回る', () => {
    const lessons = [lesson('mock', 1, 120)];
    const result = buildSchedule({
      ...base,
      weekdayMinutes: 35,
      weekendMinutes: 150,
      today: '2026-08-17', // 月
      startDate: '2026-08-17',
      academicDate: '2026-08-23',
      curriculum: fakeCurriculum(lessons),
    });
    expect(result.byLessonId.mock).toBe('2026-08-22'); // 土
    expect(result.oversizedLessonIds).toEqual([]);
    expect(result.days.every((d) => d.usedMinutes <= d.capacityMinutes)).toBe(true);
  });

  it('どの日も容量を超えない(実カリキュラム全体)', () => {
    const result = buildSchedule({
      today: '2026-08-11',
      startDate: '2026-08-11',
      academicDate: '2026-10-24',
      skillDate: '2026-12-12',
      weekdayMinutes: 35,
      weekendMinutes: 150,
      curriculum: realCurriculum,
      progress: {},
    });
    for (const day of result.days) {
      expect(day.usedMinutes, `${day.date}`).toBeLessThanOrEqual(day.capacityMinutes);
    }
  });

  it('受験日が未定でも学習は止まらない(仮の地平線を置く)', () => {
    const lessons = ['a', 'b'].map((id, i) => lesson(id, i + 1, 30));
    const result = buildSchedule({
      ...base,
      today: '2026-08-14',
      startDate: '2026-08-14',
      curriculum: fakeCurriculum(lessons),
    });
    expect(result.academicDaysLeft).toBeUndefined();
    expect(result.byLessonId.a).toBe('2026-08-14');
  });
});

describe('実カリキュラムの配置', () => {
  it('2026-08-11開始・10-24学科・12-12技能で必須が入り切る', () => {
    const result = buildSchedule({
      today: '2026-08-11',
      startDate: '2026-08-11',
      academicDate: '2026-10-24',
      skillDate: '2026-12-12',
      weekdayMinutes: 35,
      weekendMinutes: 150,
      curriculum: realCurriculum,
      progress: {},
    });
    expect(result.unplacedRequiredLessonIds).toEqual([]);
    // Phase 0 の1本目が今日に来る
    expect(result.byLessonId['p0-l1']).toBe('2026-08-11');
    // 技能セグメントは学科翌日以降
    expect(result.byLessonId['p5-w1']! > '2026-10-24').toBe(true);
    // 技能直前レッスンは試験日の直前5日に入る
    expect(result.byLessonId['p6-l4']! >= '2026-12-08').toBe(true);
  });

  it('開始が遅れて残り3週間でも、必須を黙って消さず警告にする', () => {
    const result = buildSchedule({
      today: '2026-10-03',
      startDate: '2026-08-11',
      academicDate: '2026-10-24',
      skillDate: '2026-12-12',
      weekdayMinutes: 35,
      weekendMinutes: 150,
      curriculum: realCurriculum,
      progress: {},
    });
    expect(result.compressed).toBe(true);
    expect(result.unplacedRequiredLessonIds.length).toBeGreaterThan(0);
    // 落ちたものは ID で数えられる = UI に出せる。黙って消えていない
    for (const id of result.unplacedRequiredLessonIds) {
      expect(realCurriculum.lessons.some((l) => l.id === id)).toBe(true);
    }
  });
});
