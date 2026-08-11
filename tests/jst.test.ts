import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysUntil,
  dateRange,
  diffDays,
  hasOpened,
  isPast,
  isWeekend,
  jstDateOf,
  jstWeekday,
  nowJstIso,
  todayJst,
} from '../src/domain/jst';

describe('JST 固定の日付処理', () => {
  it('端末が UTC でも JST の暦日を返す', () => {
    // UTC 2026-08-11 16:00 は JST では 2026-08-12 01:00
    expect(todayJst(new Date('2026-08-11T16:00:00Z'))).toBe('2026-08-12');
    // UTC 2026-08-11 14:59 はまだ JST 2026-08-11 23:59
    expect(todayJst(new Date('2026-08-11T14:59:00Z'))).toBe('2026-08-11');
  });

  it('nowJstIso は +09:00 のオフセットを付ける', () => {
    expect(nowJstIso(new Date('2026-08-11T00:00:00Z'))).toBe('2026-08-11T09:00:00+09:00');
  });

  it('曜日を JST で判定する', () => {
    expect(jstWeekday('2026-08-11')).toBe(2); // 火
    expect(isWeekend('2026-08-11')).toBe(false);
    expect(isWeekend('2026-08-15')).toBe(true); // 土
    expect(isWeekend('2026-08-16')).toBe(true); // 日
    expect(isWeekend('2026-08-17')).toBe(false); // 月(申込開始日)
  });

  it('日数の加算・差分・範囲', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(diffDays('2026-08-11', '2026-10-24')).toBe(74);
    expect(diffDays('2026-10-24', '2026-08-11')).toBe(-74);
    expect(dateRange('2026-08-11', '2026-08-13')).toEqual([
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
    ]);
    expect(dateRange('2026-08-13', '2026-08-11')).toEqual([]);
  });

  it('締切は時刻まで見る(申込は 17:00 締切)', () => {
    const deadline = '2026-09-03T17:00:00+09:00';
    expect(isPast(deadline, new Date('2026-09-03T16:59:00+09:00'))).toBe(false);
    expect(isPast(deadline, new Date('2026-09-03T17:01:00+09:00'))).toBe(true);
    // 日付だけで判定していたら「9/3 中はまだ間に合う」と誤表示する
    expect(daysUntil(deadline, new Date('2026-09-03T16:00:00+09:00'))).toBe(0);
  });

  it('受付開始は 10:00 を跨いで初めて開く', () => {
    const opens = '2026-08-17T10:00:00+09:00';
    expect(hasOpened(opens, new Date('2026-08-17T09:59:00+09:00'))).toBe(false);
    expect(hasOpened(opens, new Date('2026-08-17T10:00:00+09:00'))).toBe(true);
    expect(hasOpened(undefined, new Date('2026-01-01T00:00:00+09:00'))).toBe(true);
  });

  it('ISO8601 の瞬間から JST の暦日を取れる', () => {
    expect(jstDateOf('2026-09-03T17:00:00+09:00')).toBe('2026-09-03');
    expect(jstDateOf('2026-09-03T15:30:00Z')).toBe('2026-09-04');
  });
});
