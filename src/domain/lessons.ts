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
  IsoDateTime,
  LessonMode,
  LessonProgress,
  RecallMark,
} from './types';

export type LessonStep = 'input' | 'recall' | 'practice' | 'takeaway';

export const LESSON_STEPS: LessonStep[] = ['input', 'recall', 'practice', 'takeaway'];

export const STEP_LABEL: Record<LessonStep, string> = {
  input: 'まず見る',
  recall: '見ないで思い出す',
  practice: '手を動かす',
  takeaway: '次へひとこと',
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
    recallSelfMarks?: (RecallMark | undefined)[];
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
      // 押していない項目は記録しない。'partial' に化けさせると、
      // 本人が付けていない評価が「ちょっと惜しい」として残る
      base.recallSelfMarks = payload.recallSelfMarks ?? [];
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

/**
 * その段階だけにかかる目安(分)。
 *
 * カリキュラムが `stepMinutes` を明示している段階は、比率配分を使わずその値を出す。
 * 120分の模試や40分の候補問題は作業時間が動かない。比率で割ると「18分」「12分」になり、
 * 作業を短くしたのではなく表示だけを縮めることになる。
 * 明示のない段階だけ、レッスン全体の見積を必須段階の比で割る。
 */
export function stepMinutes(
  lesson: CurriculumLesson,
  mode: LessonMode,
  step: LessonStep,
): number {
  const steps = requiredSteps(lesson);
  if (!steps.includes(step)) return 0;
  const fixed = lesson.stepMinutes?.[step];
  if (fixed !== undefined) return fixed;
  const fixedSteps = steps.filter((s) => lesson.stepMinutes?.[s] !== undefined);
  const fixedTotal = fixedSteps.reduce((n, s) => n + (lesson.stepMinutes?.[s] ?? 0), 0);
  const rest = steps.filter((s) => !fixedSteps.includes(s));
  const sum = rest.reduce((n, s) => n + STEP_WEIGHT[s], 0);
  // 固定した段階の分を差し引いた残りを、残りの段階で分ける。
  // 引きすぎて 0 以下にならないよう、必ず1分以上は出す
  const remainder = Math.max(rest.length, minutesFor(lesson, mode) - fixedTotal);
  return Math.max(1, Math.round((remainder * STEP_WEIGHT[step]) / sum));
}

/** 明示時間を持つ段階の合計(分)。持たないレッスンは 0 */
export function fixedMinutes(lesson: CurriculumLesson): number {
  return requiredSteps(lesson).reduce((n, s) => n + (lesson.stepMinutes?.[s] ?? 0), 0);
}

/**
 * 1日の枠に対して数える所要(分)。
 * 見積が明示時間より小さいことは許さない。40分の施工を含むレッスンを
 * 「30分」として1日に2本積むと、その日の計画が最初から嘘になる。
 */
export function scheduleCost(lesson: CurriculumLesson): number {
  return Math.max(minutesFor(lesson, 'standard'), fixedMinutes(lesson));
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

/**
 * 「見ないで思い出す」で言えなかった項目(FR-007の受け側)。
 *
 * レビュー指摘: ○△×を保存していたのに、読み出して使う場所がどこにも無かった。
 * 画面が「次の自分へのひとことに残しておこう」と手作業を案内しているだけで、
 * 仕組みではなく努力目標になっていた。**効いているように見えて効いていない**のが
 * いちばん悪い状態なので、ここで拾って画面へ出す。
 *
 * 合格準備度(科目別正答率)には入れない。自己申告の自由記述だから。
 */
export type RecallGap = {
  lessonId: string;
  lessonTitle: string;
  promptId: string;
  prompt: string;
  modelAnswer: string;
  mark: Exclude<RecallMark, 'ok'>;
  /** 最後に答えた日時 */
  at: IsoDateTime;
};

export function recallGaps(
  lessons: CurriculumLesson[],
  progress: Record<string, LessonProgress>,
  limit = 12,
): RecallGap[] {
  const gaps: RecallGap[] = [];
  for (const lesson of lessons) {
    const p = progress[lesson.id];
    if (!p?.recallSelfMarks || !p.recallSubmittedAt) continue;
    lesson.recallPrompts.forEach((prompt, i) => {
      const mark = p.recallSelfMarks?.[i];
      if (mark !== 'partial' && mark !== 'miss') return;
      gaps.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        promptId: prompt.id,
        prompt: prompt.prompt,
        modelAnswer: prompt.modelAnswer,
        mark,
        at: p.recallSubmittedAt!,
      });
    });
  }
  // 出てこなかったものを先に、そのあと新しい順
  return gaps
    .sort((a, b) => {
      const rank = (g: RecallGap) => (g.mark === 'miss' ? 0 : 1);
      return rank(a) - rank(b) || (a.at < b.at ? 1 : -1);
    })
    .slice(0, limit);
}
