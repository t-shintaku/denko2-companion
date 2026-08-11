/**
 * IndexedDB(Dexie)。アカウント不要・端末ローカル(FR-019)。
 * 写真は Sprint 3 で Blob テーブルへ入れる。JSON へ base64 を大量に埋め込まない。
 */

import Dexie from 'dexie';
import type { Table } from 'dexie';
import { SCHEMA_VERSION } from '../domain/types';
import type {
  AdminTaskState,
  BudgetItem,
  LessonProgress,
  QuestionAttempt,
  SkillAttempt,
  StudySession,
  UnknownTerm,
  UserSettings,
} from '../domain/types';

export class Denko2Db extends Dexie {
  settings!: Table<UserSettings, string>;
  lessonProgress!: Table<LessonProgress, string>;
  adminTaskStates!: Table<AdminTaskState, string>;
  studySessions!: Table<StudySession, string>;
  questionAttempts!: Table<QuestionAttempt, string>;
  unknownTerms!: Table<UnknownTerm, string>;
  skillAttempts!: Table<SkillAttempt, string>;
  budgetItems!: Table<BudgetItem, string>;

  constructor(name = 'denko2-companion') {
    super(name);
    this.version(SCHEMA_VERSION).stores({
      settings: 'id',
      lessonProgress: 'lessonId, completedAt',
      adminTaskStates: 'taskId, doneAt',
      studySessions: 'id, jstDate, kind, lessonId',
      questionAttempts: 'id, jstDate, topicId, scored',
      unknownTerms: 'id, createdAt, resolvedAt',
      skillAttempts: 'id, attemptedAt, candidateNo',
      budgetItems: 'id, category, status',
    });
  }
}

export const db = new Denko2Db();
