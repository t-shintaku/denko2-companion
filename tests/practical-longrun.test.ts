/**
 * 長期利用で詰まる経路の回帰テスト。
 * 「ある程度進んだ後に進めなくなる」壊れ方を、ここで機械的に止める。
 */

import { describe, expect, it } from 'vitest';
import { defaultBudgetItems } from '../src/data';
import {
  DEFECT_CLEAR_RUNS,
  TARGET_MINUTES,
  activeRepeatDefects,
  attemptMinutes,
  candidateStates,
  recentDefectFree,
  recentThreeWithinTarget,
  repeatDefects,
  skillGate,
} from '../src/domain/practical';
import { skillTrend } from '../src/domain/growth';
import type { BudgetItem, SkillAttempt } from '../src/domain/types';

let seq = 0;
function attempt(patch: Partial<SkillAttempt> & { candidateNo: number }): SkillAttempt {
  seq += 1;
  return {
    id: `a${seq}`,
    // 作った順に必ず新しくなる時刻。順序が入れ替わると解除判定を検証できない
    attemptedAt: `2026-11-01T${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}:00+09:00`,
    updatedAt: '2026-01-01T00:00:00+09:00',
    kind: 'candidate',
    workMinutes: 30,
    completed: true,
    defectFree: true,
    defectCodes: [],
    photoIds: [],
    ...patch,
  };
}

const toolsReady: BudgetItem[] = defaultBudgetItems
  .filter((b) => b.category === 'tool' && b.required)
  .map((b) => ({ ...b, status: 'owned' }));

describe('技能の時間は複線図込みで見る', () => {
  it('複線図10分+施工30分は40分として扱う(30分ではない)', () => {
    const a = attempt({ candidateNo: 1, diagramMinutes: 10, workMinutes: 30 });
    expect(attemptMinutes(a)).toBe(40);
  });

  it('【回帰】複線図10分+施工30分の3作品は35分ゲートを通らない', () => {
    const attempts = [1, 2, 3].map((n) =>
      attempt({ candidateNo: n, diagramMinutes: 10, workMinutes: 30 }),
    );
    const r = recentThreeWithinTarget(attempts);
    expect(r.minutes).toEqual([40, 40, 40]);
    expect(r.passed).toBe(false);
  });

  it('複線図込みで35分以内なら通る', () => {
    const attempts = [1, 2, 3].map((n) =>
      attempt({ candidateNo: n, diagramMinutes: 8, workMinutes: 26 }),
    );
    expect(recentThreeWithinTarget(attempts).passed).toBe(true);
  });

  it('「安定」も複線図込みで判定する', () => {
    const attempts = [
      attempt({ candidateNo: 5, diagramMinutes: 10, workMinutes: 30 }),
      attempt({ candidateNo: 5, diagramMinutes: 10, workMinutes: 30 }),
    ];
    const state = candidateStates(attempts).find((s) => s.candidateNo === 5)!;
    expect(state.medianMinutes).toBe(40);
    expect(state.status).not.toBe('stable');
  });
});

describe('反復欠陥は解除できる(ゲートが永久に閉じない)', () => {
  const twice = [
    attempt({ candidateNo: 1, defectFree: false, defectCodes: ['core-cut'] }),
    attempt({ candidateNo: 2, defectFree: false, defectCodes: ['core-cut'] }),
  ];

  it('同じ欠陥を2回出すと上がる', () => {
    const repeats = repeatDefects(twice);
    expect(repeats).toHaveLength(1);
    expect(repeats[0]?.resolved).toBe(false);
    expect(activeRepeatDefects(twice)).toHaveLength(1);
  });

  it('その工程だけの部分練習を記録すると降りる', () => {
    const withDrill = [
      ...twice,
      attempt({
        candidateNo: 0,
        kind: 'drill',
        workMinutes: 10,
        clearedDefectCodes: ['core-cut'],
      }),
    ];
    const repeats = repeatDefects(withDrill);
    expect(repeats[0]?.resolved).toBe(true);
    expect(repeats[0]?.resolvedBy).toBe('drill');
    expect(activeRepeatDefects(withDrill)).toHaveLength(0);
  });

  it(`部分練習をしなくても、再発なしで${DEFECT_CLEAR_RUNS}作品作れば降りる`, () => {
    const clean = [4, 5, 6].map((n) => attempt({ candidateNo: n }));
    const repeats = repeatDefects([...twice, ...clean]);
    expect(repeats[0]?.cleanRuns).toBe(DEFECT_CLEAR_RUNS);
    expect(repeats[0]?.resolved).toBe(true);
    expect(repeats[0]?.resolvedBy).toBe('clean-runs');
  });

  it('対策後に再発したら、また上がる(免除ではない)', () => {
    const again = [
      ...twice,
      attempt({ candidateNo: 0, kind: 'drill', clearedDefectCodes: ['core-cut'] }),
      attempt({ candidateNo: 7, defectFree: false, defectCodes: ['core-cut'] }),
    ];
    expect(activeRepeatDefects(again)).toHaveLength(1);
  });

  it('【回帰】対策済みなら技能ゲートの反復欠陥条件が通る', () => {
    // 13問すべて欠陥なし + 直近3作品35分以内 + 反復欠陥は対策済み
    const base = Array.from({ length: 13 }, (_, i) =>
      attempt({ candidateNo: i + 1, diagramMinutes: 5, workMinutes: 25 }),
    );
    const withDefects = [
      attempt({ candidateNo: 1, defectFree: false, defectCodes: ['core-cut'] }),
      attempt({ candidateNo: 2, defectFree: false, defectCodes: ['core-cut'] }),
      ...base,
      attempt({ candidateNo: 0, kind: 'drill', clearedDefectCodes: ['core-cut'] }),
    ];
    const gate = skillGate(withDefects, toolsReady);
    const repeat = gate.criteria.find((c) => c.id === 'no-repeat-defect')!;
    expect(repeat.passed).toBe(true);
    expect(gate.criteria.find((c) => c.id === 'recent-3-time')?.passed).toBe(true);
  });
});

describe('部分練習を候補問題の1回として数えない', () => {
  const drills = Array.from({ length: 13 }, () =>
    attempt({ candidateNo: 0, kind: 'drill', workMinutes: 10, clearedDefectCodes: ['core-cut'] }),
  );

  it('13問到達にも直近5作品にも入らない', () => {
    const gate = skillGate(drills, toolsReady);
    expect(gate.criteria.find((c) => c.id === 'all-attempted')?.passed).toBe(false);
    expect(recentDefectFree(drills, 5).of).toBe(0);
    expect(recentThreeWithinTarget(drills).minutes).toEqual([]);
  });

  it('伸びの集計にも混ざらない', () => {
    expect(skillTrend(drills).attempts).toBe(0);
  });
});

describe('技能の伸びが数字で出る', () => {
  it('直近3作品が前の3作品より速ければマイナスで返る', () => {
    const slow = [1, 2, 3].map((n) => attempt({ candidateNo: n, diagramMinutes: 10, workMinutes: 40 }));
    const fast = [4, 5, 6].map((n) => attempt({ candidateNo: n, diagramMinutes: 8, workMinutes: 25 }));
    const trend = skillTrend([...slow, ...fast]);
    expect(trend.recentMinutes).toEqual([33, 33, 33]);
    expect(trend.minutesDelta).toBeLessThan(0);
    expect(trend.recentMinutes.every((m) => m <= TARGET_MINUTES)).toBe(true);
  });
});
