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
  MockExam,
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
  mockExams!: Table<MockExam, string>;
  unknownTerms!: Table<UnknownTerm, string>;
  skillAttempts!: Table<SkillAttempt, string>;
  budgetItems!: Table<BudgetItem, string>;

  constructor(name = 'denko2-companion') {
    super(name);

    // v1: Sprint 1(初回設定・事務期限・レッスン)
    this.version(1).stores({
      settings: 'id',
      lessonProgress: 'lessonId, completedAt',
      adminTaskStates: 'taskId, doneAt',
      studySessions: 'id, jstDate, kind, lessonId',
      questionAttempts: 'id, jstDate, topicId, scored',
      unknownTerms: 'id, createdAt, resolvedAt',
      skillAttempts: 'id, attemptedAt, candidateNo',
      budgetItems: 'id, category, status',
    });

    // v2: Sprint 2(模試セッション・復習キュー)。既存データは消さずに引き継ぐ
    this.version(2).stores({
      questionAttempts: 'id, jstDate, topicId, scored, examId, reviewedAt',
      mockExams: 'id, jstDate, kind, takenAt',
    });

    if (SCHEMA_VERSION !== 2) {
      throw new Error(`SCHEMA_VERSION と Dexie のバージョン定義がずれている: ${SCHEMA_VERSION}`);
    }
  }
}

export const db = new Denko2Db();
