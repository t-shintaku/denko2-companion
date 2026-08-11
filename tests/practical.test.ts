import { describe, expect, it } from 'vitest';
import { defaultBudgetItems } from '../src/data';
import {
  CANDIDATE_COUNT,
  budgetSummary,
  candidateStates,
  recentDefectFree,
  recentThreeWithinTarget,
  repeatDefects,
  skillGate,
} from '../src/domain/practical';
import type { BudgetItem, SkillAttempt } from '../src/domain/types';

let seq = 0;
function att(
  candidateNo: number,
  workMinutes: number,
  defectFree: boolean,
  defectCodes: string[] = [],
  day = `2026-11-${String((seq % 28) + 1).padStart(2, '0')}`,
): SkillAttempt {
  seq += 1;
  return {
    id: `s${seq}`,
    attemptedAt: `${day}T10:${String(seq % 60).padStart(2, '0')}:00+09:00`,
    updatedAt: "2026-01-01T00:00:00+09:00",
    candidateNo,
    workMinutes,
    completed: true,
    defectFree,
    defectCodes,
    photoIds: [],
  };
}

const toolsReady: BudgetItem[] = defaultBudgetItems
  .filter((b) => b.category === 'tool' && b.required)
  .map((b) => ({ ...b, status: 'owned' }));

describe('AT-006 技能ゲート', () => {
  it('13問中12問が欠陥なしでは、全候補ゲートを通さない', () => {
    seq = 0;
    const attempts = Array.from({ length: 12 }, (_, i) => att(i + 1, 30, true));
    attempts.push(att(13, 30, false, ['crimp-mark'])); // 13問目は欠陥あり
    const gate = skillGate(attempts, toolsReady);

    expect(gate.criteria.find((c) => c.id === 'all-attempted')?.passed).toBe(true);
    expect(gate.criteria.find((c) => c.id === 'all-defect-free')?.passed).toBe(false);
    expect(gate.criteria.find((c) => c.id === 'all-defect-free')?.evidence).toBe(
      `12 / ${CANDIDATE_COUNT} 問`,
    );
    expect(gate.passed).toBe(false);
  });

  it('直近5作品中4作品が欠陥なしなら、その条件は通る', () => {
    seq = 0;
    const attempts = [
      att(1, 30, false, ['loop']),
      att(2, 30, true),
      att(3, 30, true),
      att(4, 30, true),
      att(5, 30, true),
    ];
    expect(recentDefectFree(attempts, 5)).toEqual({ free: 4, of: 5 });
    expect(skillGate(attempts, toolsReady).criteria.find((c) => c.id === 'recent-5')?.passed).toBe(
      true,
    );
  });

  it('【要件書の矛盾を分離】34・35・36分では「直近3回35分以内」を通さない', () => {
    seq = 0;
    const attempts = [att(1, 34, true), att(2, 35, true), att(3, 36, true)];
    // 中央値は35分。FR-011の表示指標としては35分と出る
    expect(candidateStates(attempts).find((s) => s.candidateNo === 1)?.medianMinutes).toBe(34);
    // だがゲートは最大値で判定するので、36分がある限り通らない(AT-006)
    const r = recentThreeWithinTarget(attempts);
    expect(r.minutes).toEqual([34, 35, 36]);
    expect(r.passed).toBe(false);
  });

  it('34・35・35分なら通る', () => {
    seq = 0;
    expect(recentThreeWithinTarget([att(1, 34, true), att(2, 35, true), att(3, 35, true)]).passed).toBe(
      true,
    );
  });

  it('3作品に満たなければ時間の条件を通さない', () => {
    seq = 0;
    expect(recentThreeWithinTarget([att(1, 20, true), att(2, 20, true)]).passed).toBe(false);
  });

  it('同一欠陥2回で反復欠陥になる', () => {
    seq = 0;
    const attempts = [
      att(1, 30, false, ['crimp-mark']),
      att(2, 30, false, ['loop']),
      att(3, 30, false, ['crimp-mark']),
    ];
    const repeats = repeatDefects(attempts);
    expect(repeats).toHaveLength(1);
    expect(repeats[0]).toMatchObject({ code: 'crimp-mark', count: 2 });
  });

  it('指定工具が揃っていないとゲートを通さない', () => {
    seq = 0;
    const attempts = Array.from({ length: 13 }, (_, i) => att(i + 1, 30, true));
    const missing = toolsReady.map((b, i) => (i === 0 ? { ...b, status: 'planned' as const } : b));
    const gate = skillGate(attempts, missing);
    expect(gate.criteria.find((c) => c.id === 'tools')?.passed).toBe(false);
  });
});

describe('FR-011 候補13問の状態', () => {
  it('未着手 → 施工経験 → 欠陥なし → 安定 と上がる', () => {
    seq = 0;
    expect(candidateStates([]).every((s) => s.status === 'untouched')).toBe(true);

    seq = 0;
    const attempted = candidateStates([att(1, 50, false, ['loop'])]);
    expect(attempted.find((s) => s.candidateNo === 1)?.status).toBe('attempted');

    seq = 0;
    const free = candidateStates([att(1, 50, false, ['loop']), att(1, 45, true)]);
    expect(free.find((s) => s.candidateNo === 1)?.status).toBe('defect-free');

    seq = 0;
    const stable = candidateStates([att(1, 34, true), att(1, 33, true)]);
    expect(stable.find((s) => s.candidateNo === 1)?.status).toBe('stable');
  });

  it('速さは最速ではなく直近3回の中央値で見る(FR-011)', () => {
    seq = 0;
    const s = candidateStates([att(1, 60, true), att(1, 30, true), att(1, 40, true)]).find(
      (x) => x.candidateNo === 1,
    )!;
    expect(s.fastestMinutes).toBe(30);
    expect(s.medianMinutes).toBe(40); // 30/40/60 の中央値
    expect(s.worstOfRecentThree).toBe(60);
  });

  it('13問すべてがカードとして存在する', () => {
    expect(candidateStates([])).toHaveLength(13);
  });
});

describe('AT-008 予算', () => {
  it('所有・借用・購入予定・購入済を区別する', () => {
    const items: BudgetItem[] = [
      { id: '1', category: 'tool', label: '所有', status: 'owned', required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
      { id: '2', category: 'tool', label: '借用', status: 'borrowable', required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
      { id: '3', category: 'tool', label: '予定', status: 'planned', expectedYen: 4000, required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
      { id: '4', category: 'tool', label: '購入済', status: 'purchased', actualYen: 3800, required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
    ];
    const s = budgetSummary(items);
    expect(s.actualYen).toBe(3800);
    expect(s.plannedYen).toBe(4000);
    expect(s.avoidedCount).toBe(2); // 所有 + 借用
  });

  it('実支出の合計が正しい', () => {
    const items: BudgetItem[] = [
      { id: '1', category: 'exam', label: '受験料', status: 'purchased', actualYen: 11100, required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
      { id: '2', category: 'tool', label: '圧着工具', status: 'purchased', actualYen: 4200, required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
      { id: '3', category: 'material', label: '練習材料', status: 'planned', expectedYen: 20000, required: true, updatedAt: "2026-01-01T00:00:00+09:00" },
    ];
    expect(budgetSummary(items).actualYen).toBe(15300);
  });

  it('初期候補は「購入予定」で入り、高額セットを必須の既定にしない', () => {
    expect(defaultBudgetItems.every((i) => i.status === 'planned')).toBe(true);
    // 指定工具は必須、時短用のストリッパーや2周目材料は任意
    expect(defaultBudgetItems.find((i) => i.id === 'tool-crimp')?.required).toBe(true);
    expect(defaultBudgetItems.find((i) => i.id === 'tool-stripper')?.required).toBe(false);
    expect(defaultBudgetItems.find((i) => i.id === 'material-second-round')?.required).toBe(false);
  });

  it('指定工具6点+圧着工具が必須として入っている', () => {
    const requiredTools = defaultBudgetItems.filter((i) => i.category === 'tool' && i.required);
    expect(requiredTools).toHaveLength(7);
    expect(requiredTools.some((t) => t.label.includes('JIS C 9711'))).toBe(true);
  });
});
