/**
 * 端末間同期のマージ。**純関数。ここに同期の正しさを全部集める。**
 *
 * 不変条件(これを破る変更を入れないこと):
 *
 * 1. **削除しない。** ローカルに無くリモートにある行は復元する。逆も同じ。
 *    片方に無いことを「消された」と解釈しない。この規則があるので、
 *    ある端末で「全削除」を押しても他端末の記録は死なない。
 * 2. **収束する。** 3端末が任意の順で同期しても同じ結果へ落ちる。
 *    そのために勝者判定を内容だけで決める(「ローカルを優先」は端末ごとに
 *    別の勝者を出すので永久にズレる。絶対に入れない)。
 * 3. **進んだ事実は戻さない。** 一度完了した段階フラグは、古い設定が飛んできても消えない。
 *
 * 時刻比較は Date.parse で行う。文字列比較にしてはいけない —
 * nowJstIso は '+09:00'、Dexie の移行時は 'Z' を書くので、辞書順では逆転する。
 */

import { SCHEMA_VERSION } from './types';
import type { BackupFile, IsoDateTime, LessonProgress, UserSettings } from './types';

export type MergeCount = {
  /** リモートから取り込んで増えた・更新された行 */
  incoming: number;
  /** リモートに無く、こちらから送る行 */
  outgoing: number;
};

export type TableName = keyof BackupFile['data'];

/** テーブルごとの主キー。ここ以外に id の知識を散らかさない */
export const PRIMARY_KEY: Record<TableName, string> = {
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

export const TABLE_NAMES = Object.keys(PRIMARY_KEY) as TableName[];

type Row = Record<string, unknown> & { updatedAt?: IsoDateTime };

function time(row: Row): number {
  const t = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
  // updatedAt が無い/壊れている行は最古として扱う。捨てはしない
  return Number.isNaN(t) ? -Infinity : t;
}

/** キー順に並べた JSON。同時刻の決着を内容だけで付けるための正規形 */
export function canonical(row: Row): string {
  const keys = Object.keys(row).sort();
  return JSON.stringify(keys.map((k) => [k, row[k] === undefined ? null : row[k]]));
}

/**
 * 同一キーの2行から勝者を選ぶ。
 * updatedAt が新しい方。同時刻なら正規形の大きい方(内容だけで決まるので全端末で一致する)。
 */
export function pickWinner<T extends Row>(a: T, b: T): T {
  const ta = time(a);
  const tb = time(b);
  if (ta !== tb) return ta > tb ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

export type MergedTable<T> = { rows: T[]; count: MergeCount };

/** 同じキーの2行から1行を作る規則。既定は行ごと勝ち抜き(pickWinner) */
export type Combine<T> = (mine: T, theirs: T) => T;

/**
 * 1テーブル分の合体。ローカルとリモートの和集合を取り、衝突は combine で決める。
 * 戻り値の rows は主キー昇順。端末によって並びが変わらないようにするため。
 */
export function mergeTable<T extends Row>(
  local: T[],
  remote: T[],
  key: string,
  combine: Combine<T> = pickWinner,
): MergedTable<T> {
  const localByKey = new Map<string, T>();
  for (const row of local) localByKey.set(String(row[key]), row);
  const remoteByKey = new Map<string, T>();
  for (const row of remote) remoteByKey.set(String(row[key]), row);

  const out = new Map<string, T>();
  let incoming = 0;
  let outgoing = 0;

  for (const k of new Set([...localByKey.keys(), ...remoteByKey.keys()])) {
    const mine = localByKey.get(k);
    const theirs = remoteByKey.get(k);
    const merged = mine && theirs ? combine(mine, theirs) : (mine ?? theirs)!;
    out.set(k, merged);

    // 合体後の姿が自分のと違えば取り込み、相手のと違えば送信。
    // 「勝った/負けた」ではなく「差があるか」で数える。項目単位の合体では
    // どちらの行とも一致しない第三の行ができるため
    if (!mine || canonical(mine) !== canonical(merged)) incoming += 1;
    if (!theirs || canonical(theirs) !== canonical(merged)) outgoing += 1;
  }

  const rows = [...out.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([, v]) => v);
  return { rows, count: { incoming, outgoing } };
}

/**
 * レッスン進捗は**行ごと勝ち抜きにしてはいけない**。
 *
 * 4段階(見る→閉じて答える→解く→1点残す)は別々の端末で別々に進む。
 * PCで「閉じて答える」、スマホで「解く」を進めたとき、行ごと置換だと
 * updatedAt が新しい側で丸ごと上書きされ、片方の回答が消える。
 * 消えるのは本人が実際にやった学習そのものなので取り返しがつかない。
 *
 * 段階ごとに突き合わせる。段階は一度立ったら降りない(単調)ので、
 * どの順で合体しても同じ結果になる。
 */
const STEP_GROUPS = [
  { at: 'inputViewedAt', payload: [] as string[] },
  { at: 'recallSubmittedAt', payload: ['recallAnswers'] },
  { at: 'practiceSubmittedAt', payload: ['practiceNote', 'practiceCorrect', 'practiceTotal'] },
  { at: 'takeawaySavedAt', payload: ['takeaway'] },
] as const;

type StepGroup = (typeof STEP_GROUPS)[number];

/** 1つの段階(時刻+その段階の回答)だけを取り出した正規形 */
function groupCanonical(row: LessonProgress, group: StepGroup): string {
  const picked: Row = {};
  for (const key of [group.at, ...group.payload]) {
    picked[key] = (row as Record<string, unknown>)[key];
  }
  return canonical(picked);
}

export function mergeLessonProgress(mine: LessonProgress, theirs: LessonProgress): LessonProgress {
  const ta = Date.parse(mine.updatedAt);
  const tb = Date.parse(theirs.updatedAt);
  // 段階に紐づかない欄(学習モード)は新しい方。同時刻なら値そのもので決める
  const newer =
    ta === tb ? (String(mine.mode ?? '') >= String(theirs.mode ?? '') ? mine : theirs) : ta > tb ? mine : theirs;
  const merged: LessonProgress = {
    lessonId: mine.lessonId,
    mode: newer.mode,
    xpAwarded: Math.max(mine.xpAwarded ?? 0, theirs.xpAwarded ?? 0),
    updatedAt: Date.parse(mine.updatedAt) >= Date.parse(theirs.updatedAt) ? mine.updatedAt : theirs.updatedAt,
  };

  for (const group of STEP_GROUPS) {
    const a = mine[group.at as keyof LessonProgress] as string | undefined;
    const b = theirs[group.at as keyof LessonProgress] as string | undefined;
    // 片方にしか無ければ、それが唯一の事実。必ず残す(ここが消えていた)。
    // 同時刻のときに「自分側」を採ると、PC→スマホとスマホ→PCで別の答えが残り
    // 永久に収束しない。保存時刻は秒単位なので同値は現実に起こる。
    // 内容だけで決まる正規形で決着させる(どの端末から見ても同じ勝者になる)
    const sameTime = a !== undefined && b !== undefined && Date.parse(a) === Date.parse(b);
    // 同時刻は**その段階の中身だけ**で比べる。行全体で比べると、
    // 合体済みの行(どちらとも違う第三の行)を次の端末と合体したときに答えが変わり、
    // 3端末の同期順で結果がずれる(結合法則が壊れる)
    const pick = (x: LessonProgress, y: LessonProgress) =>
      groupCanonical(x, group) >= groupCanonical(y, group) ? x : y;
    const source = !a
      ? b
        ? theirs
        : undefined
      : !b
        ? mine
        : sameTime
          ? pick(mine, theirs)
          : Date.parse(a) > Date.parse(b)
            ? mine
            : theirs;
    if (!source) continue;
    const stamp = source[group.at as keyof LessonProgress] as string | undefined;
    if (!stamp) continue;
    (merged as Record<string, unknown>)[group.at] = stamp;
    for (const field of group.payload) {
      const value = (source as Record<string, unknown>)[field];
      if (value !== undefined) (merged as Record<string, unknown>)[field] = value;
    }
  }

  // 一度完了したという事実は取り消さない。最初に完了した時刻を残す
  const completed = [mine.completedAt, theirs.completedAt].filter(Boolean) as string[];
  if (completed.length > 0) {
    merged.completedAt = completed.reduce((x, y) => (Date.parse(x) <= Date.parse(y) ? x : y));
  }

  return merged;
}

/**
 * 一度立ったら二度と降りないフラグ。
 * 「無採点5問を終えた」「診断を終えた」「初回設定を終えた」は、
 * 古い設定が別端末から飛んできても取り消さない。取り消すと段階が巻き戻り、
 * 終わったはずのオンボーディングをもう一度やらされる。
 */
const MONOTONIC_FIELDS = [
  'setupCompletedAt',
  'ungradedFiveCompletedAt',
  'diagnosticCompletedAt',
] as const satisfies readonly (keyof UserSettings)[];

/** 食い違うと学習計画そのものが変わる欄。黙って上書きせず、画面へ出す */
const CRITICAL_FIELDS = [
  'academicMode',
  'academicDate',
  'skillDate',
  'startDate',
  'weekdayMinutes',
  'weekendMinutes',
] as const satisfies readonly (keyof UserSettings)[];

export type SettingsConflict = {
  field: keyof UserSettings;
  local: unknown;
  remote: unknown;
  /** 採用した方 */
  taken: 'local' | 'remote';
};

export type MergedSettings = {
  settings?: UserSettings;
  conflicts: SettingsConflict[];
};

/**
 * 設定は1行しかないので、行ごとの勝敗ではフィールドが道連れで消える。
 * 基本は新しい方を採るが、
 *  - 進んだ段階フラグは早い方(=一度完了したという事実)を残す
 *  - 計画に効く欄が食い違ったら conflicts で返し、画面に出す(黙って捨てない)
 */
export function mergeSettings(
  local: UserSettings | undefined,
  remote: UserSettings | undefined,
): MergedSettings {
  if (!local) return { settings: remote, conflicts: [] };
  if (!remote) return { settings: local, conflicts: [] };

  const winner = pickWinner(local as unknown as Row, remote as unknown as Row) as unknown as UserSettings;
  const takenSide: 'local' | 'remote' = winner === local ? 'local' : 'remote';
  const loser = takenSide === 'local' ? remote : local;

  const merged: UserSettings = { ...winner };
  for (const field of MONOTONIC_FIELDS) {
    const a = winner[field];
    const b = loser[field];
    if (!a && b) merged[field] = b;
    else if (a && b && b < a) merged[field] = b; // 早い方(最初に完了した時刻)を残す
  }

  const conflicts: SettingsConflict[] = [];
  for (const field of CRITICAL_FIELDS) {
    if (local[field] !== remote[field]) {
      conflicts.push({
        field,
        local: local[field],
        remote: remote[field],
        taken: takenSide,
      });
    }
  }

  return { settings: merged, conflicts };
}

export type MergeResult = {
  data: BackupFile['data'];
  counts: Record<TableName, MergeCount>;
  settingsConflicts: SettingsConflict[];
  /** リモートへ送るべき変更があるか */
  needsPush: boolean;
  /** ローカルへ書き戻すべき変更があるか */
  needsPull: boolean;
};

/**
 * 全テーブルの合体。settings だけ別扱い(上の理由)。
 */
export function mergeAll(
  local: BackupFile['data'],
  remote: BackupFile['data'],
): MergeResult {
  const counts = {} as Record<TableName, MergeCount>;
  const data = {} as BackupFile['data'];

  const { settings, conflicts } = mergeSettings(local.settings?.[0], remote.settings?.[0]);
  data.settings = settings ? [settings] : [];
  const localSettings = local.settings?.[0];
  const remoteSettings = remote.settings?.[0];
  counts.settings = {
    incoming:
      settings && (!localSettings || canonical(settings as unknown as Row) !== canonical(localSettings as unknown as Row))
        ? 1
        : 0,
    outgoing:
      settings && (!remoteSettings || canonical(settings as unknown as Row) !== canonical(remoteSettings as unknown as Row))
        ? 1
        : 0,
  };

  for (const table of TABLE_NAMES) {
    if (table === 'settings') continue;
    const merged = mergeTable(
      (local[table] ?? []) as unknown as Row[],
      (remote[table] ?? []) as unknown as Row[],
      PRIMARY_KEY[table],
      table === 'lessonProgress'
        ? (mergeLessonProgress as unknown as Combine<Row>)
        : undefined,
    );
    (data as Record<string, unknown>)[table] = merged.rows;
    counts[table] = merged.count;
  }

  const needsPull = TABLE_NAMES.some((t) => counts[t].incoming > 0);
  const needsPush = TABLE_NAMES.some((t) => counts[t].outgoing > 0);

  return { data, counts, settingsConflicts: conflicts, needsPush, needsPull };
}

export function totalIncoming(counts: Record<TableName, MergeCount>): number {
  return TABLE_NAMES.reduce((n, t) => n + counts[t].incoming, 0);
}

export function totalOutgoing(counts: Record<TableName, MergeCount>): number {
  return TABLE_NAMES.reduce((n, t) => n + counts[t].outgoing, 0);
}

/** 毎回新しい入れ物を返す。共有した空オブジェクトを使い回すと片方の追記が他方へ漏れる */
export function emptyData(): BackupFile['data'] {
  return {
    settings: [],
    lessonProgress: [],
    adminTaskStates: [],
    studySessions: [],
    questionAttempts: [],
    mockExams: [],
    unknownTerms: [],
    skillAttempts: [],
    budgetItems: [],
  };
}

/** 同期ファイルの指紋。同じなら送らない(空コミットを積まない) */
export function digest(data: BackupFile['data']): string {
  const parts = TABLE_NAMES.map((t) => {
    const rows = (data[t] ?? []) as unknown as Row[];
    const key = PRIMARY_KEY[t];
    const sorted = [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1));
    return `${t}:${sorted.map(canonical).join('|')}`;
  });
  const text = parts.join('\n');
  // 依存を増やさないための FNV-1a 32bit。衝突しても「送らない」判断が1回ずれるだけで、
  // 次の同期で直る。データが壊れる経路には使っていない
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}-${text.length}`;
}

export function isSupportedSchema(v: unknown): v is number {
  return typeof v === 'number' && v <= SCHEMA_VERSION;
}
