/**
 * JSONバックアップ / 復元(FR-019 / AT-009)。
 *
 * 最重要の不変条件: **壊れたJSONで既存データを消さない**。
 * 検証をすべて通ってから初めて DB へ触る。検証中は一切書き込まない。
 */

import { nowJstIso } from './jst';
import { SCHEMA_VERSION, SEED_UPDATED_AT } from './types';
import type { BackupFile } from './types';

export const APP_VERSION = '0.1.0';

export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  | { ok: true; backup: BackupFile; migratedFrom?: number }
  | { ok: false; issues: ValidationIssue[] };

const TABLES = [
  'settings',
  'lessonProgress',
  'adminTaskStates',
  'studySessions',
  'questionAttempts',
  'mockExams',
  'unknownTerms',
  'skillAttempts',
  'budgetItems',
] as const;

export function buildBackup(
  data: BackupFile['data'],
  now: Date = new Date(),
): BackupFile {
  return {
    kind: 'denko2-companion-backup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowJstIso(now),
    appVersion: APP_VERSION,
    data,
  };
}

/**
 * 旧 schemaVersion からの移行(AT-009)。
 * 段ごとの変換を順に当てる。分岐を版ごとにコピーすると、版が増えたとき
 * 「v1のときだけ updatedAt を足し忘れる」ような穴が必ず開く。
 */
export function migrate(raw: BackupFile): { backup: BackupFile; migratedFrom?: number } {
  if (raw.schemaVersion === SCHEMA_VERSION) return { backup: raw };
  if (raw.schemaVersion > SCHEMA_VERSION || raw.schemaVersion < 0) {
    throw new Error(`unsupported schemaVersion: ${raw.schemaVersion}`);
  }

  const from = raw.schemaVersion;
  let data = raw.data;

  if (from < 1) {
    // v0 → v1: studySessions に countsAsBasics が無かった。既定 true で補う。
    data = {
      ...data,
      studySessions: (data.studySessions ?? []).map((s) => ({
        ...s,
        countsAsBasics: s.countsAsBasics ?? true,
      })),
    };
  }

  if (from < 2) {
    // v1 → v2: 模試セッション(mockExams)が無かった。空で足すだけでよい。
    data = { ...data, mockExams: data.mockExams ?? [] };
  }

  if (from < 3) {
    // v2 → v3: 端末間同期のため全行へ updatedAt を足す。
    // 実在の時刻から埋め戻す。無ければ「最古」として扱われる値を入れ、
    // 他端末の実データに勝たせない。
    data = {
      ...data,
      studySessions: (data.studySessions ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? r.startedAt ?? SEED_UPDATED_AT,
      })),
      questionAttempts: (data.questionAttempts ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? r.reviewedAt ?? r.attemptedAt ?? SEED_UPDATED_AT,
      })),
      mockExams: (data.mockExams ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? r.takenAt ?? SEED_UPDATED_AT,
      })),
      unknownTerms: (data.unknownTerms ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? r.resolvedAt ?? r.createdAt ?? SEED_UPDATED_AT,
      })),
      skillAttempts: (data.skillAttempts ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? r.attemptedAt ?? SEED_UPDATED_AT,
      })),
      budgetItems: (data.budgetItems ?? []).map((r) => ({
        ...r,
        updatedAt: r.updatedAt ?? SEED_UPDATED_AT,
      })),
    };
  }

  return { backup: { ...raw, schemaVersion: SCHEMA_VERSION, data }, migratedFrom: from };
}

export function validateBackup(text: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [{ path: '(file)', message: `JSONとして読めない: ${String(e)}` }] };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issues: [{ path: '(root)', message: 'オブジェクトではない' }] };
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.kind !== 'denko2-companion-backup') {
    issues.push({ path: 'kind', message: 'このアプリのバックアップではない' });
  }
  if (typeof obj.schemaVersion !== 'number') {
    issues.push({ path: 'schemaVersion', message: '数値ではない' });
  } else if (obj.schemaVersion > SCHEMA_VERSION) {
    issues.push({
      path: 'schemaVersion',
      message: `新しいバージョン(${obj.schemaVersion})のため読み込めない。アプリを更新してください`,
    });
  }

  const data = obj.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push({ path: 'data', message: 'data が無い' });
    return { ok: false, issues };
  }
  const d = data as Record<string, unknown>;
  for (const table of TABLES) {
    const v = d[table];
    if (v === undefined) {
      // 欠けているテーブルは空配列として許容する(将来テーブルが増えたときの前方互換)
      d[table] = [];
      continue;
    }
    if (!Array.isArray(v)) issues.push({ path: `data.${table}`, message: '配列ではない' });
  }

  const settings = d.settings;
  if (Array.isArray(settings) && settings.length > 0) {
    const s = settings[0] as Record<string, unknown>;
    if (typeof s.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) {
      issues.push({ path: 'data.settings[0].startDate', message: 'YYYY-MM-DD ではない' });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  try {
    const { backup, migratedFrom } = migrate(obj as unknown as BackupFile);
    return migratedFrom === undefined ? { ok: true, backup } : { ok: true, backup, migratedFrom };
  } catch (e) {
    return { ok: false, issues: [{ path: 'schemaVersion', message: String(e) }] };
  }
}

export function backupFileName(now: Date = new Date()): string {
  return `denko2-backup-${nowJstIso(now).slice(0, 10)}.json`;
}
