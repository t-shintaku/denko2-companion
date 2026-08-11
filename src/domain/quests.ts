/**
 * 「今日のクエスト」(FR-004)と「次の10分」(§10)。
 *
 * §10 の分岐へ 2 つ足している(README「要件書との差分」に記載):
 * - 期限超過の事務を最上位に置く。原文は「7日以内」しか見ておらず、過ぎたものが落ちる。
 * - 受付開始済み(opensAt <= 今日)の事務を拾う。08-17 の申込開始を出すために必要。
 */

import { addDays, diffDays, todayJst } from './jst';
import { isLessonComplete, modeForBudget } from './lessons';
import type { ResolvedAdminTask } from './adminTasks';
import { actionableAdminTasks } from './adminTasks';
import type { OnboardingState } from './onboarding';
import type {
  Curriculum,
  CurriculumLesson,
  IsoDate,
  LessonMode,
  LessonProgress,
  StudySession,
} from './types';
import type { ScheduleResult } from './schedule';

export type QuestReason =
  | 'admin'
  | 'orientation'
  | 'ungraded-five'
  | 'basics'
  | 'diagnostic'
  | 'comeback'
  | 'lesson'
  | 'review'
  | 'bonus';

export type Quest = {
  id: string;
  reason: QuestReason;
  slot: 'main' | 'review' | 'bonus';
  title: string;
  detail: string;
  /** クリア条件を具体的に表示する(FR-004) */
  clearCondition: string;
  lessonId?: string;
  taskId?: string;
  minutes: number;
  mode: LessonMode;
};

export type QuestContext = {
  today: IsoDate;
  curriculum: Curriculum;
  progress: Record<string, LessonProgress>;
  sessions: StudySession[];
  schedule: ScheduleResult;
  adminTasks: ResolvedAdminTask[];
  onboarding: OnboardingState;
  /** 本人が選んだ今日の持ち時間 */
  budgetMinutes: 10 | 30 | 60;
};

export const COMEBACK_GAP_DAYS = 3;

/** 最終学習日からの空白日数。記録が一度も無ければ undefined */
export function daysSinceLastActivity(
  sessions: StudySession[],
  progress: Record<string, LessonProgress>,
  today: IsoDate = todayJst(),
): number | undefined {
  const dates: IsoDate[] = [];
  for (const s of sessions) dates.push(s.jstDate);
  for (const p of Object.values(progress)) {
    if (p.completedAt) dates.push(p.completedAt.slice(0, 10));
  }
  if (dates.length === 0) return undefined;
  const last = dates.reduce((a, b) => (a > b ? a : b));
  return diffDays(last, today);
}

function lessonById(curriculum: Curriculum, id: string): CurriculumLesson | undefined {
  return curriculum.lessons.find((l) => l.id === id);
}

function prerequisitesMet(
  lesson: CurriculumLesson,
  curriculum: Curriculum,
  progress: Record<string, LessonProgress>,
): boolean {
  return lesson.prerequisites.every((id) => {
    const pre = lessonById(curriculum, id);
    if (!pre) return true;
    return isLessonComplete(pre, progress[id]);
  });
}

/** 今日以降で、着手可能な未完了レッスンを順に返す */
export function availableLessons(ctx: QuestContext): CurriculumLesson[] {
  const { curriculum, progress, schedule, today, onboarding } = ctx;
  const stageOrder: Record<string, number> = {
    orientation: 0,
    'ungraded-five': 1,
    basics: 2,
    diagnostic: 3,
    regular: 4,
  };
  const currentStageRank = stageOrder[onboarding.stage] ?? 4;

  return curriculum.lessons
    .filter((l) => !isLessonComplete(l, progress[l.id]))
    .filter((l) => prerequisitesMet(l, curriculum, progress))
    // 先の段階のレッスンを前面へ出さない(FR-003: 基礎180分前に20問診断を出さない)
    .filter((l) => (stageOrder[l.stage] ?? 4) <= currentStageRank)
    .sort((a, b) => {
      const da = schedule.byLessonId[a.id] ?? '9999-12-31';
      const db = schedule.byLessonId[b.id] ?? '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return a.order - b.order;
    })
    .filter((l) => {
      const d = schedule.byLessonId[l.id];
      // 予定日が未来でも、今日の分が終わっていれば先取りできる。過去日の未完了も拾う。
      return d === undefined || diffDays(today, d) >= -365;
    });
}

function questFromLesson(
  lesson: CurriculumLesson,
  slot: Quest['slot'],
  reason: QuestReason,
  budgetMinutes: number,
): Quest {
  const mode = modeForBudget(budgetMinutes);
  return {
    id: `lesson:${lesson.id}`,
    reason,
    slot,
    title: lesson.title,
    detail: lesson.objective,
    clearCondition: clearConditionFor(lesson),
    lessonId: lesson.id,
    minutes: lesson.estimatedMinutes[mode],
    mode,
  };
}

export function clearConditionFor(lesson: CurriculumLesson): string {
  const practice =
    lesson.practice.targetCount != null
      ? `${lesson.practice.instruction}(目安${lesson.practice.targetCount}問)`
      : lesson.practice.instruction;
  return `見る → 閉じて${lesson.recallPrompts.length || 1}個思い出す → ${practice} → 次に直す1点を保存`;
}

function questFromAdmin(task: ResolvedAdminTask, budgetMinutes: number): Quest {
  return {
    id: `admin:${task.template.id}`,
    reason: 'admin',
    slot: 'main',
    title: task.template.title,
    detail: task.template.description,
    clearCondition: '完了にチェックを入れる(公式サイトで手続きを済ませてから)',
    taskId: task.template.id,
    minutes: Math.min(budgetMinutes, 20),
    mode: modeForBudget(budgetMinutes),
  };
}

/**
 * §10「次の10分」。単一の行動を返す。
 * 同順位なら最終実施日が古いものを優先(availableLessons が予定日順なので実質満たす)。
 */
export function nextTenMinutes(ctx: QuestContext): Quest | undefined {
  const urgent = actionableAdminTasks(ctx.adminTasks);
  const top = urgent[0];
  if (top && (top.urgency === 'overdue' || top.urgency === 'due-1' || top.urgency === 'due-3')) {
    return questFromAdmin(top, 10);
  }
  // 7日以内 / 受付中の事務も学習より先。ただし1件だけ。
  if (top && (top.urgency === 'due-7' || top.urgency === 'open-now')) {
    return questFromAdmin(top, 10);
  }

  const gap = daysSinceLastActivity(ctx.sessions, ctx.progress, ctx.today);
  const lessons = availableLessons(ctx);

  if (gap !== undefined && gap >= COMEBACK_GAP_DAYS) {
    const lesson = lessons[0];
    if (lesson) {
      const quest = questFromLesson(lesson, 'main', 'comeback', 10);
      return {
        ...quest,
        title: `再開の10分 — ${lesson.title}`,
        detail: `${gap}日空いた。失点ではない。10分だけ戻す。`,
      };
    }
  }

  const first = lessons[0];
  if (!first) return undefined;

  const reason: QuestReason =
    ctx.onboarding.stage === 'orientation'
      ? 'orientation'
      : ctx.onboarding.stage === 'ungraded-five'
        ? 'ungraded-five'
        : ctx.onboarding.stage === 'basics'
          ? 'basics'
          : ctx.onboarding.stage === 'diagnostic'
            ? 'diagnostic'
            : 'lesson';
  return questFromLesson(first, 'main', reason, 10);
}

/** ホーム最上部の最大3件(FR-004) */
export function buildTodayQuests(ctx: QuestContext): Quest[] {
  const quests: Quest[] = [];
  const main = nextTenMinutes({ ...ctx, budgetMinutes: ctx.budgetMinutes });
  if (main) {
    const mode = modeForBudget(ctx.budgetMinutes);
    const lesson = main.lessonId ? lessonById(ctx.curriculum, main.lessonId) : undefined;
    quests.push({
      ...main,
      mode,
      minutes: lesson ? lesson.estimatedMinutes[mode] : main.minutes,
    });
  }

  // 2件目: 前日の復習
  const yesterday = addDays(ctx.today, -1);
  const reviewLesson = ctx.curriculum.lessons.find((l) => {
    const p = ctx.progress[l.id];
    return p?.completedAt?.slice(0, 10) === yesterday;
  });
  if (reviewLesson) {
    quests.push({
      id: `review:${reviewLesson.id}`,
      reason: 'review',
      slot: 'review',
      title: `昨日の復習 — ${reviewLesson.title}`,
      detail: '昨日の「1点残す」を読み返し、思い出せるか確かめる。',
      clearCondition: '昨日の Takeaway を見ずに1つ言えたらクリア',
      lessonId: reviewLesson.id,
      minutes: 5,
      mode: 'minimum',
    });
  }

  // 3件目: 余力があるときのボーナス(未完了の任意レッスン、または学科前の技能接触)
  const used = new Set(quests.map((q) => q.lessonId).filter(Boolean));
  const bonus = availableLessons(ctx).find((l) => !used.has(l.id) && (l.skillTouch || !l.required));
  if (bonus && quests.length < 3) {
    quests.push({
      ...questFromLesson(bonus, 'bonus', 'bonus', 10),
      id: `bonus:${bonus.id}`,
      title: `余力があれば — ${bonus.title}`,
    });
  }

  return quests.slice(0, 3);
}

export const REASON_LABEL: Record<QuestReason, string> = {
  admin: '事務',
  orientation: '入口',
  'ungraded-five': '無採点',
  basics: '基礎',
  diagnostic: '診断',
  comeback: '再開',
  lesson: '学習',
  review: '復習',
  bonus: 'ボーナス',
};
