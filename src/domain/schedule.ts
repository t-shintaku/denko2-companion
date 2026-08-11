/**
 * カリキュラム配置エンジン(FR-005)。
 *
 * 不変条件:
 * 1. カリキュラムJSONは絶対日付を持たない。開始日と受験日から毎回計算する。
 * 2. 1日の容量(平日/休日)を超えて積まない → 欠席分を翌日へ全積みしない(AT-004)。
 * 3. required なレッスンは絶対に黙って落とさない。入らなければ compressed 警告として表に出す。
 * 4. 完了済みレッスンは配置対象から外す。つまり「今日から先へ」毎回引き直す。
 */

import { addDays, dateRange, diffDays, isWeekend } from './jst';
import type {
  Curriculum,
  CurriculumLesson,
  CurriculumPhase,
  IsoDate,
  LessonProgress,
} from './types';

export type ScheduleInput = {
  today: IsoDate;
  startDate: IsoDate;
  academicDate?: IsoDate;
  skillDate?: IsoDate;
  weekdayMinutes: number;
  weekendMinutes: number;
  curriculum: Curriculum;
  progress: Record<string, LessonProgress>;
};

export type ScheduledDay = {
  date: IsoDate;
  capacityMinutes: number;
  usedMinutes: number;
  lessonIds: string[];
};

export type ScheduleResult = {
  days: ScheduledDay[];
  byLessonId: Record<string, IsoDate>;
  /** 容量に入り切らなかった必須レッスン。UIで必ず警告する */
  unplacedRequiredLessonIds: string[];
  /** 容量不足で外した任意レッスン */
  droppedOptionalLessonIds: string[];
  /** どの1日の容量にも収まらないレッスン。時間設定を見直すか分割が要る */
  oversizedLessonIds: string[];
  compressed: boolean;
  /** 学科セグメントの残り日数(受験日未定なら undefined) */
  academicDaysLeft?: number;
};

function isComplete(progress: LessonProgress | undefined): boolean {
  return Boolean(progress?.completedAt);
}

function capacityOf(date: IsoDate, weekdayMinutes: number, weekendMinutes: number): number {
  return isWeekend(date) ? weekendMinutes : weekdayMinutes;
}

function makeDays(
  from: IsoDate,
  to: IsoDate,
  weekdayMinutes: number,
  weekendMinutes: number,
): ScheduledDay[] {
  return dateRange(from, to).map((date) => ({
    date,
    capacityMinutes: capacityOf(date, weekdayMinutes, weekendMinutes),
    usedMinutes: 0,
    lessonIds: [],
  }));
}

/**
 * 1日の容量を超えたら置かない。例外を作らない。
 *
 * 以前は「空の日なら容量超過でも1件は置く」という逃げを入れていたが、
 * それだと平日35分の日に120分の模試が載る。載った時点でその日の計画は嘘になり、
 * 「今日やること」を信じられなくなる。入る日が無いなら unplaced として表に出す。
 */
function place(day: ScheduledDay, lesson: CurriculumLesson): boolean {
  const cost = lesson.estimatedMinutes.standard;
  if (day.usedMinutes + cost > day.capacityMinutes) return false;
  day.lessonIds.push(lesson.id);
  day.usedMinutes += cost;
  return true;
}

/** フェーズを順序どおりに並べ、セグメントで分ける */
function phasesOf(curriculum: Curriculum, segment: 'academic' | 'skill'): CurriculumPhase[] {
  return curriculum.phases
    .filter((p) => p.segment === segment)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function lessonsOf(
  curriculum: Curriculum,
  phase: CurriculumPhase,
  progress: Record<string, LessonProgress>,
): CurriculumLesson[] {
  return curriculum.lessons
    .filter((l) => l.phaseId === phase.id && !isComplete(progress[l.id]))
    .slice()
    .sort((a, b) => a.order - b.order);
}

type SegmentPlan = {
  days: ScheduledDay[];
  /** 末尾に予約されたフェーズ(直前期)。先に後ろから詰める */
  tailPhases: CurriculumPhase[];
  headPhases: CurriculumPhase[];
  flowPhases: CurriculumPhase[];
};

function planSegment(
  curriculum: Curriculum,
  segment: 'academic' | 'skill',
  from: IsoDate,
  to: IsoDate,
  weekdayMinutes: number,
  weekendMinutes: number,
): SegmentPlan {
  const days = makeDays(from, to, weekdayMinutes, weekendMinutes);
  const phases = phasesOf(curriculum, segment);
  const headPhases: CurriculumPhase[] = [];
  const flowPhases: CurriculumPhase[] = [];
  const tailPhases: CurriculumPhase[] = [];
  for (const phase of phases) {
    switch (phase.anchor.kind) {
      case 'start':
        headPhases.push(phase);
        break;
      case 'before-academic':
      case 'before-skill':
        tailPhases.push(phase);
        break;
      default:
        flowPhases.push(phase);
    }
  }
  return { days, headPhases, flowPhases, tailPhases };
}

function tailDurationDays(phase: CurriculumPhase): number {
  const a = phase.anchor;
  if (a.kind === 'before-academic' || a.kind === 'before-skill') return a.durationDays;
  return 0;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const {
    today,
    startDate,
    academicDate,
    skillDate,
    weekdayMinutes,
    weekendMinutes,
    curriculum,
    progress,
  } = input;

  const unplacedRequiredLessonIds: string[] = [];
  const droppedOptionalLessonIds: string[] = [];
  const allDays: ScheduledDay[] = [];

  // 配置の起点は「今日」。過去日へ積み直さない。開始日が未来なら開始日から。
  const windowStart = diffDays(today, startDate) > 0 ? startDate : today;

  // --- 学科セグメント -------------------------------------------------------
  // 受験日未定でも学習は止めない。仮の地平線として 8 週間を置く。
  const academicEnd = academicDate ?? addDays(windowStart, 56);
  if (diffDays(windowStart, academicEnd) >= 0) {
    const plan = planSegment(
      curriculum,
      'academic',
      windowStart,
      academicEnd,
      weekdayMinutes,
      weekendMinutes,
    );
    fillSegment(plan, curriculum, progress, unplacedRequiredLessonIds, droppedOptionalLessonIds);
    allDays.push(...plan.days);
  }

  // --- 技能セグメント -------------------------------------------------------
  if (academicDate && skillDate && diffDays(academicDate, skillDate) > 0) {
    const plan = planSegment(
      curriculum,
      'skill',
      addDays(academicDate, 1),
      skillDate,
      weekdayMinutes,
      weekendMinutes,
    );
    fillSegment(plan, curriculum, progress, unplacedRequiredLessonIds, droppedOptionalLessonIds);
    allDays.push(...plan.days);
  }

  const byLessonId: Record<string, IsoDate> = {};
  for (const day of allDays) {
    for (const id of day.lessonIds) byLessonId[id] = day.date;
  }

  // 「入り切らなかった」の原因を分ける。日数不足なのか、1日の枠より重いのか。
  const maxCapacity = allDays.reduce((m, d) => Math.max(m, d.capacityMinutes), 0);
  const oversizedLessonIds = [...unplacedRequiredLessonIds, ...droppedOptionalLessonIds].filter(
    (id) => {
      const l = curriculum.lessons.find((x) => x.id === id);
      return l !== undefined && l.estimatedMinutes.standard > maxCapacity;
    },
  );

  return {
    days: allDays,
    byLessonId,
    unplacedRequiredLessonIds,
    droppedOptionalLessonIds,
    oversizedLessonIds,
    compressed: unplacedRequiredLessonIds.length > 0 || droppedOptionalLessonIds.length > 0,
    academicDaysLeft: academicDate ? diffDays(today, academicDate) : undefined,
  };
}

function fillSegment(
  plan: SegmentPlan,
  curriculum: Curriculum,
  progress: Record<string, LessonProgress>,
  unplacedRequired: string[],
  droppedOptional: string[],
): void {
  const { days } = plan;
  if (days.length === 0) return;

  const ordered = [...plan.headPhases, ...plan.flowPhases].sort((a, b) => a.order - b.order);
  const frontLessonCount = ordered.reduce(
    (n, phase) => n + lessonsOf(curriculum, phase, progress).length,
    0,
  );

  // 1) 直前期フェーズを末尾から予約する(学科直前/技能直前を必ず試験直前に置く)
  let tailBoundary = days.length;
  for (const phase of [...plan.tailPhases].reverse()) {
    const lessons = lessonsOf(curriculum, phase, progress);
    // 残っていない直前期のために日を空けない(全部やり終えたのに窓だけ塞ぐのを防ぐ)
    if (lessons.length === 0) continue;
    // 期間が短いとき、直前期が窓を食い尽くして本編が1本も置けなくなるのを防ぐ
    const maxSpan = frontLessonCount > 0 ? Math.max(1, Math.floor(days.length / 2)) : tailBoundary;
    const span = Math.min(tailDurationDays(phase), maxSpan, tailBoundary);
    const start = Math.max(0, tailBoundary - span);
    fillTwoPass(days.slice(start, tailBoundary), [lessons], unplacedRequired, droppedOptional);
    tailBoundary = start;
  }

  // 2) 前方フェーズ(入口)→ 3) 流し込みフェーズ、の順で前から詰める
  const front = days.slice(0, tailBoundary);
  fillTwoPass(
    front,
    ordered.map((phase) => lessonsOf(curriculum, phase, progress)),
    unplacedRequired,
    droppedOptional,
  );
}

/**
 * 必須を先に、任意を後に置く2パス。
 * 容量が足りないとき、順番の都合で必須が押し出されて任意が残る事態を防ぐ
 * (FR-005「必須範囲を黙って削除しない」)。
 */
function fillTwoPass(
  days: ScheduledDay[],
  lessonGroups: CurriculumLesson[][],
  unplacedRequired: string[],
  droppedOptional: string[],
): void {
  const required = lessonGroups.flatMap((g) => g.filter((l) => l.required));
  const optional = lessonGroups.flatMap((g) => g.filter((l) => !l.required));
  classifyLeftovers(fillDays(days, required), unplacedRequired, droppedOptional);
  classifyLeftovers(fillDays(days, optional), unplacedRequired, droppedOptional);
}

/** 与えられた日の並びへ順に詰める。入り切らなかったレッスンを返す */
function fillDays(days: ScheduledDay[], lessons: CurriculumLesson[]): CurriculumLesson[] {
  const leftovers: CurriculumLesson[] = [];
  let cursor = 0;
  for (const lesson of lessons) {
    let placed = false;
    while (cursor < days.length) {
      const day = days[cursor];
      if (day && place(day, lesson)) {
        placed = true;
        break;
      }
      cursor += 1;
    }
    if (!placed) leftovers.push(lesson);
  }
  return leftovers;
}

function classifyLeftovers(
  leftovers: CurriculumLesson[],
  unplacedRequired: string[],
  droppedOptional: string[],
): void {
  for (const lesson of leftovers) {
    if (lesson.required) unplacedRequired.push(lesson.id);
    else droppedOptional.push(lesson.id);
  }
}

/** 指定日に配置されたレッスンID */
export function lessonsOnDate(result: ScheduleResult, date: IsoDate): string[] {
  return result.days.find((d) => d.date === date)?.lessonIds ?? [];
}
