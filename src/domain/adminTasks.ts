/**
 * 事務期限(FR-002)。
 *
 * 要件書 §10 の「7日以内の未完了事務期限」だけでは、
 * 2026-08-17 10:00 の申込"開始"を拾えない(締切は 09-03 なので 7日以内に入らない)。
 * Sprint 1 の最優先が「08-17 の申込開始時点で使えること」なので、
 * opensAt を持たせ、受付開始済み・未完了のタスクを 'open-now' として最上位に出す。
 */

import { addDays, daysUntil, hasOpened, isPast, jstDateTime } from './jst';
import type {
  AdminTaskState,
  AdminTaskTemplate,
  IsoDate,
  IsoDateTime,
  UserSettings,
  ValueSource,
} from './types';

export type AdminUrgency =
  | 'overdue' // 期限を過ぎた。最優先
  | 'open-now' // 受付が始まっていて未完了
  | 'due-1' // 前日
  | 'due-3' // 3日前
  | 'due-7' // 7日前
  | 'upcoming'
  | 'not-open'
  | 'done'
  | 'unknown-due'; // 期限が決まっていない(受験日未設定 等)

export type ResolvedAdminTask = {
  template: AdminTaskTemplate;
  dueAt?: IsoDateTime;
  dueSource: ValueSource;
  needsUserConfirm: boolean;
  opensAt?: IsoDateTime;
  doneAt?: IsoDateTime;
  daysLeft?: number;
  urgency: AdminUrgency;
  applicable: boolean;
};

const URGENCY_RANK: Record<AdminUrgency, number> = {
  overdue: 0,
  'due-1': 1,
  'due-3': 2,
  'open-now': 3,
  'due-7': 4,
  upcoming: 5,
  'unknown-due': 6,
  'not-open': 7,
  done: 8,
};

function anchorDue(
  template: AdminTaskTemplate,
  settings: Pick<UserSettings, 'academicDate' | 'skillDate' | 'academicReservationDeadline'>,
): { dueAt?: IsoDateTime; source: ValueSource } {
  const a = template.anchor;
  if (a.kind === 'fixed') return { dueAt: template.dueAt, source: template.dueSource };

  // CBT 会場予約だけは、本人が公式で確認した期限があればそれを最優先で使う
  if (template.id === 'cbt-reservation' && settings.academicReservationDeadline) {
    return { dueAt: jstDateTime(settings.academicReservationDeadline, '23:59'), source: 'user' };
  }

  const base: IsoDate | undefined = a.kind === 'academic' ? settings.academicDate : settings.skillDate;
  if (!base) return { dueAt: undefined, source: template.dueSource };
  return { dueAt: jstDateTime(addDays(base, a.offsetDays), '23:59'), source: template.dueSource };
}

export function resolveAdminTasks(
  templates: AdminTaskTemplate[],
  states: Record<string, AdminTaskState>,
  settings: Pick<
    UserSettings,
    'academicMode' | 'academicDate' | 'skillDate' | 'academicReservationDeadline'
  >,
  now: Date = new Date(),
): ResolvedAdminTask[] {
  return templates
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((template) => {
      const state = states[template.id];
      const override = state?.dueOverrideAt;
      const anchored = anchorDue(template, settings);
      const dueAt = override ?? anchored.dueAt;
      const dueSource: ValueSource = override ? 'user' : anchored.source;
      const applicable =
        !template.appliesTo ||
        settings.academicMode === 'undecided' ||
        template.appliesTo === settings.academicMode;

      let urgency: AdminUrgency;
      let daysLeft: number | undefined;
      if (state?.doneAt) {
        urgency = 'done';
      } else if (!hasOpened(template.opensAt, now)) {
        urgency = 'not-open';
      } else if (!dueAt) {
        urgency = 'unknown-due';
      } else if (isPast(dueAt, now)) {
        urgency = 'overdue';
      } else {
        daysLeft = daysUntil(dueAt, now);
        if (daysLeft <= 1) urgency = 'due-1';
        else if (daysLeft <= 3) urgency = 'due-3';
        else if (daysLeft <= 7) urgency = 'due-7';
        else urgency = template.opensAt ? 'open-now' : 'upcoming';
      }

      return {
        template,
        dueAt,
        dueSource,
        needsUserConfirm: template.needsUserConfirm && dueSource !== 'user',
        opensAt: template.opensAt,
        doneAt: state?.doneAt,
        daysLeft,
        urgency,
        applicable,
      };
    });
}

/** 表示・クエスト用の優先順。緊急なものから */
export function sortByUrgency(tasks: ResolvedAdminTask[]): ResolvedAdminTask[] {
  return tasks
    .slice()
    .sort(
      (a, b) =>
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.template.order - b.template.order,
    );
}

/** クエストへ昇格させるべき事務タスク(未完了かつ着手可能) */
export function actionableAdminTasks(tasks: ResolvedAdminTask[]): ResolvedAdminTask[] {
  return sortByUrgency(
    tasks.filter(
      (t) =>
        t.applicable &&
        t.urgency !== 'done' &&
        t.urgency !== 'not-open' &&
        t.urgency !== 'upcoming' &&
        t.urgency !== 'unknown-due',
    ),
  );
}

export const URGENCY_LABEL: Record<AdminUrgency, string> = {
  overdue: '期限超過',
  'due-1': '明日まで',
  'due-3': '3日以内',
  'due-7': '7日以内',
  'open-now': '受付中',
  upcoming: '先の予定',
  'not-open': '受付前',
  done: '完了',
  'unknown-due': '期限未設定',
};
