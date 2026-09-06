import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const papers = JSON.parse(readFileSync(new URL('../src/data/official-exams.json', import.meta.url), 'utf8'));
const base = process.argv[2] ?? 'http://127.0.0.1:4173';
mkdirSync('test-results/study-loop', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 360, height: 800 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); console.log(`PASS ${name}`); checks++; };
const readTable = name => page.evaluate(async name => {
  const db = await new Promise((resolve,reject) => { const r=indexedDB.open('denko2-companion'); r.onsuccess=()=>resolve(r.result); r.onerror=reject; });
  return new Promise((resolve,reject) => { const r=db.transaction(name).objectStore(name).getAll(); r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=reject; });
}, name);
const noOverflow = async name => check(name, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
const shot = name => page.screenshot({ path: `test-results/study-loop/${name}.png`, fullPage: true });
const openOfficial = async () => {
  await page.getByRole('button', { name: '学科', exact: true }).click();
  await page.getByRole('button', { name: '公式トレーニング', exact: true }).click();
};
try {
  await page.goto(base); await page.getByRole('button',{ name:'はじめる' }).click();
  await page.getByRole('button',{name:'ホーム',exact:true}).waitFor();
  await noOverflow('360px home'); await shot('home');
  await page.evaluate(async () => {
    const db=await new Promise(resolve=>{const r=indexedDB.open('denko2-companion');r.onsuccess=()=>resolve(r.result);});
    const tx=db.transaction('lessonProgress','readwrite'); tx.objectStore('lessonProgress').put({lessonId:'p0-l2',inputViewedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),xpAwarded:0});
    await new Promise(resolve=>tx.oncomplete=resolve);db.close();
  });
  await page.reload(); await page.getByRole('button',{name:'今日の5問を始める',exact:true}).click();
  await noOverflow('360px daily recall'); await shot('recall');
  check('confidence required', await page.getByRole('button',{name:'理由も分かる',exact:true}).isDisabled());
  await page.locator('.sprint-question .quiz-choice').first().click();
  await page.getByRole('button',{name:'理由も分かる',exact:true}).click();
  await page.getByRole('status').waitFor();
  check('answer saved immediately', (await readTable('questionAttempts')).length===1);
  await page.getByRole('button',{name:/今日へ（確定/}).click();
  await openOfficial(); await noOverflow('360px official catalog'); await shot('catalog');
  await page.getByRole('button',{name:/5問ずつ練習/}).click();
  await page.getByRole('heading',{name:/第1問/}).waitFor();
  await noOverflow('360px official question'); await shot('official-question');
  await page.getByRole('button',{name:papers[0].answers[0],exact:true}).click();
  await page.getByRole('button',{name:'次へ →',exact:true}).click();
  await page.reload(); await openOfficial();
  await page.getByRole('heading',{name:/第2問/}).waitFor();
  check('refresh restores question and answer', await page.getByText('1/5問 解答済み', { exact:false }).isVisible());
  for(let i=1;i<5;i++) {
    await page.getByRole('button',{name:papers[0].answers[i],exact:true}).click();
    if(i<4) await page.getByRole('button',{name:'次へ →',exact:true}).click();
  }
  await page.getByRole('button',{name:'解答を終える',exact:true}).click();
  await page.getByRole('button',{name:'採点して保存',exact:true}).click();
  await page.getByRole('heading',{name:'答え合わせ',exact:true}).waitFor();
  let exams=await readTable('mockExams');
  check('official practice auto grades 5/5', exams.some(e=>e.status==='completed'&&e.totalQuestions===5&&e.correctCount===5&&!e.firstAttempt));
  await shot('result');
  await page.getByRole('button',{name:'次の練習を選ぶ',exact:true}).click();
  await page.getByRole('button',{name:/令和7年度上期/}).click();
  await page.getByLabel('この回の問題・解答は、他の教材でも見たことがない').check();
  await page.getByLabel('120分、解説・教材・電卓を使わず自力で解く').check();
  await page.getByRole('button',{name:'50問の本番チャレンジを始める',exact:true}).click();
  await page.getByRole('heading',{name:/第1問/}).waitFor();
  for(let i=0;i<50;i++) {
    await page.getByRole('button',{name:papers[2].answers[i],exact:true}).click();
    if(i===30) {
      await page.getByRole('button',{name:'共通の配線図を開く',exact:true}).click();
      await page.locator('img[alt="共通配線図"]').waitFor();
      check('common wiring diagram loads', await page.locator('img[alt="共通配線図"]').evaluate(img=>img.complete&&img.naturalWidth>0));
      await shot('diagram');
    }
    if(i<49) await page.getByRole('button',{name:'次へ →',exact:true}).click();
  }
  check('no answers leaked during mock', await page.getByText('答え合わせ',{exact:true}).count()===0);
  await page.getByRole('button',{name:'解答を終える',exact:true}).click();
  await page.getByRole('button',{name:'採点して保存',exact:true}).click();
  await page.getByRole('heading',{name:'答え合わせ',exact:true}).waitFor();
  exams=await readTable('mockExams');
  check('50 answers auto grade to 100, first exposure recorded', exams.some(e=>e.totalQuestions===50&&e.correctCount===50&&e.firstAttempt&&e.grading==='official-key'));
  await page.getByRole('button',{name:'次の練習を選ぶ',exact:true}).click();
  await page.getByRole('button',{name:/令和7年度下期/}).click();
  await page.getByRole('button',{name:'50問の本番チャレンジを始める',exact:true}).click();
  await page.getByRole('heading',{name:/第1問/}).waitFor();
  await page.clock.install(); await page.clock.fastForward(7201_000);
  await page.getByText('120分終了。未回答は誤答として採点します。').waitFor();
  check('timeout locks answers', await page.getByRole('button',{name:'イ',exact:true}).isDisabled());
  await page.getByRole('button',{name:'採点して保存',exact:true}).click();
  await page.getByRole('heading',{name:'答え合わせ',exact:true}).waitFor();
  exams=await readTable('mockExams');
  check('timeout records 0/50 at 120 minutes',exams.some(e=>e.officialPaperId===papers[3].id&&e.correctCount===0&&e.minutes===120));
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  await context.setOffline(true); await page.reload(); await openOfficial();
  await page.getByRole('button',{name:/5問ずつ練習/}).click();
  await page.locator('.exam-image-button img').waitFor();
  check('offline official image loaded from PWA', await page.locator('.exam-image-button img').first().evaluate(img=>img.complete&&img.naturalWidth>0));
  await noOverflow('360px offline question');
  check('no browser exceptions', errors.length===0);
  console.log(`${checks} checks passed`);
} finally { await browser.close(); }
