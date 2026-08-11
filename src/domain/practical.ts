/**
 * 技能:候補13問の状態・欠陥・ゲート(FR-011 / FR-013 技能ゲート)。
 *
 * 要件書 FR-011 と AT-006 の読み合わせで矛盾していた点をここで分離している:
 *   - 表示する指標は「直近3回の中央値」(FR-011)
 *   - ゲートの判定は「直近3回すべてが35分以内」(AT-006)
 * 34/35/36分の中央値は35なので、中央値で判定すると AT-006 が要求する不通過にならない。
 */

import type { BudgetItem, SkillAttempt } from './types';

export const CANDIDATE_COUNT = 13;
export const CANDIDATE_NUMBERS = Array.from({ length: CANDIDATE_COUNT }, (_, i) => i + 1);
/** 本番は40分。ゲートは余裕を見て35分 */
export const TARGET_MINUTES = 35;
export const EXAM_MINUTES = 40;
/** 同一欠陥が2回で「反復欠陥」(FR-011) */
export const REPEAT_DEFECT_THRESHOLD = 2;

export type CandidateStatus = 'untouched' | 'attempted' | 'defect-free' | 'stable';

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  untouched: '未着手',
  attempted: '施工経験あり',
  'defect-free': '欠陥なし1回',
  stable: '安定',
};

export type CandidateState = {
  candidateNo: number;
  status: CandidateStatus;
  attempts: number;
  defectFreeCount: number;
  lastAttemptedOn?: string;
  /** 直近3回の中央値。速さの指標は最速ではなく中央値で見る(FR-011) */
  medianMinutes?: number;
  fastestMinutes?: number;
  /** 直近3回の最大値。ゲート判定はこちらを使う(AT-006) */
  worstOfRecentThree?: number;
};

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function candidateStates(attempts: SkillAttempt[]): CandidateState[] {
  return CANDIDATE_NUMBERS.map((candidateNo) => {
    const mine = attempts
      .filter((a) => a.candidateNo === candidateNo)
      .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1));
    const completed = mine.filter((a) => a.completed);
    const defectFreeCount = mine.filter((a) => a.defectFree).length;
    const recent3 = mine.slice(-3).map((a) => a.workMinutes);

    let status: CandidateStatus = 'untouched';
    if (mine.length > 0) status = 'attempted';
    if (defectFreeCount >= 1) status = 'defect-free';
    // 「安定」= 直近2回が欠陥なしかつ35分以内
    const last2 = mine.slice(-2);
    if (
      last2.length === 2 &&
      last2.every((a) => a.defectFree && a.workMinutes <= TARGET_MINUTES)
    ) {
      status = 'stable';
    }

    return {
      candidateNo,
      status,
      attempts: mine.length,
      defectFreeCount,
      lastAttemptedOn: mine[mine.length - 1]?.attemptedAt.slice(0, 10),
      medianMinutes: median(recent3),
      fastestMinutes: completed.length > 0 ? Math.min(...completed.map((a) => a.workMinutes)) : undefined,
      worstOfRecentThree: recent3.length > 0 ? Math.max(...recent3) : undefined,
    };
  });
}

export type RepeatDefect = { code: string; count: number; lastOn: string };

/** 同じ欠陥を2回以上出したもの(FR-011) */
export function repeatDefects(attempts: SkillAttempt[]): RepeatDefect[] {
  const map = new Map<string, { count: number; lastOn: string }>();
  for (const a of attempts) {
    for (const code of a.defectCodes) {
      const prev = map.get(code);
      map.set(code, {
        count: (prev?.count ?? 0) + 1,
        lastOn: a.attemptedAt.slice(0, 10),
      });
    }
  }
  return [...map.entries()]
    .filter(([, v]) => v.count >= REPEAT_DEFECT_THRESHOLD)
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);
}

/** 直近 n 作品のうち欠陥なしの数 */
export function recentDefectFree(attempts: SkillAttempt[], n = 5): { free: number; of: number } {
  const recent = [...attempts]
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1))
    .slice(-n);
  return { free: recent.filter((a) => a.defectFree).length, of: recent.length };
}

/** 直近3作品がすべて基準時間以内か。中央値ではなく最大値で見る(AT-006) */
export function recentThreeWithinTarget(attempts: SkillAttempt[]): {
  passed: boolean;
  minutes: number[];
} {
  const recent = [...attempts]
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1))
    .slice(-3)
    .map((a) => a.workMinutes);
  return {
    passed: recent.length === 3 && recent.every((m) => m <= TARGET_MINUTES),
    minutes: recent,
  };
}

export type SkillGateCriterion = {
  id: string;
  label: string;
  passed: boolean;
  evidence: string;
};

export function skillGate(
  attempts: SkillAttempt[],
  budget: BudgetItem[],
): { criteria: SkillGateCriterion[]; passedCount: number; total: number; passed: boolean } {
  const states = candidateStates(attempts);
  const touched = states.filter((s) => s.status !== 'untouched').length;
  const defectFree = states.filter((s) => s.defectFreeCount >= 1).length;
  const recent5 = recentDefectFree(attempts, 5);
  const recent3 = recentThreeWithinTarget(attempts);
  const repeats = repeatDefects(attempts);
  const requiredTools = budget.filter((b) => b.category === 'tool' && b.required);
  const readyTools = requiredTools.filter(
    (b) => b.status === 'owned' || b.status === 'purchased' || b.status === 'borrowable',
  );

  const criteria: SkillGateCriterion[] = [
    {
      id: 'tools',
      label: '指定工具が揃っている',
      passed: requiredTools.length > 0 && readyTools.length === requiredTools.length,
      evidence: `${readyTools.length} / ${requiredTools.length} 点`,
    },
    {
      id: 'all-attempted',
      label: `13問すべてを施工`,
      passed: touched === CANDIDATE_COUNT,
      evidence: `${touched} / ${CANDIDATE_COUNT} 問`,
    },
    {
      id: 'all-defect-free',
      label: '13問すべてで欠陥なし1回',
      passed: defectFree === CANDIDATE_COUNT,
      evidence: `${defectFree} / ${CANDIDATE_COUNT} 問`,
    },
    {
      id: 'recent-5',
      label: '直近5作品中4作品以上が欠陥なし',
      passed: recent5.of >= 5 && recent5.free >= 4,
      evidence: `${recent5.free} / ${recent5.of} 作品`,
    },
    {
      id: 'recent-3-time',
      label: `直近3作品が${TARGET_MINUTES}分以内`,
      passed: recent3.passed,
      evidence:
        recent3.minutes.length === 0
          ? '記録なし'
          : `${recent3.minutes.join(' / ')} 分`,
    },
    {
      id: 'no-repeat-defect',
      label: '反復欠陥がない(または対策済み)',
      passed: repeats.length === 0,
      evidence: repeats.length === 0 ? 'なし' : `${repeats.length}種類`,
    },
  ];

  const passedCount = criteria.filter((c) => c.passed).length;
  return { criteria, passedCount, total: criteria.length, passed: passedCount === criteria.length };
}

// ---------------------------------------------------------------------------
// 予算(FR-012)
// ---------------------------------------------------------------------------

export const BUDGET_STATUS_LABEL: Record<BudgetItem['status'], string> = {
  owned: '所有',
  borrowable: '借用可',
  planned: '購入予定',
  purchased: '購入済',
  unnecessary: '不要',
};

export const BUDGET_CATEGORY_LABEL: Record<BudgetItem['category'], string> = {
  exam: '受験料',
  license: '免状',
  tool: '工具',
  material: '材料',
  travel: '交通・写真',
  other: 'その他',
};

export type BudgetSummary = {
  /** 実際に払った合計 */
  actualYen: number;
  /** これから買う予定の合計 */
  plannedYen: number;
  /** 所有・借用で済んでいて買わずに済んだ点数 */
  avoidedCount: number;
  byCategory: { category: BudgetItem['category']; actual: number; planned: number }[];
};

export function budgetSummary(items: BudgetItem[]): BudgetSummary {
  const actualYen = items.reduce((s, i) => s + (i.actualYen ?? 0), 0);
  const plannedYen = items
    .filter((i) => i.status === 'planned')
    .reduce((s, i) => s + (i.expectedYen ?? 0), 0);
  const avoidedCount = items.filter(
    (i) => i.status === 'owned' || i.status === 'borrowable',
  ).length;

  const categories = [...new Set(items.map((i) => i.category))];
  return {
    actualYen,
    plannedYen,
    avoidedCount,
    byCategory: categories.map((category) => ({
      category,
      actual: items
        .filter((i) => i.category === category)
        .reduce((s, i) => s + (i.actualYen ?? 0), 0),
      planned: items
        .filter((i) => i.category === category && i.status === 'planned')
        .reduce((s, i) => s + (i.expectedYen ?? 0), 0),
    })),
  };
}
