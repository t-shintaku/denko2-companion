/**
 * GitHub Contents API の薄いラッパ。同期先を「非公開リポジトリの1ファイル」にする。
 *
 * この方式を選んだ理由:
 * - 新しいアカウントもサーバーも要らない。GitHub Pages で配っている本体と同じ場所で完結する
 * - 同期のたびにコミットが積まれる = 履歴つきバックアップが自動で手に入る
 * - sha を使った楽観ロックがAPIに元から入っているので、
 *   「別端末が先に書いていたのに気づかず上書き」を検出できる(409)
 *
 * トークンは fine-grained PAT を想定。権限は対象リポジトリの Contents: Read and write だけでよい。
 */

const API = 'https://api.github.com';

export type GithubTarget = {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
};

export type RemoteFile = {
  /** ファイル本文(UTF-8) */
  text: string;
  sha: string;
};

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'offline'
      | 'unauthorized'
      | 'forbidden'
      | 'not-found'
      | 'conflict'
      | 'too-large'
      | 'server'
      | 'invalid',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** UTF-8 → base64。日本語を含むので btoa へ直接渡さない */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // 一度に展開しすぎるとスタックが溢れる
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → UTF-8。GitHub は 60文字ごとに改行を入れて返すので先に落とす */
export function fromBase64(b64: string): string {
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    // fetch が投げるのは基本オフラインかCORS。ここでは通信不能として扱う
    throw new SyncError('ネットワークにつながらない。オンラインになったら自動で再開する。', 'offline');
  }
  return res;
}

function describe(status: number, body: string): SyncError {
  if (status === 401) {
    return new SyncError(
      'トークンが無効か期限切れ。設定でトークンを入れ直す。',
      'unauthorized',
      status,
    );
  }
  if (status === 403) {
    return new SyncError(
      'トークンの権限が足りないか、API制限にかかっている。トークンの Contents 権限が Read and write か確認する。',
      'forbidden',
      status,
    );
  }
  if (status === 404) {
    return new SyncError(
      'リポジトリが見つからない。所有者名・リポジトリ名と、トークンがそのリポジトリを対象にしているかを確認する。',
      'not-found',
      status,
    );
  }
  if (status === 409 || status === 422) {
    return new SyncError('別の端末が先に書き込んでいた。読み直して合体する。', 'conflict', status);
  }
  return new SyncError(`GitHub がエラーを返した(${status})。${body.slice(0, 200)}`, 'server', status);
}

/**
 * ファイルを読む。まだ無ければ undefined。
 * 1MB を超えるとContents APIは本文を返さないので、その時だけ Blob API を追う。
 */
export async function getFile(t: GithubTarget): Promise<RemoteFile | undefined> {
  const url = `${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/contents/${t.path}?ref=${encodeURIComponent(t.branch)}`;
  const res = await request(url, { headers: headers(t.token), cache: 'no-store' });

  if (res.status === 404) return undefined;
  if (!res.ok) throw describe(res.status, await res.text());

  const json = (await res.json()) as { content?: string; sha: string; size: number; encoding?: string };
  if (json.content && json.encoding === 'base64') {
    return { text: fromBase64(json.content), sha: json.sha };
  }

  // 1MB超。Blob API は 100MB まで本文を返す
  const blobUrl = `${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/git/blobs/${json.sha}`;
  const blobRes = await request(blobUrl, { headers: headers(t.token), cache: 'no-store' });
  if (!blobRes.ok) throw describe(blobRes.status, await blobRes.text());
  const blob = (await blobRes.json()) as { content: string; encoding: string };
  if (blob.encoding !== 'base64') {
    throw new SyncError('GitHub から想定外の形式が返った。', 'invalid');
  }
  return { text: fromBase64(blob.content), sha: json.sha };
}

/**
 * ファイルを書く。sha を渡すと、その版から変わっていない場合だけ通る(楽観ロック)。
 * 他端末が先に書いていれば 409 になり、呼び出し側が読み直して合体する。
 */
export async function putFile(
  t: GithubTarget,
  text: string,
  sha: string | undefined,
  message: string,
): Promise<{ sha: string }> {
  const url = `${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}/contents/${t.path}`;
  const res = await request(url, {
    method: 'PUT',
    headers: { ...headers(t.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(text),
      branch: t.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) throw describe(res.status, await res.text());
  const json = (await res.json()) as { content: { sha: string } };
  return { sha: json.content.sha };
}

/**
 * トークンの持ち主を返す。所有者名を手で打たせないため。
 * スマホで長い文字列を2つも入力させると、それだけで使われなくなる。
 */
export async function getViewer(token: string): Promise<string> {
  const res = await request(`${API}/user`, { headers: headers(token), cache: 'no-store' });
  if (!res.ok) throw describe(res.status, await res.text());
  const json = (await res.json()) as { login: string };
  return json.login;
}

/** 接続確認。書き込み前に、その場で分かる失敗を全部出しておく */
export async function checkAccess(t: GithubTarget): Promise<{ ok: true } | { ok: false; error: SyncError }> {
  const url = `${API}/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`;
  try {
    const res = await request(url, { headers: headers(t.token), cache: 'no-store' });
    if (!res.ok) return { ok: false, error: describe(res.status, await res.text()) };
    const json = (await res.json()) as { private: boolean; permissions?: { push?: boolean } };
    if (!json.private) {
      return {
        ok: false,
        error: new SyncError(
          'そのリポジトリは公開設定になっている。学習記録が誰でも読める場所へ出るので、非公開のものを指定する。',
          'invalid',
        ),
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof SyncError ? e : new SyncError(String(e), 'server') };
  }
}
