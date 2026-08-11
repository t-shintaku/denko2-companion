/**
 * バンドルされたマスタデータへの型付き入口。
 * ここ以外から JSON を直接 import しない(将来 JSON を差し替えるときの窓口を1つにする)。
 */

import curriculumJson from './curriculum-2026-h2.json';
import examCycleJson from './exam-cycle-2026-h2.json';
import adminTasksJson from './admin-tasks-2026-h2.json';
import resourcesJson from './resources.json';
import topicsJson from './topics.json';
import toolsJson from './tools.json';
import defectsJson from './skill-defects.json';
import type {
  AdminTaskTemplate,
  BudgetItem,
  Curriculum,
  CurriculumLesson,
  ExamCycle,
  LearningResource,
  Topic,
  TopicId,
} from '../domain/types';

export const examCycle = examCycleJson as ExamCycle;
export const curriculum = curriculumJson as unknown as Curriculum;
export const adminTaskTemplates = adminTasksJson as unknown as AdminTaskTemplate[];
export const resources = resourcesJson as unknown as LearningResource[];
export const topics = topicsJson as unknown as Topic[];
/** 工具・材料・費用の初期候補(FR-012)。本人が所有/借用/購入へ仕分ける */
export const defaultBudgetItems = toolsJson as unknown as BudgetItem[];
/** 欠陥カテゴリ。公式の欠陥判断基準を要約した分類で、判定そのものではない */
export const skillDefects = defectsJson as unknown as { code: string; label: string }[];

export const topicIds = topics.map((t) => t.id);

export function topicName(id: TopicId): string {
  return topics.find((t) => t.id === id)?.shortName ?? id;
}

export function defectLabel(code: string): string {
  return skillDefects.find((d) => d.code === code)?.label ?? code;
}

const lessonIndex = new Map<string, CurriculumLesson>(
  curriculum.lessons.map((l) => [l.id, l]),
);
const resourceIndex = new Map<string, LearningResource>(resources.map((r) => [r.id, r]));

export function getLesson(id: string): CurriculumLesson | undefined {
  return lessonIndex.get(id);
}

export function getResource(id: string): LearningResource | undefined {
  return resourceIndex.get(id);
}

/**
 * 教材が消えたときの代替(FR-006)。replacementResourceId をたどる。
 */
export function resolveResource(id: string): LearningResource | undefined {
  const direct = resourceIndex.get(id);
  if (direct?.replacementResourceId) {
    return resourceIndex.get(direct.replacementResourceId) ?? direct;
  }
  return direct;
}

export function getPhase(id: string) {
  return curriculum.phases.find((p) => p.id === id);
}
