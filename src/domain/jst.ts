/**
 * JST(Asia/Tokyo)固定の日付ユーティリティ。
 *
 * 端末のタイムゾーンに依存しないこと。試験の締切は日本時間で切られるので、
 * 「今日」の定義がずれると事務期限の警告が丸1日ずれる(§13 信頼性: 日付境界)。
 * date-fns-tz を入れずに Intl だけで完結させている(依存を減らす判断。README参照)。
 */

import type { IsoDate, IsoDateTime } from './types';

const JST_OFFSET_MINUTES = 9 * 60;

const jstDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date → JST の 'YYYY-MM-DD' */
export function toJstDate(instant: Date): IsoDate {
  return jstDateFormatter.format(instant);
}

/** 今日(JST)。テストしやすいよう now を注入できる */
export function todayJst(now: Date = new Date()): IsoDate {
  return toJstDate(now);
}

/** 現在時刻を JST オフセット付き ISO8601 で返す */
export function nowJstIso(now: Date = new Date()): IsoDateTime {
  const shifted = new Date(now.getTime() + JST_OFFSET_MINUTES * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' を JST 00:00 の瞬間として Date にする */
export function jstDateToInstant(date: IsoDate): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid IsoDate: ${date}`);
  return new Date(`${date}T00:00:00+09:00`);
}

/** IsoDate + days */
export function addDays(date: IsoDate, days: number): IsoDate {
  const base = jstDateToInstant(date);
  return toJstDate(new Date(base.getTime() + days * 86_400_000));
}

/** b - a を日数で返す(JST の暦日差) */
export function diffDays(a: IsoDate, b: IsoDate): number {
  const ms = jstDateToInstant(b).getTime() - jstDateToInstant(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** from から to まで(両端含む)の日付列。to < from なら空 */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const n = diffDays(from, to);
  if (n < 0) return [];
  const out: IsoDate[] = [];
  for (let i = 0; i <= n; i += 1) out.push(addDays(from, i));
  return out;
}

/** JST の曜日。0=日曜 */
export function jstWeekday(date: IsoDate): number {
  // JST 00:00 の瞬間を UTC で見ると前日15:00。getUTCDay ではなく +9h して判定する。
  const shifted = new Date(jstDateToInstant(date).getTime() + JST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const d = jstWeekday(date);
  return d === 0 || d === 6;
}

/** ISO8601(オフセット付き)の瞬間が属する JST の暦日 */
export function jstDateOf(instant: IsoDateTime): IsoDate {
  return toJstDate(new Date(instant));
}

/** now から dateTime までの残り日数(JST 暦日ベース)。過ぎていれば負 */
export function daysUntil(dateTime: IsoDateTime, now: Date = new Date()): number {
  return diffDays(todayJst(now), jstDateOf(dateTime));
}

/** 締切を過ぎたか。時刻まで見る(申込は 17:00 締切) */
export function isPast(dateTime: IsoDateTime, now: Date = new Date()): boolean {
  return new Date(dateTime).getTime() < now.getTime();
}

/** 受付開始済みか */
export function hasOpened(dateTime: IsoDateTime | undefined, now: Date = new Date()): boolean {
  if (!dateTime) return true;
  return new Date(dateTime).getTime() <= now.getTime();
}

const displayFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

export function formatJstShort(date: IsoDate): string {
  return displayFormatter.format(jstDateToInstant(date));
}

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatJstDateTime(dateTime: IsoDateTime): string {
  return dateTimeFormatter.format(new Date(dateTime));
}

/** JST の 'YYYY-MM-DD' + 'HH:mm' を オフセット付き ISO8601 に */
export function jstDateTime(date: IsoDate, time: string): IsoDateTime {
  return `${date}T${time}:00+09:00`;
}
