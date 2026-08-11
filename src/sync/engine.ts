/**
 * 同期エンジン。pull → 合体 → push を1本の手続きにまとめる。
 *
 * 設計の芯:
 * - **ローカルを消す経路を作らない。** 書き戻しは applyMerged(clear しない)だけを使う。
 * - **壊れたリモートで既存データを触らない。** validateBackup を通らなければ、
 *   読み込みも書き戻しもせずに止める(JSON復元と同じ規律。AT-009)。
 * - **他端末が先に書いていたら読み直す。** GitHub の sha による楽観ロックで検出し、
 *   合体からやり直す。上書きしない。
 * - オフラインは失敗ではない。次にオンラインになったときへ持ち越す。
 */

import { repo as defaultRepo, type Repo } from '../db/repo';
import { APP_VERSION, validateBackup } from '../domain/backup';
import { nowJstIso } from '../domain/jst';
import { digest, emptyData, mergeAll, totalIncoming, totalOutgoing, type SettingsConflict } from '../domain/merge';
import { SCHEMA_VERSION } from '../domain/types';
import type { BackupFile, SyncConfig, SyncStatus } from '../domain/types';
import { SyncError, getFile as defaultGetFile, putFile as defaultPutFile, type GithubTarget } from './github';

/** リモートに置くファイル。復元用JSONと同じ形にして、検証と移行の実装を共有する */
export type SyncFile = BackupFile & {
  sync: {
    deviceName: string;
    at: string;
  };
};

export function buildSyncFile(
  data: BackupFile['data'],
  deviceName: string,
  now: Date = new Date(),
): SyncFile {
  return {
    kind: 'denko2-companion-backup',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowJstIso(now),
    appVersion: APP_VERSION,
    data,
    sync: { deviceName, at: nowJstIso(now) },
  };
}

export function targetOf(config: SyncConfig): GithubTarget {
  return {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    path: config.path,
    token: config.token,
  };
}

/** 端末名の初期値。あとから設定画面で変えられる */
export function guessDeviceName(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'タブレット';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'スマホ';
  return 'パソコン';
}

export type SyncOutcome = {
  pulled: number;
  pushed: number;
  conflicts: SettingsConflict[];
  /** リモートを実際に書いたか */
  wrote: boolean;
};

const FIELD_LABEL: Record<string, string> = {
  academicMode: '学科の受験方式',
  academicDate: '学科の受験日',
  skillDate: '技能の受験日',
  startDate: '学習の開始日',
  weekdayMinutes: '平日の学習時間',
  weekendMinutes: '休日の学習時間',
};

/**
 * 結果の一行。設定の食い違いは必ず出す。
 * ここを黙ると、別端末で入れた受験日が消えたことに本人が気づけない。
 */
export function describeOutcome(outcome: SyncOutcome): string {
  const base =
    outcome.pulled === 0 && outcome.pushed === 0
      ? '差分なし。どの端末も同じ内容。'
      : `取り込み ${outcome.pulled}件 / 送信 ${outcome.pushed}件`;
  if (outcome.conflicts.length === 0) return base;
  const fields = outcome.conflicts.map((c) => FIELD_LABEL[c.field as string] ?? String(c.field)).join('・');
  return `${base} — ${fields}が端末ごとに違っていた。新しい方を採用した。設定を確認する。`;
}

export type EngineDeps = {
  repo?: Repo;
  getFile?: typeof defaultGetFile;
  putFile?: typeof defaultPutFile;
  now?: () => Date;
};

const MAX_CONFLICT_RETRY = 3;

export class SyncEngine {
  private readonly repo: Repo;
  private readonly getFile: typeof defaultGetFile;
  private readonly putFile: typeof defaultPutFile;
  private readonly now: () => Date;

  private config?: SyncConfig;
  private status: SyncStatus = { phase: 'off' };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running?: Promise<SyncOutcome | undefined>;
  private timer?: ReturnType<typeof setTimeout>;
  /** 走っている最中に来た変更。終わったらもう一度回す */
  private dirtyWhileRunning = false;
  private lastRunAt?: number;
  /** 合体をローカルへ書き戻したあと、画面を作り直すための合図 */
  onPulled?: () => void | Promise<void>;

  constructor(deps: EngineDeps = {}) {
    this.repo = deps.repo ?? defaultRepo;
    this.getFile = deps.getFile ?? defaultGetFile;
    this.putFile = deps.putFile ?? defaultPutFile;
    this.now = deps.now ?? (() => new Date());
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getConfig(): SyncConfig | undefined {
    return this.config;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  /** 起動時。設定があれば読み込むが、同期はまだ走らせない */
  async load(): Promise<SyncConfig | undefined> {
    this.config = await this.repo.getSyncConfig();
    this.setStatus(
      this.config
        ? { phase: 'idle', lastSyncedAt: this.config.lastSyncedAt, message: undefined }
        : { phase: 'off', message: undefined },
    );
    return this.config;
  }

  async connect(config: SyncConfig): Promise<void> {
    await this.repo.saveSyncConfig(config);
    this.config = config;
    this.setStatus({ phase: 'idle', lastSyncedAt: config.lastSyncedAt });
  }

  async disconnect(): Promise<void> {
    await this.repo.clearSyncConfig();
    this.config = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.setStatus({ phase: 'off', message: undefined, lastSyncedAt: undefined, pulled: undefined, pushed: undefined });
  }

  /** 書き込みのたびに呼ばれる。まとめて1回にする */
  scheduleSoon(delayMs = 4000): void {
    if (!this.config) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.syncNow();
    }, delayMs);
  }

  /**
   * 同期を1回走らせる。多重起動しない。
   * force でないときは直前の実行から15秒あける。タブを行き来するたびに叩かないため。
   */
  async syncNow(force = false): Promise<SyncOutcome | undefined> {
    if (!this.config) return undefined;
    if (this.running) {
      this.dirtyWhileRunning = true;
      return this.running;
    }
    if (!force && this.lastRunAt && this.now().getTime() - this.lastRunAt < 15_000) {
      this.scheduleSoon(15_000);
      return undefined;
    }
    this.lastRunAt = this.now().getTime();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.running = this.run().finally(() => {
      this.running = undefined;
      if (this.dirtyWhileRunning) {
        this.dirtyWhileRunning = false;
        this.scheduleSoon(1500);
      }
    });
    return this.running;
  }

  private async run(): Promise<SyncOutcome | undefined> {
    const config = this.config;
    if (!config) return undefined;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setStatus({ phase: 'offline', message: 'オフライン。記録はこの端末に貯めて、つながったら送る。' });
      return undefined;
    }

    this.setStatus({ phase: 'syncing', message: undefined });

    try {
      let outcome: SyncOutcome | undefined;
      for (let attempt = 0; attempt < MAX_CONFLICT_RETRY; attempt += 1) {
        try {
          outcome = await this.attempt(config);
          break;
        } catch (e) {
          if (e instanceof SyncError && e.kind === 'conflict' && attempt < MAX_CONFLICT_RETRY - 1) {
            // 他端末が先に書いた。読み直して合体からやり直す
            continue;
          }
          throw e;
        }
      }
      if (!outcome) throw new SyncError('同期がまとまらなかった。もう一度試す。', 'conflict');

      const stamp = nowJstIso(this.now());
      await this.repo.patchSyncConfig({ lastSyncedAt: stamp });
      this.config = { ...config, ...(await this.repo.getSyncConfig()) };

      this.setStatus({
        phase: 'idle',
        lastSyncedAt: stamp,
        pulled: outcome.pulled,
        pushed: outcome.pushed,
        message: describeOutcome(outcome),
      });
      return outcome;
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError(String(e), 'server');
      this.setStatus({
        phase: err.kind === 'offline' ? 'offline' : 'error',
        message: err.message,
      });
      return undefined;
    }
  }

  private async attempt(config: SyncConfig): Promise<SyncOutcome> {
    const target = targetOf(config);
    const local = await this.repo.exportBackup(this.now());

    const remoteFile = await this.getFile(target);
    let remoteData = emptyData();
    if (remoteFile) {
      const parsed = validateBackup(remoteFile.text);
      if (!parsed.ok) {
        // リモートが壊れている。**ローカルには一切触らない**。
        // ここで「壊れているから上書きしてしまえ」とやると、他端末の記録を巻き添えで消す
        throw new SyncError(
          `クラウド側のデータが読めない(${parsed.issues[0]?.message ?? '形式不正'})。` +
            'この端末のデータはそのまま。リポジトリの履歴から戻すまで同期を止める。',
          'invalid',
        );
      }
      remoteData = parsed.backup.data;
    }

    const merged = mergeAll(local.data, remoteData);
    const pulled = totalIncoming(merged.counts);
    const pushed = totalOutgoing(merged.counts);

    if (merged.needsPull) {
      await this.repo.applyMerged(merged.data);
      await this.onPulled?.();
    }

    const nextDigest = digest(merged.data);
    const mustWrite = !remoteFile || merged.needsPush || nextDigest !== config.lastPushedDigest;

    let wrote = false;
    if (mustWrite) {
      const file = buildSyncFile(merged.data, config.deviceName, this.now());
      const text = JSON.stringify(file, null, 2);
      const message = `${config.deviceName} から同期 (取り込み${pulled} / 送信${pushed})`;
      const { sha } = await this.putFile(target, text, remoteFile?.sha, message);
      await this.repo.patchSyncConfig({ remoteSha: sha, lastPushedDigest: nextDigest });
      wrote = true;
    } else if (remoteFile && remoteFile.sha !== config.remoteSha) {
      await this.repo.patchSyncConfig({ remoteSha: remoteFile.sha, lastPushedDigest: nextDigest });
    }

    return { pulled, pushed, conflicts: merged.settingsConflicts, wrote };
  }
}

export const syncEngine = new SyncEngine();
