import { describe, expect, it } from 'vitest';
import { adminTaskTemplates } from '../src/data';
import { resolveAdminTasks } from '../src/domain/adminTasks';
import { buildIcs, toIcsUtc } from '../src/domain/ics';

const settings = {
  academicMode: 'cbt' as const,
  academicDate: '2026-10-24',
  skillDate: '2026-12-12',
};

function ics(now: Date, states = {}) {
  return buildIcs(resolveAdminTasks(adminTaskTemplates, states, settings, now), now);
}

describe('期限のカレンダー出力(FR-002 ICS)', () => {
  it('JSTの期限をUTCへ正しく変換する', () => {
    expect(toIcsUtc('2026-09-03T17:00:00+09:00')).toBe('20260903T080000Z');
    expect(toIcsUtc('2026-10-14T23:59:00+09:00')).toBe('20261014T145900Z');
  });

  it('VCALENDAR として最低限の体裁を満たす', () => {
    const out = ics(new Date('2026-08-17T10:30:00+09:00'));
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(out).toContain('VERSION:2.0');
    // 改行は CRLF
    expect(out.includes('\r\n')).toBe(true);
  });

  it('申込・入金・CBT予約の公式期限が入る', () => {
    const out = ics(new Date('2026-08-17T10:30:00+09:00'));
    expect(out).toContain('DTSTART:20260903T080000Z'); // 申込 9/3 17:00
    expect(out).toContain('DTSTART:20260904T080000Z'); // 入金 9/4 17:00
    expect(out).toContain('DTSTART:20261014T145900Z'); // CBT予約 10/14 23:59
    expect(out).toContain('UID:denko2-application@denko2-companion');
  });

  it('7日前と前日の通知が付く(アプリを開かなくても届く)', () => {
    const out = ics(new Date('2026-08-17T10:30:00+09:00'));
    expect(out).toContain('TRIGGER:-P7D');
    expect(out).toContain('TRIGGER:-P1D');
  });

  it('完了した手続きは出力しない', () => {
    const out = ics(new Date('2026-08-18T10:00:00+09:00'), {
      application: { taskId: 'application', doneAt: '2026-08-17T11:00:00+09:00', updatedAt: '' },
    });
    expect(out).not.toContain('UID:denko2-application@denko2-companion');
    expect(out).toContain('UID:denko2-payment@denko2-companion');
  });

  it('筆記方式ならCBT会場予約を出力しない', () => {
    const out = buildIcs(
      resolveAdminTasks(
        adminTaskTemplates,
        {},
        { ...settings, academicMode: 'paper' },
        new Date('2026-08-17T10:30:00+09:00'),
      ),
      new Date('2026-08-17T10:30:00+09:00'),
    );
    expect(out).not.toContain('UID:denko2-cbt-reservation@denko2-companion');
  });

  it('期限の出どころを本文に書く(公式と推定を混ぜない)', () => {
    const out = ics(new Date('2026-08-17T10:30:00+09:00'));
    expect(out).toContain('期限の出どころ: 公式');
  });
});
