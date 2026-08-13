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
import syllabusJson from './syllabus-2026-h2.json';
import basicTheoryQuestions from './questions/basic-theory.json';
import distributionDesignQuestions from './questions/distribution-design.json';
import equipmentToolsQuestions from './questions/equipment-tools.json';
import constructionMethodQuestions from './questions/construction-method.json';
import inspectionQuestions from './questions/inspection.json';
import wiringDiagramQuestions from './questions/wiring-diagram.json';
import lawQuestions from './questions/law.json';
import type {
  AdminTaskTemplate,
  BudgetItem,
  Curriculum,
  CurriculumLesson,
  ExamCycle,
  LearningResource,
  QuizQuestion,
  SyllabusItem,
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

/** 公式の出題範囲を、教える単位まで割ったもの。カバレッジ検査の基準になる */
export const syllabus = syllabusJson as unknown as SyllabusItem[];

/**
 * アプリ内の自作問題バンク。**科目ごとにファイルを分けている**。
 * 1ファイルに全部入れると、1問直すたびに巨大な差分になり、
 * どの科目が薄いのかもレビューで見えなくなる。ファイル名＝topicId を検査で固定する。
 */
export const questions = [
  ...basicTheoryQuestions,
  ...distributionDesignQuestions,
  ...equipmentToolsQuestions,
  ...constructionMethodQuestions,
  ...inspectionQuestions,
  ...wiringDiagramQuestions,
  ...lawQuestions,
] as unknown as QuizQuestion[];

/** 科目ごとのファイル。ファイル名と中身の topicId が一致していることを検査するために持つ */
export const questionFiles: { topicId: TopicId; questions: QuizQuestion[] }[] = [
  { topicId: 'basic-theory', questions: basicTheoryQuestions as unknown as QuizQuestion[] },
  {
    topicId: 'distribution-design',
    questions: distributionDesignQuestions as unknown as QuizQuestion[],
  },
  { topicId: 'equipment-tools', questions: equipmentToolsQuestions as unknown as QuizQuestion[] },
  {
    topicId: 'construction-method',
    questions: constructionMethodQuestions as unknown as QuizQuestion[],
  },
  { topicId: 'inspection', questions: inspectionQuestions as unknown as QuizQuestion[] },
  { topicId: 'wiring-diagram', questions: wiringDiagramQuestions as unknown as QuizQuestion[] },
  { topicId: 'law', questions: lawQuestions as unknown as QuizQuestion[] },
];

const questionIndex = new Map<string, QuizQuestion>(questions.map((q) => [q.id, q]));

export function getQuestion(id: string): QuizQuestion | undefined {
  return questionIndex.get(id);
}

/** レッスンが出題する問題を、並び順のまま解決する。欠番は黙って落とさず undefined を除く */
export function questionsFor(ids: string[] | undefined): QuizQuestion[] {
  if (!ids) return [];
  return ids.map((id) => questionIndex.get(id)).filter((x): x is QuizQuestion => x !== undefined);
}

export function getSyllabusItem(id: string): SyllabusItem | undefined {
  return syllabus.find((s) => s.id === id);
}

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
