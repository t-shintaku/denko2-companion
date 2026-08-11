/**
 * IndexedDB(Dexie)。アカウント不要・端末ローカル(FR-019)。
 * 写真は Sprint 3 で Blob テーブルへ入れる。JSON へ base64 を大量に埋め込まない。
 *
 * v3 で端末間同期に対応した。IndexedDB は「ブラウザ1つにつき1個の箱」なので、
 * スマホ・PC・タブレットは放っておくと別々の正答率とゲート判定を出す。
 * 同期の判定材料として、全ユーザーデータへ updatedAt を持たせる(§types.Synced)。
 */

import Dexie from 'dexie';
import type { Table } from 'dexie';
import { SCHEMA_VERSION, SEED_UPDATED_AT } from '../domain/types';
import type {
  AdminTaskState,
  BudgetItem,
  LessonProgress,
  MockExam,
  QuestionAttempt,
  SkillAttempt,
  StudySession,
  SyncConfig,
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
  /** 同期設定。ユーザーデータではないのでバックアップにも同期対象にも含めない */
  syncMeta!: Table<SyncConfig, string>;

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

    // v3: 端末間同期。updatedAt を全テーブルへ足し、既存行は実在の時刻から埋め戻す。
    // 既存データは1行も消さない。
    this.version(3)
      .stores({
        studySessions: 'id, jstDate, kind, lessonId, updatedAt',
        questionAttempts: 'id, jstDate, topicId, scored, examId, reviewedAt, updatedAt',
        mockExams: 'id, jstDate, kind, takenAt, updatedAt',
        unknownTerms: 'id, createdAt, resolvedAt, updatedAt',
        skillAttempts: 'id, attemptedAt, candidateNo, updatedAt',
        budgetItems: 'id, category, status, updatedAt',
        syncMeta: 'id',
      })
      .upgrade(async (tx) => {
        const stamp = new Date().toISOString();

        await tx.table('studySessions').toCollection().modify((r: StudySession) => {
          r.updatedAt ??= r.startedAt ?? stamp;
        });
        await tx.table('questionAttempts').toCollection().modify((r: QuestionAttempt) => {
          r.updatedAt ??= r.reviewedAt ?? r.attemptedAt ?? stamp;
        });
        await tx.table('mockExams').toCollection().modify((r: MockExam) => {
          r.updatedAt ??= r.takenAt ?? stamp;
        });
        await tx.table('unknownTerms').toCollection().modify((r: UnknownTerm) => {
          r.updatedAt ??= r.resolvedAt ?? r.createdAt ?? stamp;
        });
        await tx.table('skillAttempts').toCollection().modify((r: SkillAttempt) => {
          r.updatedAt ??= r.attemptedAt ?? stamp;
        });
        // 予算だけは更新時刻の手がかりが無い。既定値の播き直し(SEED_UPDATED_AT)より
        // 必ず新しくしておく。そうしないと本人が入れた「購入済み」がカタログ既定へ戻る。
        await tx.table('budgetItems').toCollection().modify((r: BudgetItem) => {
          r.updatedAt ??= stamp;
        });
        if (SEED_UPDATED_AT >= stamp) {
          throw new Error('SEED_UPDATED_AT が現在時刻より新しい。既定値が本人の入力を上書きする');
        }
      });

    if (SCHEMA_VERSION !== 3) {
      throw new Error(`SCHEMA_VERSION と Dexie のバージョン定義がずれている: ${SCHEMA_VERSION}`);
    }
  }
}

export const db = new Denko2Db();
