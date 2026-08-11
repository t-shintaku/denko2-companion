// SVG から PNG アイコンを起こす(Android のインストール条件を確実に満たすため)。
// sharp 等を足さず、既にある Playwright のレンダラを使う。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch();
for (const [src, out, size] of [
  ['public/icon.svg', 'public/icon-192.png', 192],
  ['public/icon.svg', 'public/icon-512.png', 512],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
]) {
  const svg = readFileSync(src, 'utf8');
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0">${svg.replace(/width="\d+"/, `width="${size}"`).replace(/height="\d+"/, `height="${size}"`)}</body>`,
  );
  writeFileSync(out, await page.screenshot({ omitBackground: false }));
  await page.close();
  console.log(`${out} ${size}x${size}`);
}
await browser.close();
