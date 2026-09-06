/**
 * 記号が「別の字」で描かれていないかを実ブラウザで確かめる。
 *
 * なぜ要るか: Windows の Yu Gothic UI は **Semibold / Bold の Ω(U+03A9) に
 * キリル文字の и の字形が入っている**。文字コードは正しいので、テストも型検査も
 * grep も素通りする。太字にしたときだけ「20Ω」が「20и」(N の左右反転)になる。
 * 2026-09-06、本人が画面を見て発見した。抵抗値は電工二種の問題文の中心なので落とせない。
 *
 * やり方: 同じ書体・同じ太さで「正しい字」と「化けたときに出る字」を描き、
 * **描画結果のビットマップが一致したら不合格**とする。字形そのものを見るので、
 * どのOS・どのフォントでも同じ検査になる。
 *
 * 使い方: npm run build && npm run preview & && node scripts/verify-glyphs.mjs [url]
 */
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
// [検査する字, 化けたときに出ると分かっている字, 説明]
const PAIRS = [['Ω', 'и', 'オーム記号がキリル文字のиになる(Yu Gothic UI の太字)']];
const WEIGHTS = [400, 500, 600, 700, 800];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'domcontentloaded' });

// アプリ本体と同じ font-family で描く(body から継承させる)
const results = await page.evaluate(({ pairs, weights }) => {
  const font = getComputedStyle(document.body).fontFamily;
  const draw = (ch, weight) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#000'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = `${weight} 44px ${font}`;
    g.fillText(ch, 32, 34);
    return c.toDataURL();
  };
  const out = [];
  for (const [good, bad, why] of pairs) {
    for (const w of weights) out.push({ good, bad, why, weight: w, same: draw(good, w) === draw(bad, w) });
  }
  return out;
}, { pairs: PAIRS, weights: WEIGHTS });

await browser.close();

let failed = 0;
for (const r of results) {
  if (r.same) { failed++; console.log(`FAIL weight ${r.weight}: 「${r.good}」が「${r.bad}」と同じ字形で描かれている — ${r.why}`); }
  else console.log(`PASS weight ${r.weight}: 「${r.good}」は「${r.bad}」と別の字形`);
}
console.log(`\n${results.length} 件を判定。不一致であるべきところが一致 = ${failed} 件`);
if (failed) { console.error('字形が化けている。global.css の @font-face(Greek Fallback)が効いているか確認する。'); process.exit(1); }
