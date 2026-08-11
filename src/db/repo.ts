/**
 * DB アクセスの唯一の入口。ドメイン層は純関数のままにして、副作用をここへ寄せる。
 */

import type { Denko2Db } from './db';
import { db as defaultDb } from './db';
import { nowJstIso, todayJst } from '../domain/jst';
import { buildBackup } from '../domain/backup';
import { applyReview, buildExamRecords, type ExamInput } from '../domain/academic';
import { SCHEMA_VERSION, SEED_UPDATED_AT } from '../domain/types';
import type {
  AdminTaskState,
  BackupFile,
  BudgetItem,
  IsoDate,
  LessonProgress,
  MockExam,
  QuestionAttempt,
  SessionKind,
  SkillAttempt,
  StudySession,
  SyncConfig,
  UnknownTerm,
  UserSettings,
} from '../domain/types';

/**
 * 書き込みが起きたことの通知。同期エンジンがこれを拾って送信を予約する。
 * 画面側の呼び出し(19か所)を書き換えずに済むよう、入口である Repo 側で鳴らす。
 */
type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

export function onRepoChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function emitChange(): void {
  for (const listener of changeListeners) {
    try {
      listener();
    } catch {
      // 通知先の失敗で保存を巻き戻さない。同期が遅れるだけにする
    }
  }
}

export type VaultSnapshot = {
  settings?: UserSettings;
  lessonProgress: Record<string, LessonProgress>;
  adminTaskStates: Record<string, AdminTaskState>;
  studySessions: StudySession[];
  questionAttempts: QuestionAttempt[];
  mockExams: MockExam[];
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
      mockExams,
      unknownTerms,
      skillAttempts,
      budgetItems,
    ] = await Promise.all([
      this.db.settings.toArray(),
      this.db.lessonProgress.toArray(),
      this.db.adminTaskStates.toArray(),
      this.db.studySessions.toArray(),
      this.db.questionAttempts.toArray(),
      this.db.mockExams.toArray(),
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
      mockExams,
      unknownTerms,
      skillAttempts,
      budgetItems,
    };
  }

  async saveSettings(settings: UserSettings, now: Date = new Date()): Promise<void> {
    await this.db.settings.put({ ...settings, updatedAt: nowJstIso(now) });
    emitChange();
  }

  async saveLessonProgress(progress: LessonProgress): Promise<void> {
    await this.db.lessonProgress.put(progress);
    emitChange();
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
    emitChange();
  }

  async setAdminTaskDue(taskId: string, dueAt: string | undefined, now = new Date()): Promise<void> {
    const existing = await this.db.adminTaskStates.get(taskId);
    await this.db.adminTaskStates.put({
      taskId,
      ...existing,
      dueOverrideAt: dueAt,
      updatedAt: nowJstIso(now),
    });
    emitChange();
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
      updatedAt: nowJstIso(now),
    };
    await this.db.studySessions.put(session);
    emitChange();
    return session;
  }

  async addUnknownTerms(terms: string[], origin: string, now: Date = new Date()): Promise<void> {
    const rows: UnknownTerm[] = terms
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3) // 最大3つ(FR-003)
      .map((term) => ({
        id: newId('term'),
        term,
        createdAt: nowJstIso(now),
        origin,
        updatedAt: nowJstIso(now),
      }));
    if (rows.length > 0) {
      await this.db.unknownTerms.bulkPut(rows);
      emitChange();
    }
  }

  /** 小テスト・模試を1セッションとして保存する(FR-010) */
  async recordExam(input: ExamInput, now: Date = new Date()): Promise<MockExam> {
    const examId = newId('exam');
    const { exam, attempts } = buildExamRecords(
      input,
      { examId, attemptId: (i) => `${examId}_q${i + 1}` },
      nowJstIso(now),
      todayJst(now),
    );
    await this.db.transaction('rw', [this.db.mockExams, this.db.questionAttempts], async () => {
      await this.db.mockExams.put(exam);
      await this.db.questionAttempts.bulkPut(attempts);
    });
    emitChange();
    return exam;
  }

  /**
   * 解き直しの記録。**解けたかどうかを必ず受け取る。**
   * 「解き直した」を押しただけで永久にキューから消すと、覚えていない問題が
   * 静かに消える。解けたら間隔を広げ、解けなければ翌日また出す。
   */
  async markReviewed(
    attemptIds: string[],
    correct: boolean,
    now: Date = new Date(),
  ): Promise<void> {
    const stamp = nowJstIso(now);
    const today = todayJst(now);
    await this.db.transaction('rw', this.db.questionAttempts, async () => {
      for (const id of attemptIds) {
        const a = await this.db.questionAttempts.get(id);
        if (a) await this.db.questionAttempts.put(applyReview(a, correct, stamp, today));
      }
    });
    emitChange();
  }

  async addSkillAttempt(
    input: Omit<SkillAttempt, 'id' | 'attemptedAt' | 'updatedAt'>,
    now: Date = new Date(),
  ): Promise<SkillAttempt> {
    const attempt: SkillAttempt = {
      kind: 'candidate',
      ...input,
      id: newId('skill'),
      attemptedAt: nowJstIso(now),
      updatedAt: nowJstIso(now),
    };
    await this.db.skillAttempts.put(attempt);
    emitChange();
    return attempt;
  }

  /**
   * 反復欠陥の部分練習(drill)。その工程だけを繰り返した記録。
   * 候補問題の1回としては数えない(13問到達や直近3作品の判定に混ぜない)。
   */
  async addDefectDrill(
    input: { codes: string[]; minutes: number; note?: string },
    now: Date = new Date(),
  ): Promise<SkillAttempt> {
    const attempt = await this.addSkillAttempt(
      {
        kind: 'drill',
        candidateNo: 0,
        workMinutes: Math.max(1, input.minutes),
        completed: true,
        defectFree: true,
        defectCodes: [],
        clearedDefectCodes: input.codes,
        photoIds: [],
        nextFix: input.note,
      },
      now,
    );
    await this.addSession(
      {
        durationMinutes: Math.max(1, input.minutes),
        kind: 'basic-skill',
        countsAsBasics: false,
        nextFix: input.note,
      },
      now,
    );
    return attempt;
  }

  async saveBudgetItem(item: BudgetItem, now: Date = new Date()): Promise<void> {
    await this.db.budgetItems.put({ ...item, updatedAt: nowJstIso(now) });
    emitChange();
  }

  /**
   * カタログ既定の播き直し。updatedAt は SEED_UPDATED_AT(1970年)で入れる。
   * 現在時刻を入れると、新しい端末が初めて技能タブを開いた瞬間に
   * 他端末の「購入済み」を既定値で上書きしてしまう。既定値は常に負ける側に置く。
   */
  async seedBudgetItems(items: BudgetItem[]): Promise<void> {
    const existing = await this.db.budgetItems.toArray();
    const known = new Set(existing.map((i) => i.id));
    const fresh = items
      .filter((i) => !known.has(i.id))
      .map((i) => ({ ...i, updatedAt: SEED_UPDATED_AT }));
    if (fresh.length > 0) {
      await this.db.budgetItems.bulkPut(fresh);
      emitChange();
    }
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
        mockExams: snapshot.mockExams,
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
        this.db.mockExams,
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
          this.db.mockExams.clear(),
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
          this.db.mockExams.bulkPut(d.mockExams ?? []),
          this.db.unknownTerms.bulkPut(d.unknownTerms),
          this.db.skillAttempts.bulkPut(d.skillAttempts),
          this.db.budgetItems.bulkPut(d.budgetItems),
        ]);
      },
    );
    emitChange();
  }

  /**
   * 同期で合体した結果を書き戻す。**clear を1回も呼ばない**のが importBackup との違い。
   *
   * 同期は「片方に無い = 消された」と解釈しない(merge.ts の不変条件1)。
   * ここで clear を入れると、リモートがまだ空の初回同期で、この端末の記録が消える。
   */
  async applyMerged(d: BackupFile['data']): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.settings,
        this.db.lessonProgress,
        this.db.adminTaskStates,
        this.db.studySessions,
        this.db.questionAttempts,
        this.db.mockExams,
        this.db.unknownTerms,
        this.db.skillAttempts,
        this.db.budgetItems,
      ],
      async () => {
        await Promise.all([
          this.db.settings.bulkPut(d.settings),
          this.db.lessonProgress.bulkPut(d.lessonProgress),
          this.db.adminTaskStates.bulkPut(d.adminTaskStates),
          this.db.studySessions.bulkPut(d.studySessions),
          this.db.questionAttempts.bulkPut(d.questionAttempts),
          this.db.mockExams.bulkPut(d.mockExams ?? []),
          this.db.unknownTerms.bulkPut(d.unknownTerms),
          this.db.skillAttempts.bulkPut(d.skillAttempts),
          this.db.budgetItems.bulkPut(d.budgetItems),
        ]);
      },
    );
    // ここでは emitChange しない。同期の書き戻しがまた同期を呼ぶ輪を作らないため
  }

  async getSyncConfig(): Promise<SyncConfig | undefined> {
    return this.db.syncMeta.get('main');
  }

  async saveSyncConfig(config: SyncConfig): Promise<void> {
    await this.db.syncMeta.put(config);
  }

  async patchSyncConfig(patch: Partial<SyncConfig>): Promise<void> {
    const current = await this.db.syncMeta.get('main');
    if (!current) return;
    await this.db.syncMeta.put({ ...current, ...patch });
  }

  async clearSyncConfig(): Promise<void> {
    await this.db.syncMeta.clear();
  }

  /**
   * 全削除。呼び出し側で2段階確認とバックアップ案内を行う(FR-019)。
   *
   * 同期設定も一緒に消す。残したままだと次の同期でクラウドから全部戻ってきて、
   * 「消したのに消えていない」という一番たちの悪い状態になる。
   * なお**クラウド側のデータは消さない**。この端末が真っ白になるだけ。
   */
  async wipe(): Promise<void> {
    await this.db.syncMeta.clear();
    await Promise.all([
      this.db.settings.clear(),
      this.db.lessonProgress.clear(),
      this.db.adminTaskStates.clear(),
      this.db.studySessions.clear(),
      this.db.questionAttempts.clear(),
      this.db.mockExams.clear(),
      this.db.unknownTerms.clear(),
      this.db.skillAttempts.clear(),
      this.db.budgetItems.clear(),
    ]);
  }
}

export const repo = new Repo();
