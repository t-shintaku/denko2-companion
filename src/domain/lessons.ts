/**
 * レッスン完了判定(FR-007 / §5.2 / AT-003)。
 *
 * complete = input viewed AND recall submitted AND practice submitted AND one takeaway saved
 * 動画を開いただけでは完了にもXPにもならない。ここが緩んだ瞬間、
 * このツールは「動画リンク集」に退化する(要件書 §1.2)。
 */

import { nowJstIso } from './jst';
import { DEFAULT_COMPLETION_RULE } from './types';
import type {
  CompletionRule,
  CurriculumLesson,
  LessonMode,
  LessonProgress,
} from './types';

export type LessonStep = 'input' | 'recall' | 'practice' | 'takeaway';

export const LESSON_STEPS: LessonStep[] = ['input', 'recall', 'practice', 'takeaway'];

export const STEP_LABEL: Record<LessonStep, string> = {
  input: '見る',
  recall: '閉じて答える',
  practice: '解く／作る',
  takeaway: '1点残す',
};

/** 完了時に付与するXP。動画視聴のみ(input だけ)は 0 */
export const LESSON_COMPLETE_XP = 10;

export function ruleFor(lesson: CurriculumLesson): CompletionRule {
  return { ...DEFAULT_COMPLETION_RULE, ...(lesson.completionRule ?? {}) };
}

export function emptyProgress(lessonId: string, now: Date = new Date()): LessonProgress {
  return { lessonId, xpAwarded: 0, updatedAt: nowJstIso(now) };
}

export function stepDone(progress: LessonProgress | undefined, step: LessonStep): boolean {
  if (!progress) return false;
  switch (step) {
    case 'input':
      return Boolean(progress.inputViewedAt);
    case 'recall':
      return Boolean(progress.recallSubmittedAt);
    case 'practice':
      return Boolean(progress.practiceSubmittedAt);
    case 'takeaway':
      return Boolean(progress.takeawaySavedAt);
  }
}

export function requiredSteps(lesson: CurriculumLesson): LessonStep[] {
  const rule = ruleFor(lesson);
  const map: Record<LessonStep, boolean> = {
    input: rule.requireInput,
    recall: rule.requireRecall,
    practice: rule.requirePractice,
    takeaway: rule.requireTakeaway,
  };
  return LESSON_STEPS.filter((s) => map[s]);
}

export function isLessonComplete(
  lesson: CurriculumLesson,
  progress: LessonProgress | undefined,
): boolean {
  if (!progress) return false;
  return requiredSteps(lesson).every((step) => stepDone(progress, step));
}

export function completionRatio(
  lesson: CurriculumLesson,
  progress: LessonProgress | undefined,
): number {
  const steps = requiredSteps(lesson);
  if (steps.length === 0) return 1;
  const done = steps.filter((s) => stepDone(progress, s)).length;
  return done / steps.length;
}

export function nextStep(
  lesson: CurriculumLesson,
  progress: LessonProgress | undefined,
): LessonStep | undefined {
  return requiredSteps(lesson).find((s) => !stepDone(progress, s));
}

/**
 * 4段階のいずれかを記録した進捗を返す(純関数)。
 * 完了条件を満たしたときだけ completedAt と XP を立てる。
 */
export function applyStep(
  lesson: CurriculumLesson,
  current: LessonProgress | undefined,
  step: LessonStep,
  payload: {
    mode?: LessonMode;
    recallAnswers?: string[];
    practiceNote?: string;
    practiceCorrect?: number;
    practiceTotal?: number;
    takeaway?: string;
  } = {},
  now: Date = new Date(),
): LessonProgress {
  const stamp = nowJstIso(now);
  const base: LessonProgress = current
    ? { ...current }
    : emptyProgress(lesson.id, now);

  if (payload.mode) base.mode = payload.mode;

  switch (step) {
    case 'input':
      base.inputViewedAt = stamp;
      break;
    case 'recall':
      base.recallSubmittedAt = stamp;
      base.recallAnswers = payload.recallAnswers ?? [];
      break;
    case 'practice':
      base.practiceSubmittedAt = stamp;
      if (payload.practiceNote !== undefined) base.practiceNote = payload.practiceNote;
      if (payload.practiceCorrect !== undefined) base.practiceCorrect = payload.practiceCorrect;
      if (payload.practiceTotal !== undefined) base.practiceTotal = payload.practiceTotal;
      break;
    case 'takeaway':
      base.takeawaySavedAt = stamp;
      base.takeaway = payload.takeaway ?? '';
      break;
  }

  base.updatedAt = stamp;

  if (isLessonComplete(lesson, base)) {
    if (!base.completedAt) {
      base.completedAt = stamp;
      base.xpAwarded = LESSON_COMPLETE_XP;
    }
  } else {
    // 未完了へ戻した場合(将来の取り消し操作)に XP を残さない
    base.completedAt = undefined;
    base.xpAwarded = 0;
  }

  return base;
}

export function minutesFor(lesson: CurriculumLesson, mode: LessonMode): number {
  return lesson.estimatedMinutes[mode];
}

/**
 * 段階ごとの時間配分。レッスン全体の見積をこの比で割る。
 *
 * なぜ要るか: 10分モードでも見積が10分を超えるレッスンが **28/54本**(最大60分)ある。
 * レッスン1本を「次の10分」として出すと、10分と言いながら60分の作業を渡すことになる。
 * 段階単位で出すと超過は **22/216段階** まで落ちる(実カリキュラムで計測)。
 *
 * 比率は「見て理解する」が最も重く、「1点残す」が最も軽いという実作業の形から置いた目安。
 * 実績時間は別途 measuredMinutes で実測しているので、これは提示用の目安に留まる。
 */
export const STEP_WEIGHT: Record<LessonStep, number> = {
  input: 0.45,
  recall: 0.15,
  practice: 0.3,
  takeaway: 0.1,
};

/** その段階だけにかかる目安(分)。必須でない段階を除いた比で割り直す */
export function stepMinutes(
  lesson: CurriculumLesson,
  mode: LessonMode,
  step: LessonStep,
): number {
  const steps = requiredSteps(lesson);
  if (!steps.includes(step)) return 0;
  const sum = steps.reduce((n, s) => n + STEP_WEIGHT[s], 0);
  return Math.max(1, Math.round((minutesFor(lesson, mode) * STEP_WEIGHT[step]) / sum));
}

/** 残っている段階の合計(分) */
export function remainingMinutes(
  lesson: CurriculumLesson,
  mode: LessonMode,
  progress: LessonProgress | undefined,
): number {
  return requiredSteps(lesson)
    .filter((s) => !stepDone(progress, s))
    .reduce((n, s) => n + stepMinutes(lesson, mode, s), 0);
}

export type LessonPlan = {
  /** 次にやる段階。全部終わっていれば undefined */
  step?: LessonStep;
  /** この一手にかかる目安(分)。残り全部ではなく「次の1段階」 */
  minutes: number;
  /** 残り全部の目安(分) */
  remaining: number;
  /** 与えられた持ち時間に、次の1段階が収まるか */
  fitsBudget: boolean;
};

/**
 * 持ち時間に対して「次の一手」を決める。
 * 収まらないときも作業は返すが、**fitsBudget=false を必ず添える**。
 * 呼び出し側が「10分」と言い切ってよいかどうかを、ここの真偽で判断する。
 */
export function planForBudget(
  lesson: CurriculumLesson,
  mode: LessonMode,
  progress: LessonProgress | undefined,
  budgetMinutes: number,
): LessonPlan {
  const remaining = remainingMinutes(lesson, mode, progress);
  const step = nextStep(lesson, progress);
  if (!step) return { minutes: 0, remaining: 0, fitsBudget: true };
  const minutes = stepMinutes(lesson, mode, step);
  return { step, minutes, remaining, fitsBudget: minutes <= budgetMinutes };
}

export const MODE_LABEL: Record<LessonMode, string> = {
  minimum: '10分',
  standard: '30分',
  deep: '60分',
};

export function modeForBudget(minutes: number): LessonMode {
  if (minutes <= 15) return 'minimum';
  if (minutes <= 45) return 'standard';
  return 'deep';
}
