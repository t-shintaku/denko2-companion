/**
 * 教材の道案内(1. 見る)が実ブラウザでどう見えるかを撮る。
 * jsdom のテストでは、折り返し・はみ出し・並び順が見えない。
 *
 * 使い方: npm run build && npm run preview & && node scripts/shot-lesson.mjs [url]
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 800 },
  locale: 'ja-JP',
});
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

// 初回ウィザードを最短で通す
if (await page.getByRole('button', { name: /はじめる|保存して開始|開始/ }).count()) {
  await page.getByRole('button', { name: /はじめる|保存して開始|開始/ }).first().click();
  await page.waitForTimeout(800);
}

await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: true });

// 今日のクエストからレッスンを開く
await page.getByRole('button', { name: 'はじめる' }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/02-lesson.png`, fullPage: true });

// 教材の道案内だけを切り出す(「1. 見る」のカード)
const look = page.locator('section.card', { hasText: '1. 見る' }).first();
await look.screenshot({ path: `${OUT}/03-guide.png` });

// 横スクロールが出ていないか(道案内のグリッドを足したので確認する)
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
console.log('horizontal overflow px:', overflow);

await browser.close();
