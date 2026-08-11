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

/** テーブルごとの主キー。同期のマージ規則と同じものを使う */
const PRIMARY_KEY: Record<string, string> = {
  settings: 'id',
  lessonProgress: 'lessonId',
  adminTaskStates: 'taskId',
  studySessions: 'id',
  questionAttempts: 'id',
  mockExams: 'id',
  unknownTerms: 'id',
  skillAttempts: 'id',
  budgetItems: 'id',
};

/** 未来の updatedAt をどこまで許すか。端末の時計ずれを見込んで1日 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * 行単位の検証。root と配列の形だけ見ていたので、
 * **主キーの欠落・重複・壊れた updatedAt** が素通りしていた。
 *
 * とくに危ないのが未来の updatedAt。マージは新しい方を採るので、
 * 3000年の日付を持つ行は**永久に勝ち続け**、以後どの端末で直しても上書きされる。
 * 手で同期ファイルを触った1回の事故が、全端末に恒久的に固着する。
 *
 * 壊れた行を黙って捨てない。ファイルごと弾いて本人に知らせる(AT-009 と同じ規律)。
 */
export function validateRows(
  d: Record<string, unknown>,
  now: Date = new Date(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const limit = now.getTime() + MAX_CLOCK_SKEW_MS;

  for (const [table, key] of Object.entries(PRIMARY_KEY)) {
    const rows = d[table];
    if (!Array.isArray(rows)) continue;
    const seen = new Set<string>();

    rows.forEach((row, i) => {
      const path = `data.${table}[${i}]`;
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        issues.push({ path, message: 'オブジェクトではない' });
        return;
      }
      const r = row as Record<string, unknown>;

      const id = r[key];
      if (typeof id !== 'string' || id.trim() === '') {
        issues.push({ path: `${path}.${key}`, message: '主キーが無い、または文字列ではない' });
      } else if (seen.has(id)) {
        issues.push({ path: `${path}.${key}`, message: `主キーが重複している: ${id}` });
      } else {
        seen.add(id);
      }

      // 点数の値域。50問で80問正解のような行を復元・同期で入れない。
      // 入ってしまうと160点として平均に効き、受験判断をそのまま誤らせる
      if (table === 'mockExams') {
        const total = r.totalQuestions;
        const correct = r.correctCount;
        if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
          issues.push({ path: `${path}.totalQuestions`, message: '問題数が正の数ではない' });
        } else if (typeof correct !== 'number' || !Number.isFinite(correct)) {
          issues.push({ path: `${path}.correctCount`, message: '正答数が数値ではない' });
        } else if (correct < 0 || correct > total) {
          issues.push({
            path: `${path}.correctCount`,
            message: `正答数(${correct})が0〜問題数(${total})の範囲にない`,
          });
        }
      }

      const updatedAt = r.updatedAt;
      if (updatedAt !== undefined) {
        if (typeof updatedAt !== 'string') {
          issues.push({ path: `${path}.updatedAt`, message: '文字列ではない' });
        } else {
          const t = Date.parse(updatedAt);
          if (Number.isNaN(t)) {
            issues.push({ path: `${path}.updatedAt`, message: `日時として読めない: ${updatedAt}` });
          } else if (t > limit) {
            issues.push({
              path: `${path}.updatedAt`,
              message: `未来の日時(${updatedAt})。この行が同期で永久に勝ち続けてしまう`,
            });
          }
        }
      }
    });
  }

  return issues;
}

export function validateBackup(text: string, now: Date = new Date()): ValidationResult {
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

  issues.push(...validateRows(d, now));

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
