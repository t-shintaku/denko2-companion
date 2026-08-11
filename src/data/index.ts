/**
 * バンドルされたマスタデータへの型付き入口。
 * ここ以外から JSON を直接 import しない(将来 JSON を差し替えるときの窓口を1つにする)。
 */

import curriculumJson from './curriculum-2026-h2.json';
import examCycleJson from './exam-cycle-2026-h2.json';
import adminTasksJson from './admin-tasks-2026-h2.json';
import resourcesJson from './resources.json';
import topicsJson from './topics.json';
import type {
  AdminTaskTemplate,
  Curriculum,
  CurriculumLesson,
  ExamCycle,
  LearningResource,
  Topic,
} from '../domain/types';

export const examCycle = examCycleJson as ExamCycle;
export const curriculum = curriculumJson as unknown as Curriculum;
export const adminTaskTemplates = adminTasksJson as unknown as AdminTaskTemplate[];
export const resources = resourcesJson as unknown as LearningResource[];
export const topics = topicsJson as unknown as Topic[];

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
