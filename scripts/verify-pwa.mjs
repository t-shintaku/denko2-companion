/**
 * 実ブラウザでの受入確認。jsdom では出せない3点を見る。
 *   1. 360×800 で横スクロールが出ないか(AT-011)
 *   2. PWA としてインストールできる条件を満たすか(manifest + Service Worker)
 *   3. 一度オンラインで開いたあと、オフラインで起動できるか(§13 オフライン)
 *
 * localhost は secure context なので、HTTPS 配信前でも Service Worker は動く。
 * 使い方: npm run build && node scripts/verify-pwa.mjs [url]
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 800 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// --- 1回目: オンラインで開く ------------------------------------------------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'はじめる' }).waitFor({ timeout: 15000 });

check('初期表示(設定ウィザード)が出る', true);

async function horizontalOverflow() {
  return page.evaluate(() => {
    const d = document.documentElement;
    const widest = [...document.querySelectorAll('*')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > d.clientWidth + 1)
      .map(({ el, r }) => `${el.tagName}.${el.className || '-'} right=${Math.round(r.right)}`);
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, widest: widest.slice(0, 5) };
  });
}

let ov = await horizontalOverflow();
check(
  '360px幅で横スクロールしない(設定ウィザード)',
  ov.scrollWidth <= ov.clientWidth + 1,
  `scrollWidth=${ov.scrollWidth} clientWidth=${ov.clientWidth} ${ov.widest.join(' / ')}`,
);

// セットアップを終えて本体へ
await page.getByRole('button', { name: 'はじめる' }).click();
await page.getByRole('button', { name: 'ホーム', exact: true }).waitFor({ timeout: 15000 });

for (const tab of ['ホーム', '学科', '技能', '記録', '設定']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(250);
  ov = await horizontalOverflow();
  check(
    `360px幅で横スクロールしない(${tab})`,
    ov.scrollWidth <= ov.clientWidth + 1,
    `scrollWidth=${ov.scrollWidth} ${ov.widest.join(' / ')}`,
  );
}

// タブバーが親指の届く位置(画面下部)にあるか
await page.getByRole('button', { name: 'ホーム', exact: true }).click();
const tabBox = await page.locator('nav.tabbar').boundingBox();
check(
  'タブバーが画面下部にある(親指で届く)',
  tabBox !== null && tabBox.y + tabBox.height >= 800 - 2,
  tabBox ? `y=${Math.round(tabBox.y)} h=${Math.round(tabBox.height)}` : 'not found',
);

// --- PWA インストール条件 ---------------------------------------------------
const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
check('manifest がリンクされている', Boolean(manifestHref), manifestHref ?? '');

const manifest = await page.evaluate(async (href) => {
  const res = await fetch(href);
  return res.ok ? res.json() : null;
}, manifestHref);

check('manifest が取得できる', manifest !== null);
if (manifest) {
  check('manifest: name', Boolean(manifest.name), manifest.name);
  check('manifest: start_url', Boolean(manifest.start_url), manifest.start_url);
  check(
    'manifest: display が standalone',
    manifest.display === 'standalone',
    String(manifest.display),
  );
  check('manifest: icons がある', Array.isArray(manifest.icons) && manifest.icons.length > 0);
  check(
    'manifest: maskable アイコンがある',
    (manifest.icons ?? []).some((i) => String(i.purpose ?? '').includes('maskable')),
  );
  // アイコンが実際に配信されているか
  for (const icon of manifest.icons ?? []) {
    const status = await page.evaluate(async (src) => (await fetch(src)).status, icon.src);
    check(`アイコンが配信されている (${icon.src})`, status === 200, `HTTP ${status}`);
  }
}

const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { registered: false };
  await navigator.serviceWorker.ready;
  return { registered: true, scope: reg.scope, active: Boolean(reg.active) };
});
check('Service Worker が登録・有効化された', swState.registered && swState.active, swState.scope ?? '');

// プリキャッシュが埋まるまで待つ
await page.waitForFunction(
  async () => {
    const names = await caches.keys();
    for (const n of names) {
      const keys = await (await caches.open(n)).keys();
      if (keys.length > 0) return true;
    }
    return false;
  },
  null,
  { timeout: 20000 },
);
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  let total = 0;
  for (const n of names) total += (await (await caches.open(n)).keys()).length;
  return { names, total };
});
check('アプリシェルがキャッシュされた', cached.total > 0, `${cached.total}件 ${cached.names.join(',')}`);

// --- 2回目: オフラインで起動 ------------------------------------------------
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });

let offlineOk = true;
let offlineDetail = '';
try {
  await page.getByRole('button', { name: 'ホーム', exact: true }).waitFor({ timeout: 15000 });
} catch (e) {
  offlineOk = false;
  offlineDetail = String(e).slice(0, 200);
}
check('オフラインで起動できる', offlineOk, offlineDetail);

// オフラインでも保存済みデータが読めるか(IndexedDB はネットワーク非依存)
const offlineSettings = await page.evaluate(async () => {
  const req = indexedDB.open('denko2-companion');
  const db = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const tx = db.transaction('settings', 'readonly');
  const all = await new Promise((res) => {
    const r = tx.objectStore('settings').getAll();
    r.onsuccess = () => res(r.result);
  });
  return all.length;
});
check('オフラインでも保存済みの設定が読める', offlineSettings === 1, `settings=${offlineSettings}件`);

// オフラインで記録を追加できるか
await page.getByRole('button', { name: '設定', exact: true }).click();
await page.waitForTimeout(300);
const offlineInteractive = await page.getByRole('heading', { name: '設定' }).isVisible();
check('オフラインでも画面遷移できる', offlineInteractive);

await context.setOffline(false);

check(
  'コンソールエラーが出ていない',
  consoleErrors.filter((e) => !/favicon|Failed to load resource/i.test(e)).length === 0,
  consoleErrors.slice(0, 3).join(' | '),
);

await browser.close();

console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
