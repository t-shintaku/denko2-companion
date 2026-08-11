import { describe, expect, it } from 'vitest';
import { actionableAdminTasks, resolveAdminTasks, sortByUrgency } from '../src/domain/adminTasks';
import { adminTaskTemplates, examCycle } from '../src/data';
import type { AdminTaskState } from '../src/domain/types';

const settings = {
  academicMode: 'cbt' as const,
  academicDate: '2026-10-24',
  skillDate: '2026-12-12',
};

function resolve(now: Date, states: Record<string, AdminTaskState> = {}) {
  return resolveAdminTasks(adminTaskTemplates, states, settings, now);
}

function byId(tasks: ReturnType<typeof resolve>, id: string) {
  const found = tasks.find((t) => t.template.id === id);
  if (!found) throw new Error(`task not found: ${id}`);
  return found;
}

describe('AT-001 事務期限', () => {
  it('令和8年度下期の日程が受験案内PDFの記載と一致する', () => {
    // 出典: https://www.shiken.or.jp/construction/upload/r8kmousikomiannai1.pdf(2026-08-11 本文確認)
    expect(examCycle.applicationStart).toBe('2026-08-17T10:00:00+09:00');
    expect(examCycle.applicationDeadline).toBe('2026-09-03T17:00:00+09:00');
    expect(examCycle.paymentDeadline).toBe('2026-09-04T17:00:00+09:00');
    expect(examCycle.cbtReservationStart).toBe('2026-09-09T10:00:00+09:00');
    expect(examCycle.cbtReservationDeadline).toBe('2026-10-14T23:59:00+09:00');
    expect(examCycle.cbtWindowStart).toBe('2026-09-24');
    expect(examCycle.cbtWindowEnd).toBe('2026-11-08');
    expect(examCycle.writtenExamDate).toBe('2026-10-25');
    expect(examCycle.skillExamDates).toEqual(['2026-12-12', '2026-12-13']);
    expect(examCycle.skillResultAnnouncement).toBe('2027-01-15T12:00:00+09:00');
    expect(examCycle.examFeeInternetYen).toBe(11100);
    // 一次資料の本文を読んで確認した値であることを型で残す
    expect(examCycle.verification).toBe('fetched');
  });

  it('CBT予約期間は学科試験期間より前に閉じる(逆算では作れない関係)', () => {
    expect(examCycle.cbtReservationDeadline < `${examCycle.cbtWindowEnd}T00:00:00+09:00`).toBe(true);
    expect(examCycle.applicationDeadline < examCycle.paymentDeadline).toBe(true);
  });

  it('申込開始前は「受付前」で、クエストに昇格しない', () => {
    const tasks = resolve(new Date('2026-08-11T12:00:00+09:00'));
    expect(byId(tasks, 'application').urgency).toBe('not-open');
    expect(actionableAdminTasks(tasks).some((t) => t.template.id === 'application')).toBe(false);
  });

  it('2026-08-17 10:00 を過ぎた瞬間に申込みが「受付中」で最優先に出る', () => {
    const before = resolve(new Date('2026-08-17T09:59:00+09:00'));
    expect(byId(before, 'application').urgency).toBe('not-open');

    const after = resolve(new Date('2026-08-17T10:00:00+09:00'));
    expect(byId(after, 'application').urgency).toBe('open-now');
    // 締切(09-03)まで17日あり「7日以内」では拾えない。ここが要件書 §10 の穴
    expect(byId(after, 'application').daysLeft).toBe(17);
    expect(actionableAdminTasks(after)[0]?.template.id).toBe('mypage');
  });

  it('締切7日前・3日前・前日で段階が上がる', () => {
    expect(byId(resolve(new Date('2026-08-28T12:00:00+09:00')), 'application').urgency).toBe('due-7');
    expect(byId(resolve(new Date('2026-09-01T12:00:00+09:00')), 'application').urgency).toBe('due-3');
    expect(byId(resolve(new Date('2026-09-03T09:00:00+09:00')), 'application').urgency).toBe('due-1');
  });

  it('締切を過ぎたら overdue になり、最上位へ来る', () => {
    const tasks = resolve(new Date('2026-09-03T17:30:00+09:00'));
    expect(byId(tasks, 'application').urgency).toBe('overdue');
    expect(sortByUrgency(tasks)[0]?.urgency).toBe('overdue');
    // 「7日以内」だけを見る実装だと期限切れが消える
    expect(actionableAdminTasks(tasks)[0]?.urgency).toBe('overdue');
  });

  it('完了にすると urgency が done になり、クエストから外れる', () => {
    const states = {
      application: { taskId: 'application', doneAt: '2026-08-17T11:00:00+09:00', updatedAt: '' },
    };
    const tasks = resolve(new Date('2026-08-18T12:00:00+09:00'), states);
    expect(byId(tasks, 'application').urgency).toBe('done');
    expect(actionableAdminTasks(tasks).some((t) => t.template.id === 'application')).toBe(false);
  });

  it('CBT会場予約は CBT を選んだときだけ必要になる', () => {
    const cbt = resolveAdminTasks(adminTaskTemplates, {}, settings, new Date('2026-10-01T12:00:00+09:00'));
    expect(cbt.find((t) => t.template.id === 'cbt-reservation')?.applicable).toBe(true);

    const paper = resolveAdminTasks(
      adminTaskTemplates,
      {},
      { ...settings, academicMode: 'paper' },
      new Date('2026-10-01T12:00:00+09:00'),
    );
    expect(paper.find((t) => t.template.id === 'cbt-reservation')?.applicable).toBe(false);
  });

  it('受験日から逆算した期限は derived として印を付ける', () => {
    const tasks = resolve(new Date('2026-10-01T12:00:00+09:00'));
    const reservation = byId(tasks, 'cbt-reservation');
    // 公式値(受験案内PDF): 9/9 10:00 〜 10/14 23:59。受験日からの逆算ではない
    expect(reservation.dueSource).toBe('official');
    expect(reservation.needsUserConfirm).toBe(false);
    expect(reservation.opensAt).toBe('2026-09-09T10:00:00+09:00');
    expect(reservation.dueAt).toBe('2026-10-14T23:59:00+09:00');
  });

  it('【回帰】CBT予約期限は受験日を後ろへずらしても動かない', () => {
    // 逆算(受験日-14日)実装では、11/8受験のとき 10/25 という
    // 公式締切(10/14)より後の日付を出してしまっていた
    for (const academicDate of ['2026-09-24', '2026-10-24', '2026-11-08']) {
      const tasks = resolveAdminTasks(
        adminTaskTemplates,
        {},
        { ...settings, academicDate },
        new Date('2026-09-20T12:00:00+09:00'),
      );
      expect(byId(tasks, 'cbt-reservation').dueAt).toBe('2026-10-14T23:59:00+09:00');
    }
  });

  it('入金期限は申込締切の翌日(9/4)で、別のタスクとして立つ', () => {
    const tasks = resolve(new Date('2026-09-03T18:00:00+09:00'));
    // 申込は 9/3 17:00 で締切済み
    expect(byId(tasks, 'application').urgency).toBe('overdue');
    // 入金はまだ生きている。ここを同じ日にすると、払える日を1日潰す
    expect(byId(tasks, 'payment').dueAt).toBe('2026-09-04T17:00:00+09:00');
    expect(byId(tasks, 'payment').urgency).toBe('due-1');
    expect(byId(tasks, 'payment').dueSource).toBe('official');
    // 時刻はPDFに明記が無いので、何を確認すべきかを本文で出す
    expect(byId(tasks, 'payment').confirmNote).toContain('時刻の明記が無い');
  });

  it('技能の合否発表は公式の固定日(2027-01-15)で、受験日から逆算しない', () => {
    const tasks = resolve(new Date('2026-12-20T12:00:00+09:00'));
    expect(byId(tasks, 'result').dueAt).toBe('2027-01-15T12:00:00+09:00');
    expect(byId(tasks, 'result').dueSource).toBe('official');
  });

  it('受験日が未設定なら期限は未設定として扱い、偽の日付を作らない', () => {
    const tasks = resolveAdminTasks(
      adminTaskTemplates,
      {},
      { academicMode: 'cbt', academicDate: undefined, skillDate: undefined },
      new Date('2026-10-01T12:00:00+09:00'),
    );
    expect(byId(tasks, 'academic-exam').urgency).toBe('unknown-due');
    expect(byId(tasks, 'academic-exam').dueAt).toBeUndefined();
  });

  it('免状受領まで追跡対象に入っている(合格で終わりにしない)', () => {
    const ids = adminTaskTemplates.map((t) => t.id);
    expect(ids).toContain('license-apply');
    expect(ids).toContain('license-receive');
  });
});
