import { useEffect, useState } from 'react';
import { curriculum, defaultBudgetItems, defectLabel, getResource, skillDefects } from '../../data';
import { repo } from '../../db/repo';
import { formatJstShort } from '../../domain/jst';
import { isLessonComplete, modeForBudget } from '../../domain/lessons';
import {
  BUDGET_CATEGORY_LABEL,
  BUDGET_STATUS_LABEL,
  CANDIDATE_STATUS_LABEL,
  DEFECT_CLEAR_RUNS,
  EXAM_MINUTES,
  TARGET_MINUTES,
  budgetSummary,
  candidateStates,
  repeatDefects,
  skillCapacity,
} from '../../domain/practical';
import { skillTrend } from '../../domain/growth';
import { useVault } from '../../state/VaultContext';
import type { BudgetItem, LessonMode } from '../../domain/types';

export function PracticalPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const { snapshot, skillGate, reload } = useVault();

  /**
   * 「13問すべてで欠陥なし1回」に、残りの練習枠で届くか。
   * 枠はカリキュラムに残っている「1作品まるごと」のレッスン数で数える。
   * 足りないと分かるのが試験直前では遅いので、常に差分を出す。
   */
  const slotsLeft = curriculum.lessons.filter(
    (l) =>
      l.practice.kind === 'candidate' &&
      !isLessonComplete(l, snapshot.lessonProgress[l.id]),
  ).length;
  const capacity = skillCapacity(snapshot.skillAttempts, slotsLeft);
  const [recording, setRecording] = useState<number | undefined>();
  const [drill, setDrill] = useState<string | undefined>();

  // 工具・材料の初期候補を一度だけ入れる(FR-012)。既存は上書きしない
  useEffect(() => {
    if (snapshot.budgetItems.length === 0) {
      void repo.seedBudgetItems(defaultBudgetItems).then(reload);
    }
  }, [snapshot.budgetItems.length, reload]);

  const states = candidateStates(snapshot.skillAttempts);
  const repeats = repeatDefects(snapshot.skillAttempts);
  const trend = skillTrend(snapshot.skillAttempts);
  // 2周目に「どれを作り直すか」で迷わせない。欠陥が出た題 → 時間超過の題 → 未着手 の順
  const weakest = states
    .map((s) => {
      if (s.attempts > 0 && s.defectFreeCount === 0)
        return { candidateNo: s.candidateNo, rank: 0, why: 'まだ欠陥なしで作れていない' };
      if (s.worstOfRecentThree !== undefined && s.worstOfRecentThree > TARGET_MINUTES)
        return {
          candidateNo: s.candidateNo,
          rank: 1,
          why: `直近で${s.worstOfRecentThree}分(目標${TARGET_MINUTES}分)`,
        };
      if (s.status === 'untouched')
        return { candidateNo: s.candidateNo, rank: 2, why: 'まだ触れていない' };
      return undefined;
    })
    .filter((x): x is { candidateNo: number; rank: number; why: string } => x !== undefined)
    .sort((a, b) => a.rank - b.rank || a.candidateNo - b.candidateNo)
    .slice(0, 3);
  const summary = budgetSummary(snapshot.budgetItems);
  const skillLessons = curriculum.lessons.filter(
    (l) => l.skillTouch || l.phaseId === 'phase-5' || l.phaseId === 'phase-6',
  );
  const candidates = getResource('official-candidates');
  const defect = getResource('official-defect');

  if (recording !== undefined) {
    return <AttemptForm candidateNo={recording} onClose={() => setRecording(undefined)} />;
  }
  if (drill !== undefined) {
    return <DrillForm code={drill} onClose={() => setDrill(undefined)} />;
  }

  return (
    <main className="app">
      <h1>技能クエスト</h1>

      <div className="notice notice--safety">
        <strong>練習は必ず試験用の非通電材料で行う。</strong>
        <br />
        自宅の通電した設備・壁や天井から出ている電線を練習対象にしない。作った作品に電源をつながない。
        技能試験で電動工具は使用不可(電動機能をOFFにしても不可)。
      </div>

      <div className="notice notice--safety">
        <strong>免状を受け取るまで直結工事はできない。</strong>
        <br />
        既設の引掛シーリング／引掛ローゼットへ器具を取り付けるだけなら一般に無資格でも可能だが、
        天井・壁から出ている電源線へ直接つなぐ工事には免状が要る。
        <br />
        <strong>免状が出る前に照明が切れたら、待たずに電気工事店へ依頼する。</strong>
        暗い部屋で無理をしない。異常発熱・焦げ・水濡れ・古い設備・不明な設備も同じく業者へ。
      </div>

      <h2>候補問題 No.1〜13</h2>
      <p className="muted">
        本番は {EXAM_MINUTES} 分、合格基準は作品に欠陥がないこと。練習の目標は {TARGET_MINUTES} 分。
        <strong>時間はすべて複線図＋施工の合計</strong>で見る(本番の{EXAM_MINUTES}分に複線図が含まれるため)。
        速さの指標は最速ではなく直近3回の中央値。
      </p>
      <div className="card">
        {states.map((s) => (
          <div className="row row--between" key={s.candidateNo} style={{ marginBottom: 10 }}>
            <span style={{ flex: '1 1 auto' }}>
              <strong>No.{s.candidateNo}</strong>{' '}
              <span
                className={
                  s.status === 'untouched'
                    ? 'badge'
                    : s.status === 'attempted'
                      ? 'badge badge--warn'
                      : 'badge badge--ok'
                }
              >
                {CANDIDATE_STATUS_LABEL[s.status]}
              </span>
              <br />
              <span className="muted">
                {s.attempts > 0
                  ? `${s.attempts}回 / 欠陥なし${s.defectFreeCount}回${
                      s.medianMinutes !== undefined ? ` / 中央値${s.medianMinutes}分` : ''
                    }${s.lastAttemptedOn ? ` / ${formatJstShort(s.lastAttemptedOn)}` : ''}`
                  : '未挑戦'}
              </span>
            </span>
            <button className="btn-sm" onClick={() => setRecording(s.candidateNo)}>
              やってみる
            </button>
          </div>
        ))}
        <div className="row">
          {candidates && (
            <a className="btn btn-sm" href={candidates.url} target="_blank" rel="noreferrer">
              候補問題PDF(公式)
            </a>
          )}
          {defect && (
            <a className="btn btn-sm" href={defect.url} target="_blank" rel="noreferrer">
              欠陥判断基準(公式)
            </a>
          )}
        </div>
      </div>

      <h2>くり返し出た弱点</h2>
      <div className="card">
        {repeats.length === 0 ? (
          <p className="muted">
            同じ欠陥が2回出たら、ここでピンポイント練習。問題を丸ごとやり直さなくてOK！
          </p>
        ) : (
          <>
            <p className="muted">
              苦手な工程だけ練習して「練習できた！」を押そう。
              または、再発なしで{DEFECT_CLEAR_RUNS}作品を作れば自動クリア。
              <strong>弱点が残り続けることはない。</strong>
              再発したら、またここでリベンジ！
            </p>
            <ul className="plain stack">
              {repeats.map((r) => (
                <li key={r.code} className="stack" style={{ marginBottom: 12 }}>
                  <div className="row row--between">
                    <span>{defectLabel(r.code)}</span>
                    <span className={r.resolved ? 'badge badge--ok' : 'badge badge--danger'}>
                      {r.resolved
                        ? r.resolvedBy === 'drill'
                          ? '対策済み'
                          : `再発なし${r.cleanRuns}作品`
                        : `${r.count}回 / 直近 ${formatJstShort(r.lastOn)}`}
                    </span>
                  </div>
                  {!r.resolved && (
                    <div className="row row--between">
                      <span className="muted">
                        最後に出てから再発なし {r.cleanRuns} / {DEFECT_CLEAR_RUNS} 作品
                      </span>
                      <button
                        className="btn-sm"
                        onClick={() => setDrill(r.code)}
                        aria-label={`${defectLabel(r.code)} の部分練習を記録`}
                      >
                        この工程、練習できた！
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <h2>成長レポート</h2>
      <div className="card">
        {trend.attempts === 0 ? (
          <p className="muted">
            まずNo.1に挑戦！ 1題終えると、時間と欠陥の変化がここに出るよ。
          </p>
        ) : (
          <ul className="plain stack">
            <li>
              作った作品: <strong>{trend.attempts}</strong> 点
              {trend.recentMinutes.length > 0 && (
                <>
                  {' '}／ 直近3作品 {trend.recentMinutes.join(' / ')} 分(複線図込み)
                </>
              )}
            </li>
            {trend.minutesDelta !== undefined && (
              <li>
                {trend.minutesDelta < 0 ? (
                  <span className="badge badge--ok">
                    その前の3作品より平均 {Math.abs(Math.round(trend.minutesDelta))} 分速い
                  </span>
                ) : trend.minutesDelta === 0 ? (
                  <span className="badge">その前の3作品と同じ速さ</span>
                ) : (
                  <span className="badge badge--warn">
                    その前の3作品より平均 {Math.round(trend.minutesDelta)} 分遅い
                  </span>
                )}
              </li>
            )}
            <li>
              直近5作品の欠陥 {trend.recentDefects} 件
              {trend.defectsDelta !== undefined && (
                <span className={trend.defectsDelta <= 0 ? 'badge badge--ok' : 'badge badge--warn'}>
                  {trend.defectsDelta === 0
                    ? ' 前の5作品と同数'
                    : trend.defectsDelta < 0
                      ? ` 前の5作品より${Math.abs(trend.defectsDelta)}件少ない`
                      : ` 前の5作品より${trend.defectsDelta}件多い`}
                </span>
              )}
            </li>
          </ul>
        )}
      </div>

      <h2>次のおすすめ1題</h2>
      <div className="card">
        {weakest.length === 0 ? (
          <p className="muted">まずは未挑戦の番号から、1題ずつ進めよう。</p>
        ) : (
          <ul className="plain stack">
            {weakest.map((w) => (
              <li key={w.candidateNo} className="row row--between">
                <span>
                  <strong>No.{w.candidateNo}</strong> — {w.why}
                </span>
                <button className="btn-sm" onClick={() => setRecording(w.candidateNo)}>
                  やってみる
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>技能クリアへの5ミッション</h2>
      <div className="card">
        <p className="muted">
          いま {skillGate.passedCount} / {skillGate.total} クリア。13問すべての欠陥ゼロを目指そう！
        </p>
        <ul className="plain stack">
          {skillGate.criteria.map((c) => (
            <li key={c.id} className="row row--between">
              <span>
                {c.passed ? '✓ ' : '　'}
                {c.label}
              </span>
              <span className={c.passed ? 'badge badge--ok' : 'badge'}>{c.evidence}</span>
            </li>
          ))}
        </ul>
        {/*
          枠が足りるかを先に言う。1周目で欠陥を出した数が残り枠を超えると、
          ゲートは数学的に閉じたまま動かなくなる。直前に気づくのが最悪。
        */}
        {capacity.remaining > 0 && (
          <p className={capacity.enough ? 'notice' : 'notice notice--safety'}>
            {capacity.enough ? (
              <>
                欠陥ゼロがまだの問題は <strong>{capacity.remaining}問</strong>。
                残りの練習枠は {capacity.slotsLeft}回だから、まだ間に合う！
              </>
            ) : (
              <>
                欠陥ゼロがまだの問題が <strong>{capacity.remaining}問</strong>、
                残りの練習枠は {capacity.slotsLeft}回。<strong>{capacity.shortBy}回ぶん足りない。</strong>
                設定で休日の学習時間を増やすか、技能タブから自主練を追加して記録しよう。
                1作品は複線図込みで約60分。
              </>
            )}
          </p>
        )}
      </div>

      <h2>工具・材料・予算</h2>
      <div className="card">
        <p className="muted">
          高額セットを反射で買わない。まず所有と借用を数える。
          実支出 {summary.actualYen.toLocaleString()}円 / これから買う予定{' '}
          {summary.plannedYen.toLocaleString()}円 / 買わずに済んだもの {summary.avoidedCount}点。
        </p>
        <p className="notice">
          JIS C 9711適合の圧着工具、十分な練習量、必要な消耗品を削る節約はしない。ここだけは削らない。
        </p>
      </div>
      {snapshot.budgetItems
        .slice()
        .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
        .map((item) => (
          <BudgetRow key={item.id} item={item} />
        ))}

      <h2>学科前にも触れておく技能</h2>
      {skillLessons.map((lesson) => (
        <div className="card" key={lesson.id}>
          <div className="row row--between">
            <strong>{lesson.title}</strong>
            <span
              className={
                isLessonComplete(lesson, snapshot.lessonProgress[lesson.id])
                  ? 'badge badge--ok'
                  : 'badge'
              }
            >
              {isLessonComplete(lesson, snapshot.lessonProgress[lesson.id]) ? '完了' : '未完了'}
            </span>
          </div>
          <p className="muted">{lesson.objective}</p>
          <button className="btn-sm" onClick={() => onOpenLesson(lesson.id, modeForBudget(30))}>
            開く
          </button>
        </div>
      ))}
    </main>
  );
}

function BudgetRow({ item }: { item: BudgetItem }) {
  const { reload } = useVault();
  const [actual, setActual] = useState(item.actualYen != null ? String(item.actualYen) : '');

  const save = async (patch: Partial<BudgetItem>) => {
    await repo.saveBudgetItem({ ...item, ...patch });
    await reload();
  };

  return (
    <div className="card">
      <div className="row row--between">
        <strong style={{ flex: '1 1 auto' }}>{item.label}</strong>
        <span className="badge">{BUDGET_CATEGORY_LABEL[item.category]}</span>
      </div>
      <div className="field">
        <label htmlFor={`status-${item.id}`}>状態</label>
        <select
          id={`status-${item.id}`}
          value={item.status}
          onChange={(e) => save({ status: e.target.value as BudgetItem['status'] })}
        >
          {Object.entries(BUDGET_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <span className="muted" style={{ flex: '1 1 auto' }}>
          目安 {item.expectedYen?.toLocaleString() ?? '—'}円{item.required ? ' ・必須' : ''}
        </span>
        <input
          aria-label={`${item.label} の実支出`}
          type="number"
          inputMode="numeric"
          placeholder="実支出"
          style={{ flex: '0 0 110px' }}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          onBlur={() => save({ actualYen: actual === '' ? undefined : Number(actual) })}
        />
      </div>
    </div>
  );
}

/**
 * 反復欠陥の部分練習。**候補問題1回としては数えない。**
 * ここを候補問題の記録に混ぜると、部分練習だけで「13問すべて施工」が通ってしまう。
 */
function DrillForm({ code, onClose }: { code: string; onClose: () => void }) {
  const { reload } = useVault();
  const [minutes, setMinutes] = useState('10');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await repo.addDefectDrill({
        codes: [code],
        minutes: Number(minutes || 0),
        note: note || undefined,
      });
      await reload();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app">
      <button className="btn-sm" onClick={onClose}>
        ← 戻る
      </button>
      <h1>弱点をピンポイント練習</h1>
      <div className="notice notice--safety">非通電の試験用材料のみ。</div>
      <div className="card">
        <p>
          <strong>{defectLabel(code)}</strong>
        </p>
        <p className="muted">
          問題を丸ごと作り直さず、苦手な工程だけ練習すればOK。
          記録したら弱点ミッションをクリア！ 再発したら、またここでリベンジしよう。
        </p>
        <div className="field">
          <label htmlFor="drill-minutes">かかった時間(分)</label>
          <input
            id="drill-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="drill-note">何を変えたか(任意)</label>
          <textarea id="drill-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          className="btn-primary btn-block"
          disabled={busy || Number(minutes) <= 0}
          onClick={submit}
        >
          {busy ? '保存中…' : '練習できた！'}
        </button>
      </div>
    </main>
  );
}

function AttemptForm({ candidateNo, onClose }: { candidateNo: number; onClose: () => void }) {
  const { reload } = useVault();
  const [diagram, setDiagram] = useState('');
  const [work, setWork] = useState('');
  const [completed, setCompleted] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [nextFix, setNextFix] = useState('');
  const [busy, setBusy] = useState(false);

  const defectFree = completed && codes.length === 0;
  const total = Number(work || 0) + Number(diagram || 0);

  const submit = async () => {
    setBusy(true);
    try {
      await repo.addSkillAttempt({
        kind: 'candidate',
        candidateNo,
        diagramMinutes: Number(diagram),
        workMinutes: Number(work),
        completed,
        defectFree,
        defectCodes: codes,
        photoIds: [],
        nextFix: nextFix || undefined,
      });
      await repo.addSession({
        durationMinutes: Number(work) + Number(diagram || 0),
        kind: 'candidate',
        countsAsBasics: false,
        nextFix: nextFix || undefined,
      });
      await reload();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app">
      <button className="btn-sm" onClick={onClose}>
        ← 戻る
      </button>
      <h1>候補No.{candidateNo} の記録</h1>
      <div className="notice notice--safety">
        非通電の試験用材料のみ。完成した作品に電源をつながない。
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="diagram">複線図にかかった時間(分)</label>
          <input
            id="diagram"
            type="number"
            inputMode="numeric"
            min={1}
            required
            value={diagram}
            onChange={(e) => setDiagram(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="work">施工時間(分)</label>
          <input
            id="work"
            type="number"
            inputMode="numeric"
            min={1}
            required
            value={work}
            onChange={(e) => setWork(e.target.value)}
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 'auto' }}
            checked={completed}
            onChange={(e) => setCompleted(e.target.checked)}
          />
          <span>時間内に完成！</span>
        </label>
        {total > 0 && (
          <p className={total <= TARGET_MINUTES ? 'badge badge--ok' : 'badge badge--warn'}>
            合計 {total} 分(本番は{EXAM_MINUTES}分・練習の目標は{TARGET_MINUTES}分)
          </p>
        )}
        <p className="muted">
          判定に使うのは複線図と施工の合計。本番の{EXAM_MINUTES}分には複線図を描く時間が含まれる。
        </p>
      </div>

      <div className="card">
        <h2>欠陥チェック（公式基準）</h2>
        <p className="muted">
          見つかった項目だけチェック。何もなければ、そのまま保存してOK。
        </p>
        {skillDefects.map((d) => (
          <label className="row" key={d.code} style={{ marginBottom: 6 }}>
            <input
              type="checkbox"
              style={{ width: 'auto', minHeight: 'auto' }}
              checked={codes.includes(d.code)}
              onChange={(e) =>
                setCodes((c) => (e.target.checked ? [...c, d.code] : c.filter((x) => x !== d.code)))
              }
            />
            <span style={{ fontSize: '0.85rem' }}>{d.label}</span>
          </label>
        ))}
        <p className={defectFree ? 'badge badge--ok' : 'badge badge--danger'}>
          {defectFree ? '欠陥なし' : `欠陥 ${codes.length}件${completed ? '' : ' + 未完成'}`}
        </p>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="next-fix">次の自分へのひとこと</label>
          <textarea id="next-fix" value={nextFix} onChange={(e) => setNextFix(e.target.value)} />
        </div>
        <button
          className="btn-primary btn-block"
          disabled={busy || !(Number(diagram) > 0) || !(Number(work) > 0)}
          onClick={submit}
        >
          {busy ? '保存中…' : 'この挑戦を保存'}
        </button>
        {(!(Number(diagram) > 0) || !(Number(work) > 0)) && (
          <p className="muted">複線図と施工、両方の時間を入れたら保存できるよ。</p>
        )}
      </div>
    </main>
  );
}
