/**
 * DB アクセスの唯一の入口。ドメイン層は純関数のままにして、副作用をここへ寄せる。
 */

import type { Denko2Db } from './db';
import { db as defaultDb } from './db';
import { nowJstIso, todayJst } from '../domain/jst';
import { buildBackup } from '../domain/backup';
import { SCHEMA_VERSION } from '../domain/types';
import type {
  AdminTaskState,
  BackupFile,
  BudgetItem,
  IsoDate,
  LessonProgress,
  QuestionAttempt,
  SessionKind,
  SkillAttempt,
  StudySession,
  UnknownTerm,
  UserSettings,
} from '../domain/types';

export type VaultSnapshot = {
  settings?: UserSettings;
  lessonProgress: Record<string, LessonProgress>;
  adminTaskStates: Record<string, AdminTaskState>;
  studySessions: StudySession[];
  questionAttempts: QuestionAttempt[];
  unknownTerms: UnknownTerm[];
  skillAttempts: SkillAttempt[];
  budgetItems: BudgetItem[];
};

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

export function defaultSettings(
  examCycleId: string,
  now: Date = new Date(),
): UserSettings {
  const stamp = nowJstIso(now);
  return {
    id: 'main',
    schemaVersion: SCHEMA_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    startDate: todayJst(now),
    examCycleId,
    academicMode: 'cbt',
    academicReserved: false,
    weekdayMinutes: 35,
    weekendMinutes: 150,
    knowledgeLevel: 0,
    handworkLevel: 0,
    toolLevel: 0,
    motivation: '',
    beginnerMode: true,
    diagnosticUnlockedManually: false,
  };
}

export class Repo {
  constructor(private readonly db: Denko2Db = defaultDb) {}

  async load(): Promise<VaultSnapshot> {
    const [
      settingsRows,
      lessonProgress,
      adminTaskStates,
      studySessions,
      questionAttempts,
      unknownTerms,
      skillAttempts,
      budgetItems,
    ] = await Promise.all([
      this.db.settings.toArray(),
      this.db.lessonProgress.toArray(),
      this.db.adminTaskStates.toArray(),
      this.db.studySessions.toArray(),
      this.db.questionAttempts.toArray(),
      this.db.unknownTerms.toArray(),
      this.db.skillAttempts.toArray(),
      this.db.budgetItems.toArray(),
    ]);

    return {
      settings: settingsRows[0],
      lessonProgress: Object.fromEntries(lessonProgress.map((p) => [p.lessonId, p])),
      adminTaskStates: Object.fromEntries(adminTaskStates.map((s) => [s.taskId, s])),
      studySessions,
      questionAttempts,
      unknownTerms,
      skillAttempts,
      budgetItems,
    };
  }

  async saveSettings(settings: UserSettings, now: Date = new Date()): Promise<void> {
    await this.db.settings.put({ ...settings, updatedAt: nowJstIso(now) });
  }

  async saveLessonProgress(progress: LessonProgress): Promise<void> {
    await this.db.lessonProgress.put(progress);
  }

  async setAdminTaskDone(
    taskId: string,
    done: boolean,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = await this.db.adminTaskStates.get(taskId);
    await this.db.adminTaskStates.put({
      taskId,
      ...existing,
      doneAt: done ? nowJstIso(now) : undefined,
      updatedAt: nowJstIso(now),
    });
  }

  async setAdminTaskDue(taskId: string, dueAt: string | undefined, now = new Date()): Promise<void> {
    const existing = await this.db.adminTaskStates.get(taskId);
    await this.db.adminTaskStates.put({
      taskId,
      ...existing,
      dueOverrideAt: dueAt,
      updatedAt: nowJstIso(now),
    });
  }

  async addSession(input: {
    /** 実績時間。呼び出し側で実測または本人入力を通した値を渡すこと */
    durationMinutes: number;
    estimatedMinutes?: number;
    measuredMinutes?: number;
    kind: SessionKind;
    lessonId?: string;
    /** 基礎180分ゲートへ算入するか。既定は false で、明示した場合だけ数える */
    countsAsBasics: boolean;
    nextFix?: string;
    jstDate?: IsoDate;
  }, now: Date = new Date()): Promise<StudySession> {
    const session: StudySession = {
      id: newId('ses'),
      startedAt: nowJstIso(now),
      jstDate: input.jstDate ?? todayJst(now),
      durationMinutes: input.durationMinutes,
      estimatedMinutes: input.estimatedMinutes,
      measuredMinutes: input.measuredMinutes,
      kind: input.kind,
      lessonId: input.lessonId,
      nextFix: input.nextFix,
      countsAsBasics: input.countsAsBasics,
    };
    await this.db.studySessions.put(session);
    return session;
  }

  async addUnknownTerms(terms: string[], origin: string, now: Date = new Date()): Promise<void> {
    const rows: UnknownTerm[] = terms
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3) // 最大3つ(FR-003)
      .map((term) => ({ id: newId('term'), term, createdAt: nowJstIso(now), origin }));
    if (rows.length > 0) await this.db.unknownTerms.bulkPut(rows);
  }

  async exportBackup(now: Date = new Date()): Promise<BackupFile> {
    const snapshot = await this.load();
    return buildBackup(
      {
        settings: snapshot.settings ? [snapshot.settings] : [],
        lessonProgress: Object.values(snapshot.lessonProgress),
        adminTaskStates: Object.values(snapshot.adminTaskStates),
        studySessions: snapshot.studySessions,
        questionAttempts: snapshot.questionAttempts,
        unknownTerms: snapshot.unknownTerms,
        skillAttempts: snapshot.skillAttempts,
        budgetItems: snapshot.budgetItems,
      },
      now,
    );
  }

  /**
   * 復元。検証済みの BackupFile だけを受け取る。
   * ここへ来る前に validateBackup を通すこと。トランザクション内で置換する。
   */
  async importBackup(backup: BackupFile): Promise<void> {
    const d = backup.data;
    await this.db.transaction(
      'rw',
      [
        this.db.settings,
        this.db.lessonProgress,
        this.db.adminTaskStates,
        this.db.studySessions,
        this.db.questionAttempts,
        this.db.unknownTerms,
        this.db.skillAttempts,
        this.db.budgetItems,
      ],
      async () => {
        await Promise.all([
          this.db.settings.clear(),
          this.db.lessonProgress.clear(),
          this.db.adminTaskStates.clear(),
          this.db.studySessions.clear(),
          this.db.questionAttempts.clear(),
          this.db.unknownTerms.clear(),
          this.db.skillAttempts.clear(),
          this.db.budgetItems.clear(),
        ]);
        await Promise.all([
          this.db.settings.bulkPut(d.settings),
          this.db.lessonProgress.bulkPut(d.lessonProgress),
          this.db.adminTaskStates.bulkPut(d.adminTaskStates),
          this.db.studySessions.bulkPut(d.studySessions),
          this.db.questionAttempts.bulkPut(d.questionAttempts),
          this.db.unknownTerms.bulkPut(d.unknownTerms),
          this.db.skillAttempts.bulkPut(d.skillAttempts),
          this.db.budgetItems.bulkPut(d.budgetItems),
        ]);
      },
    );
  }

  /** 全削除。呼び出し側で2段階確認とバックアップ案内を行う(FR-019) */
  async wipe(): Promise<void> {
    await Promise.all([
      this.db.settings.clear(),
      this.db.lessonProgress.clear(),
      this.db.adminTaskStates.clear(),
      this.db.studySessions.clear(),
      this.db.questionAttempts.clear(),
      this.db.unknownTerms.clear(),
      this.db.skillAttempts.clear(),
      this.db.budgetItems.clear(),
    ]);
  }
}

export const repo = new Repo();
