import { describe, expect, it } from 'vitest';
import { buildTodayPath } from '../src/domain/todayPath';
import type { Quest } from '../src/domain/quests';
import type { StudySession } from '../src/domain/types';

const TODAY = '2026-09-06';

const quest = (over: Partial<Quest> = {}): Quest => ({
  id: 'lesson:p0-l1',
  reason: 'orientation',
  slot: 'main',
  title: '資格と試験の地図 — まず見る',
  detail: '資格でできることを知る',
  clearCondition: '教材を見る（ここまでで今日はクリア！）',
  lessonId: 'p0-l1',
  minutes: 11,
  mode: 'standard',
  fitsBudget: true,
  ...over,
});

const session = (over: Partial<StudySession> = {}): StudySession => ({
  id: 's1',
  startedAt: `${TODAY}T10:00:00+09:00`,
  jstDate: TODAY,
  durationMinutes: 11,
  kind: 'theory',
  countsAsBasics: false,
  updatedAt: `${TODAY}T10:11:00+09:00`,
  ...over,
});

const base = {
  today: TODAY,
  sessions: [] as StudySession[],
  practiceCount: 0,
  dueCount: 0,
  quest: quest(),
  officialReady: false,
};

describe('今日の道のり', () => {
  it('知識ゼロの日に、問題を1歩目へ置かない', () => {
    const path = buildTodayPath(base);
    expect(path.steps.map((s) => s.kind)).toEqual(['lesson']);
    expect(path.currentIndex).toBe(0);
    expect(path.clearedToday).toBe(false);
  });

  it('教材を見た直後は「教材 → その問題」の順に並ぶ', () => {
    const path = buildTodayPath({ ...base, practiceCount: 5, dueCount: 0 });
    expect(path.steps.map((s) => s.kind)).toEqual(['lesson', 'review']);
    // 勧めるのは1件だけ
    expect(path.currentIndex).toBe(0);
  });

  it('期日が来た問題があるときだけ、復習が先へ回る', () => {
    const path = buildTodayPath({ ...base, practiceCount: 5, dueCount: 3 });
    expect(path.steps.map((s) => s.kind)).toEqual(['review', 'lesson']);
    expect(path.steps[0]!.detail).toContain('忘れかけ');
  });

  it('今日そのレッスンをやっていれば済みになり、次の1件へ進む', () => {
    const path = buildTodayPath({
      ...base,
      practiceCount: 5,
      sessions: [session({ lessonId: 'p0-l1' })],
    });
    expect(path.steps[0]!.done).toBe(true);
    expect(path.currentIndex).toBe(1);
    // 1件やれば今日は勝ち。残りは隠さないが「おかわり」扱いにする
    expect(path.clearedToday).toBe(true);
  });

  it('全部済んだ日は、次にやることを出さない', () => {
    const path = buildTodayPath({
      ...base,
      practiceCount: 5,
      sessions: [session({ lessonId: 'p0-l1' }), session({ id: 's2', kind: 'review' })],
    });
    expect(path.currentIndex).toBeUndefined();
    expect(path.steps.every((s) => s.done)).toBe(true);
  });

  it('レッスンも復習も無く、段階が進んでいれば公式問題へ送る', () => {
    const path = buildTodayPath({ ...base, quest: undefined, officialReady: true });
    expect(path.steps.map((s) => s.kind)).toEqual(['official']);
  });

  it('出せるものが何も無い日は、空の道のりを返す(行き止まりの案内は画面側)', () => {
    const path = buildTodayPath({ ...base, quest: undefined, officialReady: false });
    expect(path.steps).toEqual([]);
    expect(path.currentIndex).toBeUndefined();
  });

  it('持ち時間に収まらない一手は、収まらないと書く', () => {
    const path = buildTodayPath({ ...base, quest: quest({ minutes: 42, fitsBudget: false }) });
    expect(path.steps[0]!.note).toContain('42分');
    expect(path.steps[0]!.note).toContain('途中まででOK');
  });

  it('レッスン全体の残りが1歩より長いときは、残りを添えて途中終了を許す', () => {
    const path = buildTodayPath({ ...base, quest: quest({ minutes: 11, remainingMinutes: 26 }) });
    expect(path.steps[0]!.note).toContain('残り約26分');
  });
});
