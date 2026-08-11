import { describe, expect, it } from 'vitest';
import { curriculum } from '../src/data';
import { BASICS_REQUIRED_MINUTES, evaluateOnboarding } from '../src/domain/onboarding';
import { applyStep } from '../src/domain/lessons';
import type { LessonProgress, StudySession } from '../src/domain/types';

const baseSettings = {
  beginnerMode: true,
  diagnosticUnlockedManually: false,
  diagnosticCompletedAt: undefined,
  ungradedFiveCompletedAt: undefined,
};

function completeLessons(ids: string[]): Record<string, LessonProgress> {
  const out: Record<string, LessonProgress> = {};
  const now = new Date('2026-08-12T10:00:00+09:00');
  for (const id of ids) {
    const lesson = curriculum.lessons.find((l) => l.id === id);
    if (!lesson) throw new Error(`no lesson ${id}`);
    let p = applyStep(lesson, undefined, 'input', {}, now);
    p = applyStep(lesson, p, 'recall', { recallAnswers: ['a'] }, now);
    p = applyStep(lesson, p, 'practice', { practiceNote: 'done', practiceTotal: 5 }, now);
    p = applyStep(lesson, p, 'takeaway', { takeaway: 'x' }, now);
    out[id] = p;
  }
  return out;
}

function session(minutes: number, countsAsBasics = true): StudySession {
  return {
    id: `s${Math.random()}`,
    startedAt: '2026-08-12T10:00:00+09:00',
    jstDate: '2026-08-12',
    durationMinutes: minutes,
    kind: 'theory',
    countsAsBasics,
  };
}

const orientationIds = curriculum.lessons.filter((l) => l.stage === 'orientation').map((l) => l.id);
const ungradedId = curriculum.lessons.find((l) => l.stage === 'ungraded-five')!.id;

describe('AT-002 完全未経験者の開始順序', () => {
  it('初回は orientation。20問診断は開いていない', () => {
    const s = evaluateOnboarding(curriculum, {}, [], baseSettings);
    expect(s.stage).toBe('orientation');
    expect(s.diagnosticAvailable).toBe(false);
    expect(s.diagnosticDone).toBe(false);
  });

  it('オリエンテーションを終えると次は無採点5問。まだ診断は出ない', () => {
    const s = evaluateOnboarding(curriculum, completeLessons(orientationIds), [], baseSettings);
    expect(s.stage).toBe('ungraded-five');
    expect(s.diagnosticAvailable).toBe(false);
  });

  it('無採点5問は基礎学習時間に算入しない(準備度へ反映しない)', () => {
    const progress = completeLessons([...orientationIds, ungradedId]);
    const s = evaluateOnboarding(
      curriculum,
      progress,
      [session(20, false)], // 無採点5問のセッション
      baseSettings,
    );
    expect(s.basicsMinutes).toBe(0);
    expect(s.stage).toBe('basics');
  });

  it(`基礎 ${BASICS_REQUIRED_MINUTES} 分に届くまで診断は開かない`, () => {
    const progress = completeLessons([...orientationIds, ungradedId]);
    const almost = evaluateOnboarding(curriculum, progress, [session(179)], baseSettings);
    expect(almost.stage).toBe('basics');
    expect(almost.diagnosticAvailable).toBe(false);

    const met = evaluateOnboarding(curriculum, progress, [session(180)], baseSettings);
    expect(met.stage).toBe('diagnostic');
    expect(met.diagnosticAvailable).toBe(true);
  });

  it('順序を飛ばせない。基礎180分あってもオリエンテーション未了なら診断は開かない', () => {
    const s = evaluateOnboarding(curriculum, {}, [session(600)], baseSettings);
    expect(s.stage).toBe('orientation');
    expect(s.diagnosticAvailable).toBe(false);
  });

  it('基礎が半分を超えると、手動解禁の導線だけが設定画面に現れる(前面には出ない)', () => {
    const progress = completeLessons([...orientationIds, ungradedId]);
    expect(
      evaluateOnboarding(curriculum, progress, [session(60)], baseSettings)
        .diagnosticManualUnlockOffered,
    ).toBe(false);
    expect(
      evaluateOnboarding(curriculum, progress, [session(120)], baseSettings)
        .diagnosticManualUnlockOffered,
    ).toBe(true);
  });

  it('手動解禁すると基礎未達でも診断へ進める', () => {
    const progress = completeLessons([...orientationIds, ungradedId]);
    const s = evaluateOnboarding(curriculum, progress, [session(120)], {
      ...baseSettings,
      diagnosticUnlockedManually: true,
    });
    expect(s.stage).toBe('diagnostic');
  });

  it('診断を終えると通常カリキュラムへ移る', () => {
    const progress = completeLessons([...orientationIds, ungradedId]);
    const s = evaluateOnboarding(curriculum, progress, [session(200)], {
      ...baseSettings,
      diagnosticCompletedAt: '2026-09-01T10:00:00+09:00',
    });
    expect(s.stage).toBe('regular');
  });

  it('完全未経験者モードを切ると段階の縛りが外れる', () => {
    const s = evaluateOnboarding(curriculum, {}, [], { ...baseSettings, beginnerMode: false });
    expect(s.stage).toBe('regular');
  });

  it('カリキュラム上、無採点5問は 20問診断より前にしか置かれていない', () => {
    const ungraded = curriculum.lessons.find((l) => l.id === ungradedId)!;
    const diagnostic = curriculum.lessons.find((l) => l.stage === 'diagnostic')!;
    expect(ungraded.practice.scored).toBe(false);
    expect(diagnostic.practice.scored).toBe(true);
    // 診断は無採点5問を前提にしている
    expect(diagnostic.prerequisites).toContain(ungradedId);
  });
});
