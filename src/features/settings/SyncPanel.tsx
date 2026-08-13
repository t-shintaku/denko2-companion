/**
 * 端末間同期の設定。
 *
 * 手数を削ることを最優先にしている。スマホで長い文字列を2つ打たせた時点で使われなくなる。
 * 本人が入力するのは**トークン1つだけ**。所有者名はトークンから引く。
 */

import { useState } from 'react';
import { repo } from '../../db/repo';
import { formatJstDateTime } from '../../domain/jst';
import { guessDeviceName, syncEngine } from '../../sync/engine';
import { SyncError, checkAccess, getViewer } from '../../sync/github';
import { useVault } from '../../state/VaultContext';
import type { SyncConfig } from '../../domain/types';

const DEFAULT_REPO = 'denko2-data';
const DEFAULT_BRANCH = 'main';
const DEFAULT_PATH = 'data/denko2.json';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function SyncPanel() {
  const { syncStatus, syncNow, reload } = useVault();
  const existing = syncEngine.getConfig();

  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState(existing?.repo ?? DEFAULT_REPO);
  const [deviceName, setDeviceName] = useState(existing?.deviceName ?? guessDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const connected = syncStatus.phase !== 'off';

  const connect = async () => {
    setError('');
    setNote('');
    setBusy(true);
    try {
      const trimmed = token.trim();
      if (!trimmed) {
        setError('GitHubのトークンを貼り付けよう。');
        return;
      }
      const owner = await getViewer(trimmed);
      const config: SyncConfig = {
        id: 'main',
        provider: 'github',
        owner,
        repo: repoName.trim() || DEFAULT_REPO,
        branch: DEFAULT_BRANCH,
        path: DEFAULT_PATH,
        token: trimmed,
        deviceName: deviceName.trim() || guessDeviceName(),
      };

      const access = await checkAccess({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch,
        path: config.path,
        token: config.token,
      });
      if (!access.ok) {
        setError(access.error.message);
        return;
      }

      await syncEngine.connect(config);
      setToken('');
      const outcome = await syncEngine.syncNow(true);
      await reload();
      setNote(
        outcome
          ? `${owner}/${config.repo} と同期完了！ 受信 ${outcome.pulled}件 / 送信 ${outcome.pushed}件。`
          : `${owner}/${config.repo} とつながった！`,
      );
    } catch (e) {
      setError(e instanceof SyncError ? e.message : `つながらなかった。もう一度試そう: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await syncEngine.disconnect();
      setNote('この端末の同期を解除したよ。クラウドと他の端末のデータはそのまま！');
    } finally {
      setBusy(false);
    }
  };

  const renameDevice = async (name: string) => {
    setDeviceName(name);
    if (connected) await repo.patchSyncConfig({ deviceName: name });
  };

  const phaseLabel: Record<string, string> = {
    off: '未接続',
    idle: '同期済み',
    syncing: '同期中…',
    error: 'エラー',
    offline: 'オフライン',
  };

  return (
    <>
      <h2>データ同期</h2>
      <div className="card">
        <p className="muted">
          スマホ・パソコン・タブレットの記録を1つにまとめよう。
          一度つないでおけば、
          正答率も学習時間もミッションの進み具合も、どの端末でも同じになる。
        </p>

        <p>
          <strong>状態: {phaseLabel[syncStatus.phase] ?? syncStatus.phase}</strong>
          {syncStatus.lastSyncedAt && (
            <>
              <br />
              最終同期: {formatJstDateTime(syncStatus.lastSyncedAt)}
            </>
          )}
          {syncStatus.message && (
            <>
              <br />
              <span className="muted">{syncStatus.message}</span>
            </>
          )}
        </p>

        {connected ? (
          <>
            <div className="field">
              <label htmlFor="sync-device">この端末の名前</label>
              <input
                id="sync-device"
                value={deviceName}
                onChange={(e) => void renameDevice(e.target.value)}
              />
              <p className="muted">同期履歴に「どの端末が書いたか」として残る。</p>
            </div>
            <div className="row">
              <button type="button" onClick={() => void syncNow()} disabled={busy}>
                いま同期する
              </button>
              <button type="button" className="ghost" onClick={() => void disconnect()} disabled={busy}>
                同期を解除
              </button>
            </div>
            <p className="notice">
              同期中は、この端末の「すべて削除」を押してもクラウドのデータは消えない。
              削除すると同期設定も外れ、この端末だけが白紙になる。
            </p>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="sync-token">GitHub のトークン</label>
              <input
                id="sync-token"
                type="password"
                autoComplete="off"
                placeholder="github_pat_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="muted">
                貼り付けるのはこれだけ。アカウント名はトークンから読み取る。
              </p>
            </div>
            <div className="field">
              <label htmlFor="sync-repo">保存先リポジトリ名</label>
              <input id="sync-repo" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
              <p className="muted">非公開リポジトリであること。公開だと接続を拒否する。</p>
            </div>
            <div className="field">
              <label htmlFor="sync-device-new">この端末の名前</label>
              <input
                id="sync-device-new"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>
            <div className="row">
              <button type="button" onClick={() => void connect()} disabled={busy}>
                {busy ? '接続中…' : '同期をスタート'}
              </button>
              <button type="button" className="ghost" onClick={() => setShowHelp((v) => !v)}>
                トークンの作り方
              </button>
            </div>
          </>
        )}

        {error && <p className="notice error">{error}</p>}
        {note && <p className="notice">{note}</p>}

        {showHelp && !connected && (
          <div className="notice">
            <strong>トークンの作り方(1端末で1回作れば、3端末とも同じものを使い回せる)</strong>
            <ol>
              <li>
                <a href={TOKEN_URL} target="_blank" rel="noreferrer">
                  GitHub のトークン作成ページ
                </a>
                を開く
              </li>
              <li>Repository access で <strong>Only select repositories</strong> → <code>{DEFAULT_REPO}</code> を選ぶ</li>
              <li>Permissions → Repository permissions → <strong>Contents</strong> を <strong>Read and write</strong> にする</li>
              <li>Generate token を押し、表示された <code>github_pat_</code> で始まる文字列をここへ貼る</li>
            </ol>
            他の端末では、同じ文字列を貼るだけでOK。パスワード管理アプリに入れておくと楽！
            <br />
            トークンはこの端末のブラウザ内にだけ置く。バックアップJSONには書き出さない。
          </div>
        )}
      </div>
    </>
  );
}
