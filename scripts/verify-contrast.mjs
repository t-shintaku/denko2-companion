/**
 * 明色・暗色の両方で、文字が読める濃さになっているかを実ブラウザで測る。
 *
 * なぜ要るか: 2026-08-13 の見た目刷新で `:root` を**暗色ブロックより後ろに**足したため、
 * 暗色時に --surface だけ暗いまま --text が明色の値で勝ち、本文が 1.08:1 で読めなくなった。
 * 型検査もテストも通る。**実際に色を測らないと出ない種類の壊れ方**なので手順で止める。
 *
 * 使い方: npm run build && npm run preview & && node scripts/verify-contrast.mjs [url]
 *
 * 判定は WCAG AA(通常 4.5:1 / 大きい文字 3:1)。
 * 背景がグラデーションの要素だけは自動では測れないので SKIP として一覧に出す(目視で確認する)。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
mkdirSync('test-results/contrast', { recursive: true });

const AUDIT = () => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = s => { const m = s.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [x, y] = l1 > l2 ? [l1, l2] : [l2, l1]; return (x + 0.05) / (y + 0.05); };
  // 実際に塗られている面まで親をたどる。半透明の面は下地と混ぜる
  const bgOf = el => {
    let n = el, grad = false;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') grad = true;
      const p = parse(cs.backgroundColor);
      if (p && (p.length < 4 || p[3] > 0.95)) return { bg: p.slice(0, 3), grad };
      n = n.parentElement;
    }
    return { bg: (parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255]).slice(0, 3), grad };
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const { bg, grad } = bgOf(el);
    const fg = fgRaw.length === 4 ? over(fgRaw.slice(0, 3), fgRaw[3], bg) : fgRaw;
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr >= need) continue;
    const sel = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    out.push({ text: own.slice(0, 26), sel, color: cs.color, bg: `rgb(${bg.map(Math.round).join(',')})`, cr: +cr.toFixed(2), need, grad });
  }
  const seen = new Set();
  return out.filter(o => { const k = o.sel + o.color + o.bg; return seen.has(k) ? false : (seen.add(k), true); });
};

const browser = await chromium.launch();
let failures = 0, skipped = 0, screens = 0;

for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();

  const check = async label => {
    screens++;
    const rows = await page.evaluate(AUDIT);
    await page.screenshot({ path: `test-results/contrast/${scheme}-${label}.png`, fullPage: true });
    const bad = rows.filter(r => !r.grad), unknown = rows.filter(r => r.grad);
    for (const r of bad.sort((a, b) => a.cr - b.cr)) console.log(`FAIL ${scheme}/${label}  ${r.cr}:1 (要 ${r.need}) ${r.sel} fg=${r.color} bg=${r.bg}「${r.text}」`);
    for (const r of unknown) console.log(`SKIP ${scheme}/${label}  グラデ面のため自動判定不可 ${r.sel}「${r.text}」`);
    failures += bad.length; skipped += unknown.length;
    if (!bad.length) console.log(`PASS ${scheme}/${label}`);
  };

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('button', { name: 'ホーム', exact: true }).waitFor();
  await check('01-home');

  // 復帰バナー(card--accent)は数日空けないと出ない。24日前の学習を1件入れて出す
  await page.evaluate(async () => {
    const d = new Date(Date.now() - 24 * 864e5).toISOString();
    const db = await new Promise(r => { const q = indexedDB.open('denko2-companion'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction('studySessions', 'readwrite');
    tx.objectStore('studySessions').put({ id: 'contrast-seed', jstDate: d.slice(0, 10), kind: 'lesson', lessonId: 'p0-l1', minutes: 12, startedAt: d, endedAt: d, updatedAt: d });
    await new Promise(r => tx.oncomplete = r); db.close();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.card--accent').first().waitFor();
  await check('02-comeback');

  await page.getByRole('button', { name: 'クエスト開始' }).first().click();
  await page.waitForTimeout(700);
  await check('03-lesson');

  await page.goto(base, { waitUntil: 'networkidle' });
  for (const tab of ['学科', '技能', '記録', '設定']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(700);
    await check(`04-${tab}`);
  }

  await page.getByRole('button', { name: '学科', exact: true }).click();
  await page.getByRole('button', { name: '公式トレーニング', exact: true }).click();
  await page.waitForTimeout(500);
  await check('05-official-catalog');
  await page.getByRole('button', { name: /5問ずつ練習/ }).first().click();
  await page.getByRole('heading', { name: /第1問/ }).waitFor();
  await page.waitForTimeout(700);
  await check('06-official-question');

  await context.close();
}
await browser.close();

console.log(`\n${screens} 画面 × 明暗 を判定。違反 ${failures} 件 / グラデ面のためSKIP ${skipped} 件`);
if (failures) { console.error('コントラスト不足がある。--text / --surface のような対のトークンを、暗色ブロックにも書いたか確認する。'); process.exit(1); }
