import { useEffect, useRef, useState } from 'react';
import { curriculum, topicName } from '../../data';
import { newId, repo } from '../../db/repo';
import { EXAM_CHOICES, examReadiness, gradeOfficial, officialPapers, officialPractice, validDraft, type ExamDraft } from '../../domain/officialExam';
import { useVault } from '../../state/VaultContext';
import type { LessonMode } from '../../domain/types';

const DRAFT_KEY = 'denko2-official-draft-v1';
const asset = (paperId: string, file: string) => `${import.meta.env.BASE_URL}exams/${paperId}/${file}.webp`;
function loadDraft() {
  try { const d: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); return validDraft(d) ? d : undefined; }
  catch { return undefined; }
}

export function OfficialTrainer({ onClose, onOpenLesson, initialPaperId, initialNumber }: { onClose: () => void; onOpenLesson: (id: string, mode: LessonMode) => void; initialPaperId?: string; initialNumber?: number }) {
  const { snapshot, reload, today } = useVault();
  const [draft, setDraft] = useState<ExamDraft | undefined>(loadDraft);
  const [selected, setSelected] = useState(initialPaperId ?? officialPapers[0]!.id);
  const [first, setFirst] = useState(false);
  const [unaided, setUnaided] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [zoom, setZoom] = useState<string>();
  const [diagram, setDiagram] = useState(false);
  const [result, setResult] = useState<ExamDraft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const lock = useRef(false);
  const paper = officialPapers.find(p => p.id === (draft?.paperId ?? result?.paperId ?? selected))!;
  const number = draft?.numbers[draft.index] ?? 1;
  const readiness = examReadiness(snapshot.mockExams, today);
  const elapsed = draft ? Math.max(0, (now - draft.startedAt) / 1000) : 0;
  const expired = draft?.mode === 'mock' && elapsed >= 7200;
  const seen = snapshot.mockExams.some(e => e.officialPaperId === selected);
  const reflow = 'reflow' in paper && Array.isArray(paper.reflow) && paper.reflow.includes(number);

  const persist = (next: ExamDraft) => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); setDraft(next); return true; }
    catch { setError('端末に途中回答を保存できません。空き容量を確保してから再開してください。'); return false; }
  };
  useEffect(() => {
    if (!draft || draft.finishedAt) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [draft?.id, draft?.finishedAt]);

  const start = async (mode: 'practice' | 'mock') => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const all = Array.from({ length: 50 }, (_, i) => i + 1);
      const numbers = mode === 'mock' ? all : officialPractice(selected, snapshot.questionAttempts, selected === initialPaperId ? initialNumber : undefined);
      const d: ExamDraft = { id: newId('official'), paperId: selected, numbers, mode, startedAt: Date.now(),
        firstAttempt: first && !seen && mode === 'mock', unaided: mode === 'mock' && unaided,
        answers: {}, unsure: {}, index: 0 };
      // Persist before the run begins; beginning is also synced so abandoning doesn't restore first exposure.
      if (!persist(d)) return;
      d.firstAttempt = await repo.beginOfficial(d);
      persist(d); setNow(Date.now()); setResult(undefined); await reload();
    } catch { setError('開始記録を保存できませんでした。画面を戻って再開してください。'); localStorage.removeItem(DRAFT_KEY); setDraft(undefined); }
    finally { setBusy(false); lock.current = false; }
  };
  const finish = async () => {
    if (!draft || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const end = draft.finishedAt ?? (draft.mode === 'mock' ? Math.min(Date.now(), draft.startedAt + 7200_000) : Date.now());
      const d = { ...draft, finishedAt: end };
      if (!persist(d)) return;
      await repo.finishOfficial(d); await reload();
      localStorage.removeItem(DRAFT_KEY); setResult(d); setDraft(undefined); setConfirmEnd(false);
    } catch { setError('結果を保存できませんでした。途中回答はこの端末に残っています。「採点して保存」をもう一度押してください。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const go = (index: number) => { if (draft) { persist({ ...draft, index }); setDiagram(false); setConfirmEnd(false); } };
  const choose = (choice: 'イ' | 'ロ' | 'ハ' | 'ニ') => {
    if (!draft || draft.finishedAt || busy || (draft.mode === 'mock' && Date.now()-draft.startedAt >= 7200_000)) { setNow(Date.now()); return; }
    persist({ ...draft, answers: { ...draft.answers, [number]: choice } });
  };
  const imageView = (src: string, alt: string) => <button className="exam-image-button" onClick={() => setZoom(src)} aria-label={`${alt}を拡大`}><img src={src} alt={alt} onError={() => setError('問題画像を読み込めません。オンラインで再読み込みするか、出典の原本PDFを開いてください。')} /></button>;

  return <main className="app official-trainer">
    <button className="btn-sm" onClick={onClose}>← 今日へ{draft ? '（途中回答はこの端末に保存）' : ''}</button>
    {error && <p role="alert" className="notice">{error}</p>}
    {!draft && !result && <>
      <p className="coach-kicker">THE REAL CHALLENGE</p><h1>本物の問題で、力を確かめる。</h1>
      <p>図・写真・配線図もそのまま。公式5回分、250問を自動採点。</p>
      <section className="card"><strong>{readiness.passed ? '初見の本番形式で目標に到達' : '仕上げのチェックポイント'}</strong>
        <p>{readiness.evidence}</p><p className="muted">公式合格基準は60点。ここでは余裕を見るため、異なる初見3回の平均80点・最低70点を目標にします。合格を保証する数値ではありません。</p></section>
      <details className="card"><summary>初見の問題を使い切ったときは</summary><p>公式サイトの別年度を使い、学科タブの「50問模試」の結果入力から「別年度の初見模試」を記録できます。同じ回のやり直しは練習に使い、新しい回で力を確かめます。</p><a href="https://www.shiken.or.jp/construction/second/qa/index_2.html" target="_blank" rel="noreferrer">別年度の公式問題を開く ↗</a></details>
      <div className="paper-list">{officialPapers.map((p,i) => {
        const runs = snapshot.mockExams.filter(e => e.officialPaperId === p.id && e.status === 'completed');
        const last = runs.at(-1);
        return <button className={`paper-card ${selected === p.id ? 'paper-card--selected' : ''}`} key={p.id} aria-pressed={selected === p.id}
          onClick={() => { setSelected(p.id); setFirst(false); setUnaided(false); }}>
          <span className="coach-kicker">{i < 2 ? '練習におすすめ' : '初見の仕上げに残す'}</span>
          <strong>{p.title.replace(' 第二種電気工事士 学科試験', '')}</strong>
          <span>{last ? `${last.correctCount}/${last.totalQuestions}問正解` : 'まだ採点していません'}</span>
        </button>;
      })}</div>
      <section className="card"><h2>今日はどちらで進む？</h2>
        <button className="btn-block" disabled={busy} onClick={() => void start('practice')}>5問ずつ練習する · 約10分</button>
        <p className="muted">練習した回は初見判定に使えません。はじめは令和6年度の2回を使い、残り3回を仕上げ用に残しましょう。</p>
        <label className="check-row"><input type="checkbox" checked={first} disabled={seen} onChange={e => setFirst(e.target.checked)} />この回の問題・解答は、他の教材でも見たことがない</label>
        <label className="check-row"><input type="checkbox" checked={unaided} onChange={e => setUnaided(e.target.checked)} />120分、解説・教材・電卓を使わず自力で解く</label>
        <button className="btn-primary btn-block" disabled={busy} onClick={() => void start('mock')}>50問の本番チャレンジを始める</button>
        <p className="muted">未チェックでも練習として受けられます。開始後は画面を閉じても時計が進み、120分で解答を締め切ります。申告した初見・自力の条件と、アプリ内の履歴を使って判定します。</p>
      </section>
    </>}
    {draft && <>
      <div className="exam-top"><div><p className="coach-kicker">{draft.mode === 'mock' ? 'EXAM MODE' : 'PRACTICE MODE'}</p><h1>第{number}問 <small> / {draft.numbers.length === 50 ? 50 : '5問練習'}</small></h1></div>
        <strong className={expired ? 'notice' : 'exam-clock'} role="timer" aria-label="残り時間">{draft.mode === 'mock' ? `${Math.floor(Math.max(0,7200-elapsed)/60)}:${String(Math.floor(Math.max(0,7200-elapsed)%60)).padStart(2,'0')}` : '時間制限なし'}</strong>
      </div>
      <progress className="coach-progress" value={Object.keys(draft.answers).length} max={draft.numbers.length} aria-label="解答済み問題数" />
      <p className="muted">{Object.keys(draft.answers).length}/{draft.numbers.length}問 解答済み · 画像をタップで拡大</p>
      {expired && <p className="notice" role="status">120分終了。未回答は誤答として採点します。</p>}
      {number >= 31 && <div className="row"><button className="btn-sm" onClick={() => setDiagram(!diagram)}>{diagram ? '問題に戻る' : '共通の配線図を開く'}</button>
        <button className="btn-sm" onClick={() => setZoom(asset(paper.id, 'page-11'))}>配線図の注意事項</button></div>}
      {diagram ? imageView(asset(paper.id, 'page-15'), '共通配線図') : reflow ? <div className="exam-reflow">
        {imageView(asset(paper.id, `q-${number}-stem`), `第${number}問の問題文と図`)}
        <p className="muted">選択肢（原本の各欄を縦に並べています）</p>
        {EXAM_CHOICES.map((c,i) => <div className="exam-reflow-choice" key={c}>
          <button className={`exam-reflow-answer ${draft.answers[number] === c ? 'exam-reflow-answer--selected' : ''}`} aria-label={`選択肢${c}を選ぶ`} aria-pressed={draft.answers[number] === c}
            disabled={expired || !!draft.finishedAt || busy} onClick={() => choose(c)}><span className="badge">{c}{draft.answers[number] === c ? ' ✓' : ''}</span><img src={asset(paper.id, `q-${number}-${i}`)} alt={`公式の選択肢${c}`} /></button>
          <button className="btn-sm" onClick={() => setZoom(asset(paper.id, `q-${number}-${i}`))}>選択肢{c}を拡大</button>
        </div>)}
        <button className="btn-sm" onClick={() => setZoom(asset(paper.id, `q-${number}`))}>元の横並びで確認する</button>
      </div> : imageView(asset(paper.id, `q-${number}`), `第${number}問の問題と選択肢`)}
      <p className="source-caption">出典：{paper.title} 第{number}問（原本から該当行を切り出し）</p>
      <div className="exam-answer-bar"><div className="exam-choices">{EXAM_CHOICES.map(c => <button key={c} aria-pressed={draft.answers[number] === c} className={draft.answers[number] === c ? 'btn-primary' : ''}
        disabled={expired || !!draft.finishedAt || busy} onClick={() => choose(c)}>{c}</button>)}</div>
        <label className="check-row"><input type="checkbox" checked={draft.unsure[number] ?? false} disabled={expired || !!draft.finishedAt || busy}
          onChange={e => persist({ ...draft, unsure: { ...draft.unsure, [number]: e.target.checked } })} />迷った・あとで見直す</label>
        <div className="row row--between"><button disabled={draft.index === 0} onClick={() => go(draft.index - 1)}>← 前へ</button><button disabled={draft.index + 1 >= draft.numbers.length} onClick={() => go(draft.index + 1)}>次へ →</button></div>
      </div>
      <details><summary>問題一覧・未回答へ移動</summary><div className="exam-navigator">{draft.numbers.map((n,i) => <button key={n} aria-label={`第${n}問 ${draft.answers[n] ? '解答済み' : '未回答'}${draft.unsure[n] ? ' 要見直し' : ''}`} onClick={() => go(i)}
        className={draft.answers[n] ? 'nav-answered' : ''}>{n}{draft.unsure[n] ? '•' : ''}</button>)}</div></details>
      <label className="check-row"><input type="checkbox" checked={!draft.unaided} disabled={busy || !!draft.finishedAt} onChange={e => persist({ ...draft, unaided: !e.target.checked })} />途中で解説・教材を参照した（練習として保存）</label>
      {!confirmEnd && !expired && !draft.finishedAt ? <button className="btn-primary btn-block" disabled={busy} onClick={() => setConfirmEnd(true)}>解答を終える</button> : <div className="card">
        <p>{draft.numbers.length - Object.keys(draft.answers).length}問が未回答です。未回答も誤答として残ります。</p>
        <button className="btn-primary btn-block" disabled={busy} onClick={() => void finish()}>採点して保存</button>
        {!expired && !draft.finishedAt && <button onClick={() => setConfirmEnd(false)}>まだ見直す</button>}
      </div>}
    </>}
    {result && (() => {
      const grades = gradeOfficial(result), correct = grades.filter(g => g.correct).length;
      const weak = [...new Set(grades.filter(g => !g.correct || result.unsure[g.number]).map(g => g.topicId))];
      return <><section className="coach-celebration"><p className="coach-kicker">CHALLENGE COMPLETE</p>
        <h1>{correct / grades.length >= .8 ? '積み重ねが、得点になった。' : '次に伸ばすところが、見つかった。'}</h1>
        <p className="coach-score">{result.mode === 'mock' ? correct * 2 : correct}<small>{result.mode === 'mock' ? ' / 100点' : ' / 5問'}</small></p>
        <p>{result.mode === 'mock' ? `公式合格基準60点に${correct >= 30 ? '到達' : '未到達'}。` : ''}解答時間 {((result.finishedAt! - result.startedAt) / 60000).toFixed(1)}分</p>
        <p className="muted">{result.firstAttempt && result.unaided && result.mode === 'mock' ? '初見・自力のチャレンジとして記録。' : '練習の成績として記録。初見の準備度には加えません。'}</p></section>
        <h2>次に伸ばす科目</h2>{weak.length === 0 ? <p>今回は全問正解。次の初見問題で、別の聞かれ方にも挑戦しよう。</p> : weak.slice(0,3).map(t => {
          const lesson = curriculum.lessons.find(l => l.officialTopicIds.includes(t) && l.practice.kind === 'in-app-questions');
          return <div className="card" key={t}><strong>{topicName(t)}</strong><p>{grades.filter(g => g.topicId === t && (!g.correct || result.unsure[g.number])).map(g => `第${g.number}問`).join('・')} を復習へ追加しました。</p>
            {lesson && <button onClick={() => onOpenLesson(lesson.id, 'minimum')}>基礎の解き方を復習する →</button>}</div>;
        })}
        <h2>答え合わせ</h2><p className="muted">公式解答表で自動採点。個別の解説は未収録です。上の基礎教材と原本で解き方を確かめてから、誤答を解き直しましょう。</p>
        {grades.map(g => <details className="card" key={g.number}><summary>第{g.number}問 {g.correct ? '○ 正解' : '× 誤答'}{result.unsure[g.number] ? ' · 迷いあり' : ''}　正答 {g.answer}</summary>
          <p>選んだ答え：{result.answers[g.number] ?? '未回答'} · {topicName(g.topicId)}</p>{imageView(asset(paper.id, `q-${g.number}`), `第${g.number}問`)}
          {g.number >= 31 && <button onClick={() => setZoom(asset(paper.id, 'page-15'))}>共通配線図を見る</button>}</details>)}
        <button className="btn-primary btn-block" onClick={() => { setResult(undefined); setSelected(paper.id); }}>次の練習を選ぶ</button>
      </>;
    })()}
    <p className="source-caption">電気技術者試験センター公開資料。<a href={paper.questionUrl} target="_blank" rel="noreferrer">問題原本PDF</a>{!draft && <> · <a href={paper.answerUrl} target="_blank" rel="noreferrer">公式解答表</a></>} · <a href="https://www.shiken.or.jp/construction/second/qa/" target="_blank" rel="noreferrer">出典・利用条件</a></p>
    {zoom && <div className="exam-zoom" role="dialog" aria-modal="true" aria-label="問題画像の拡大" onKeyDown={e => { if (e.key === 'Escape') setZoom(undefined); }}>
      <button autoFocus className="btn-primary" onClick={() => setZoom(undefined)}>拡大を閉じる</button><p>横・縦にスクロールできます。</p><div><img src={zoom} alt="公式問題の拡大図" /></div>
    </div>}
  </main>;
}
