import { describe, expect, it } from 'vitest';
import { adminTaskTemplates, curriculum } from '../src/data';
import { resolveAdminTasks } from '../src/domain/adminTasks';
import { evaluateOnboarding } from '../src/domain/onboarding';
import { buildSchedule } from '../src/domain/schedule';
import {
  buildTodayQuests,
  daysSinceLastActivity,
  nextTenMinutes,
  type QuestContext,
} from '../src/domain/quests';
import type { LessonProgress, StudySession } from '../src/domain/types';

function makeContext(opts: {
  today: string;
  now: Date;
  progress?: Record<string, LessonProgress>;
  sessions?: StudySession[];
  adminDone?: string[];
  budget?: 10 | 30 | 60;
}): QuestContext {
  const progress = opts.progress ?? {};
  const sessions = opts.sessions ?? [];
  const states = Object.fromEntries(
    (opts.adminDone ?? []).map((id) => [id, { taskId: id, doneAt: '2026-08-17T11:00:00+09:00', updatedAt: '' }]),
  );
  const settings = {
    academicMode: 'cbt' as const,
    academicDate: '2026-10-24',
    skillDate: '2026-12-12',
  };
  return {
    today: opts.today,
    curriculum,
    progress,
    sessions,
    schedule: buildSchedule({
      today: opts.today,
      startDate: '2026-08-11',
      academicDate: settings.academicDate,
      skillDate: settings.skillDate,
      weekdayMinutes: 35,
      weekendMinutes: 150,
      curriculum,
      progress,
    }),
    adminTasks: resolveAdminTasks(adminTaskTemplates, states, settings, opts.now),
    onboarding: evaluateOnboarding(curriculum, progress, sessions, {
      beginnerMode: true,
      diagnosticUnlockedManually: false,
      diagnosticCompletedAt: undefined,
      ungradedFiveCompletedAt: undefined,
    }),
    budgetMinutes: opts.budget ?? 30,
  };
}

describe('FR-004 / §10 今日のクエストと次の10分', () => {
  it('申込開始前は、学習(オリエンテーション1本目)が主タスクになる', () => {
    const ctx = makeContext({ today: '2026-08-11', now: new Date('2026-08-11T20:00:00+09:00') });
    const quest = nextTenMinutes(ctx);
    expect(quest?.reason).toBe('orientation');
    expect(quest?.lessonId).toBe('p0-l1');
  });

  it('2026-08-17 10:00 を過ぎると、学習より申込みが先に来る', () => {
    const ctx = makeContext({ today: '2026-08-17', now: new Date('2026-08-17T10:30:00+09:00') });
    const quest = nextTenMinutes(ctx);
    expect(quest?.reason).toBe('admin');
    expect(quest?.taskId).toBe('mypage');
  });

  it('事務を片付ければ学習へ戻る', () => {
    const ctx = makeContext({
      today: '2026-08-17',
      now: new Date('2026-08-17T10:30:00+09:00'),
      adminDone: ['mypage', 'application', 'payment'],
    });
    expect(nextTenMinutes(ctx)?.reason).toBe('orientation');
  });

  it('3日空いたら、失敗表示ではなく再開用10分を出す', () => {
    const sessions: StudySession[] = [
      {
        id: 's1',
        startedAt: '2026-08-11T20:00:00+09:00',
        jstDate: '2026-08-11',
        durationMinutes: 25,
        kind: 'theory',
        countsAsBasics: true,
      },
    ];
    expect(daysSinceLastActivity(sessions, {}, '2026-08-14')).toBe(3);
    const ctx = makeContext({
      today: '2026-08-14',
      now: new Date('2026-08-14T20:00:00+09:00'),
      sessions,
    });
    const quest = nextTenMinutes(ctx);
    expect(quest?.reason).toBe('comeback');
    expect(quest?.title).toContain('再開の10分');
    expect(quest?.detail).toContain('失点ではない');
  });

  it('2日の空白では再開モードにしない', () => {
    const sessions: StudySession[] = [
      {
        id: 's1',
        startedAt: '2026-08-11T20:00:00+09:00',
        jstDate: '2026-08-11',
        durationMinutes: 25,
        kind: 'theory',
        countsAsBasics: true,
      },
    ];
    const ctx = makeContext({
      today: '2026-08-13',
      now: new Date('2026-08-13T20:00:00+09:00'),
      sessions,
    });
    expect(nextTenMinutes(ctx)?.reason).not.toBe('comeback');
  });

  it('クエストは最大3件で、クリア条件を必ず持つ', () => {
    const ctx = makeContext({ today: '2026-08-11', now: new Date('2026-08-11T20:00:00+09:00') });
    const quests = buildTodayQuests(ctx);
    expect(quests.length).toBeGreaterThan(0);
    expect(quests.length).toBeLessThanOrEqual(3);
    for (const q of quests) expect(q.clearCondition).toContain('1点');
  });

  it('持ち時間を変えると同じレッスンの所要時間が変わる', () => {
    const ten = buildTodayQuests(
      makeContext({ today: '2026-08-11', now: new Date('2026-08-11T20:00:00+09:00'), budget: 10 }),
    )[0];
    const sixty = buildTodayQuests(
      makeContext({ today: '2026-08-11', now: new Date('2026-08-11T20:00:00+09:00'), budget: 60 }),
    )[0];
    expect(ten?.lessonId).toBe(sixty?.lessonId);
    expect(ten!.minutes).toBeLessThan(sixty!.minutes);
  });

  it('先の段階のレッスン(20問診断)を前面へ出さない', () => {
    const ctx = makeContext({ today: '2026-08-11', now: new Date('2026-08-11T20:00:00+09:00') });
    const quests = buildTodayQuests(ctx);
    expect(quests.some((q) => q.lessonId === 'p1-w3-l1')).toBe(false);
    expect(quests.some((q) => q.reason === 'diagnostic')).toBe(false);
  });
});
