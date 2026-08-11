/**
 * 実際の GitHub API に当てる確認。偽物では検証できない部分だけを見る。
 *   - URL・ヘッダ・base64 の形が本物に通るか
 *   - sha による楽観ロックが本当に 409 を返すか(競合検出の土台)
 *
 * 既定では走らない。トークンを渡したときだけ動く:
 *   DENKO2_LIVE_TOKEN=$(gh auth token) DENKO2_LIVE_REPO=owner/repo npx vitest run tests/github-live.test.ts
 *
 * 書き込むのは data/_selfcheck.json だけ。学習データ本体には触らない。
 */

import { describe, expect, it } from 'vitest';
import { SyncError, checkAccess, getFile, getViewer, putFile } from '../src/sync/github';
import type { GithubTarget } from '../src/sync/github';

const token = process.env.DENKO2_LIVE_TOKEN;
const slug = process.env.DENKO2_LIVE_REPO;

describe.skipIf(!token || !slug)('GitHub 実接続', () => {
  const [owner, repo] = (slug ?? '/').split('/');
  const target: GithubTarget = {
    owner: owner!,
    repo: repo!,
    branch: 'main',
    path: 'data/_selfcheck.json',
    token: token!,
  };

  it('トークンから所有者を引ける(所有者名を手入力させないため)', async () => {
    expect(await getViewer(target.token)).toBe(owner);
  });

  it('非公開リポジトリとして接続できる', async () => {
    const access = await checkAccess(target);
    expect(access.ok).toBe(true);
  });

  it('日本語を含むJSONを書いて、そのまま読み戻せる', async () => {
    const body = JSON.stringify({ 端末: 'スマホ', memo: '複線図①②③ 接地' });
    const existing = await getFile(target);
    const { sha } = await putFile(target, body, existing?.sha, '同期の自己確認');
    expect(sha).toBeTruthy();

    // 実測: 新規作成の直後は GET が数百ms〜数秒 404 を返すことがある(反映待ち)。
    // 同期側はこれを「リモートは空」と読むが、続く PUT が sha 無し = 422 になり、
    // 422 を競合として扱って読み直すので上書き事故にはならない(github.ts の describe)。
    let read = await getFile(target);
    for (let i = 0; i < 10 && read?.text !== body; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      read = await getFile(target);
    }
    expect(read?.text).toBe(body);
  });

  it('古い sha で書くと 409 になる(他端末の先行書き込みを検出できる)', async () => {
    const first = await getFile(target);
    expect(first).toBeDefined();
    await putFile(target, JSON.stringify({ n: 1 }), first!.sha, '自己確認 1');

    // わざと1つ前の sha で書く = 他端末が先に書いた状況
    await expect(putFile(target, JSON.stringify({ n: 2 }), first!.sha, '自己確認 2')).rejects.toMatchObject({
      kind: 'conflict',
    });
  });

  it('存在しないパスは undefined を返す(初回同期の入口)', async () => {
    const missing = await getFile({ ...target, path: 'data/_does-not-exist.json' });
    expect(missing).toBeUndefined();
  });

  it('無効なトークンは、入れ直しを促すエラーになる', async () => {
    await expect(getViewer('github_pat_invalid_token_value')).rejects.toBeInstanceOf(SyncError);
  });
});
