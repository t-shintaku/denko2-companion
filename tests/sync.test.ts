/**
 * 同期エンジンの受入。GitHub は差し替えて、実際の通信なしで筋を固定する。
 *
 * ここで守るのは「データが減らないこと」。増えるのは直せるが、
 * 減ったものは本人の学習時間そのものなので取り返しがつかない。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Denko2Db } from '../src/db/db';
import { Repo, defaultSettings } from '../src/db/repo';
import { SyncEngine, buildSyncFile, guessDeviceName } from '../src/sync/engine';
import { SyncError, fromBase64, toBase64 } from '../src/sync/github';
import type { GithubTarget, RemoteFile } from '../src/sync/github';
import type { SyncConfig } from '../src/domain/types';

let db: Denko2Db;
let repo: Repo;

const CONFIG: SyncConfig = {
  id: 'main',
  provider: 'github',
  owner: 'tester',
  repo: 'denko2-data',
  branch: 'main',
  path: 'data/denko2.json',
  token: 'github_pat_secret',
  deviceName: 'スマホ',
};

/** リモートのファイル1個ぶんを持つだけの偽GitHub */
function fakeRemote(initial?: string) {
  const state: { text?: string; sha: string; writes: string[] } = {
    text: initial,
    sha: 'sha-0',
    writes: [],
  };
  let counter = 0;
  return {
    state,
    getFile: vi.fn(async (): Promise<RemoteFile | undefined> =>
      state.text === undefined ? undefined : { text: state.text, sha: state.sha },
    ),
    putFile: vi.fn(async (_t: GithubTarget, text: string, sha: string | undefined, _message: string) => {
      if (state.text !== undefined && sha !== state.sha) {
        throw new SyncError('別の端末が先に書き込んでいた。', 'conflict', 409);
      }
      counter += 1;
      state.text = text;
      state.sha = `sha-${counter}`;
      state.writes.push(text);
      return { sha: state.sha };
    }),
  };
}

function engineWith(remote: ReturnType<typeof fakeRemote>) {
  return new SyncEngine({ repo, getFile: remote.getFile, putFile: remote.putFile });
}

beforeEach(async () => {
  db = new Denko2Db(`sync-${Math.random()}`);
  repo = new Repo(db);
  await db.open();
});

describe('初回同期', () => {
  it('リモートが空なら、この端末の記録をそのまま押し上げる', async () => {
    await repo.saveSettings(defaultSettings('2026-h2'));
    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });

    const remote = fakeRemote();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    const outcome = await engine.syncNow(true);

    expect(outcome?.pulled).toBe(0);
    expect(outcome?.pushed).toBeGreaterThan(0);
    const pushed = JSON.parse(remote.state.text!);
    expect(pushed.data.studySessions).toHaveLength(1);
    expect(pushed.schemaVersion).toBe(3);
  });

  it('【中核】先に使っていた端末の記録を、空のリモートで消さない', async () => {
    await repo.addSession({ durationMinutes: 40, kind: 'questions', countsAsBasics: true });

    const engine = engineWith(fakeRemote());
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect((await repo.load()).studySessions).toHaveLength(1);
  });

  it('トークンはリモートへ書き出さない', async () => {
    await repo.saveSettings(defaultSettings('2026-h2'));

    const remote = fakeRemote();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect(remote.state.text).not.toContain('github_pat_secret');
    expect(JSON.stringify(await repo.exportBackup())).not.toContain('github_pat_secret');
  });
});

describe('他端末との合流', () => {
  it('リモートにしかない記録を取り込む', async () => {
    const fromPc = buildSyncFile(
      {
        settings: [],
        lessonProgress: [],
        adminTaskStates: [],
        studySessions: [
          {
            id: 'pc-1',
            startedAt: '2026-08-01T10:00:00+09:00',
            jstDate: '2026-08-01',
            durationMinutes: 30,
            kind: 'theory',
            countsAsBasics: true,
            updatedAt: '2026-08-01T10:00:00+09:00',
          },
        ],
        questionAttempts: [],
        mockExams: [],
        unknownTerms: [],
        skillAttempts: [],
        budgetItems: [],
      },
      'パソコン',
    );

    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });

    const remote = fakeRemote(JSON.stringify(fromPc));
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    const outcome = await engine.syncNow(true);

    const after = await repo.load();
    expect(after.studySessions).toHaveLength(2); // 自分の1件 + PCの1件
    expect(outcome?.pulled).toBe(1);
    expect(JSON.parse(remote.state.text!).data.studySessions).toHaveLength(2);
  });

  it('【中核】この端末で全削除しても、クラウドと他端末の記録は消えない', async () => {
    const fromPc = buildSyncFile(
      {
        settings: [],
        lessonProgress: [],
        adminTaskStates: [],
        studySessions: [
          {
            id: 'pc-1',
            startedAt: '2026-08-01T10:00:00+09:00',
            jstDate: '2026-08-01',
            durationMinutes: 30,
            kind: 'theory',
            countsAsBasics: true,
            updatedAt: '2026-08-01T10:00:00+09:00',
          },
        ],
        questionAttempts: [],
        mockExams: [],
        unknownTerms: [],
        skillAttempts: [],
        budgetItems: [],
      },
      'パソコン',
    );
    const remote = fakeRemote(JSON.stringify(fromPc));

    // wipe は同期設定も落とすので、この端末はもう送らない。
    // 万一つないだままでも、合体は削除を伝播しない
    await repo.wipe();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect(JSON.parse(remote.state.text!).data.studySessions).toHaveLength(1);
  });

  it('中身が同じなら書き込まない(空コミットを積まない)', async () => {
    await repo.saveSettings(defaultSettings('2026-h2'));

    const remote = fakeRemote();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);
    expect(remote.putFile).toHaveBeenCalledTimes(1);

    await engine.syncNow(true);
    expect(remote.putFile).toHaveBeenCalledTimes(1); // 増えない
  });
});

describe('競合と失敗', () => {
  it('他端末が先に書いていたら(409)、読み直して合体しやり直す', async () => {
    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });

    const remote = fakeRemote();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);

    // 1回目の PUT だけ、割り込みが入ったことにする
    let first = true;
    const original = remote.putFile.getMockImplementation()!;
    remote.putFile.mockImplementation(async (t, text, sha, message) => {
      if (first) {
        first = false;
        remote.state.text = JSON.stringify(
          buildSyncFile(
            {
              settings: [],
              lessonProgress: [],
              adminTaskStates: [],
              studySessions: [
                {
                  id: 'pc-1',
                  startedAt: '2026-08-01T10:00:00+09:00',
                  jstDate: '2026-08-01',
                  durationMinutes: 30,
                  kind: 'theory',
                  countsAsBasics: true,
                  updatedAt: '2026-08-01T10:00:00+09:00',
                },
              ],
              questionAttempts: [],
              mockExams: [],
              unknownTerms: [],
              skillAttempts: [],
              budgetItems: [],
            },
            'パソコン',
          ),
        );
        remote.state.sha = 'sha-other';
        throw new SyncError('別の端末が先に書き込んでいた。', 'conflict', 409);
      }
      return original(t, text, sha, message);
    });

    await engine.syncNow(true);

    // 割り込んだ側の記録も、こちらの記録も残る
    const finalRemote = JSON.parse(remote.state.text!);
    expect(finalRemote.data.studySessions).toHaveLength(2);
    expect((await repo.load()).studySessions).toHaveLength(2);
    expect(engine.getStatus().phase).toBe('idle');
  });

  it('【中核】リモートの反映が遅れて空に見えても、他端末の記録を上書きしない', async () => {
    // 実接続で確認した挙動: 作ったばかりのファイルは GET が数秒 404 を返すことがある。
    // その隙に「リモートは空」と判断して sha 無しで書くと、
    // 既にある他端末の記録を丸ごと踏み潰す。GitHub は sha 無しの上書きを 422 で拒む。
    // 422 を競合として扱い、読み直してから合体することでしか守れない。
    const existing = buildSyncFile(
      {
        settings: [],
        lessonProgress: [],
        adminTaskStates: [],
        studySessions: [
          {
            id: 'pc-1',
            startedAt: '2026-08-01T10:00:00+09:00',
            jstDate: '2026-08-01',
            durationMinutes: 30,
            kind: 'theory',
            countsAsBasics: true,
            updatedAt: '2026-08-01T10:00:00+09:00',
          },
        ],
        questionAttempts: [],
        mockExams: [],
        unknownTerms: [],
        skillAttempts: [],
        budgetItems: [],
      },
      'パソコン',
    );
    const remote = fakeRemote(JSON.stringify(existing));
    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });

    // 1回目の GET だけ、反映待ちで見えないことにする
    let firstRead = true;
    const realGet = remote.getFile.getMockImplementation()!;
    remote.getFile.mockImplementation(async (...args) => {
      if (firstRead) {
        firstRead = false;
        return undefined;
      }
      return realGet(...args);
    });
    // sha 無しの上書きは GitHub が 422 で拒む
    const realPut = remote.putFile.getMockImplementation()!;
    remote.putFile.mockImplementation(async (t, text, sha, message) => {
      if (sha === undefined && remote.state.text !== undefined) {
        throw new SyncError('すでにファイルがある。', 'conflict', 422);
      }
      return realPut(t, text, sha, message);
    });

    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    const final = JSON.parse(remote.state.text!);
    expect(final.data.studySessions).toHaveLength(2); // PCの1件が生き残り、こちらの1件も乗った
    expect(engine.getStatus().phase).toBe('idle');
  });

  it('【中核】リモートが壊れていたら、ローカルに一切触らず止まる', async () => {
    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });
    const before = await repo.load();

    const remote = fakeRemote('{ これはJSONではない');
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect(engine.getStatus().phase).toBe('error');
    expect(remote.putFile).not.toHaveBeenCalled(); // 壊れたものを上書きもしない
    expect(await repo.load()).toEqual(before);
  });

  it('別アプリのバックアップを指しても、取り込まずに止まる', async () => {
    const remote = fakeRemote(JSON.stringify({ kind: 'other-app', schemaVersion: 1, data: {} }));
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect(engine.getStatus().phase).toBe('error');
    expect(remote.putFile).not.toHaveBeenCalled();
  });

  it('オフラインは失敗ではなく保留。ローカルは動き続ける', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      const remote = fakeRemote();
      const engine = engineWith(remote);
      await engine.connect(CONFIG);
      await engine.syncNow(true);

      expect(engine.getStatus().phase).toBe('offline');
      expect(remote.getFile).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('トークンが無効なら、何をすればよいか分かる文言を出す', async () => {
    const remote = fakeRemote();
    remote.getFile.mockRejectedValue(
      new SyncError('トークンが無効か期限切れ。設定でトークンを入れ直す。', 'unauthorized', 401),
    );
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);

    expect(engine.getStatus().phase).toBe('error');
    expect(engine.getStatus().message).toContain('トークン');
  });
});

describe('解除', () => {
  it('解除するとこの端末は送らなくなる。クラウドのデータは残る', async () => {
    await repo.addSession({ durationMinutes: 25, kind: 'theory', countsAsBasics: true });
    const remote = fakeRemote();
    const engine = engineWith(remote);
    await engine.connect(CONFIG);
    await engine.syncNow(true);
    const writesBefore = remote.state.writes.length;

    await engine.disconnect();
    await engine.syncNow(true);

    expect(engine.getStatus().phase).toBe('off');
    expect(remote.state.writes).toHaveLength(writesBefore);
    expect(JSON.parse(remote.state.text!).data.studySessions).toHaveLength(1);
  });
});

describe('補助', () => {
  it('日本語を含む本文が base64 を往復しても壊れない', () => {
    const text = JSON.stringify({ 接地: 'D種接地工事', memo: '複線図①②③' });
    expect(fromBase64(toBase64(text))).toBe(text);
  });

  it('GitHub が返す改行入り base64 も読める', () => {
    const raw = toBase64('あいうえお');
    const withNewlines = raw.replace(/(.{4})/g, '$1\n');
    expect(fromBase64(withNewlines)).toBe('あいうえお');
  });

  it('端末名の初期値を UA から推測する', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('スマホ');
    expect(guessDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('タブレット');
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('パソコン');
  });
});
