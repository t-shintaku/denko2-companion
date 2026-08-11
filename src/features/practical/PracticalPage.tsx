import { useEffect, useState } from 'react';
import { curriculum, defaultBudgetItems, defectLabel, getResource, skillDefects } from '../../data';
import { repo } from '../../db/repo';
import { formatJstShort } from '../../domain/jst';
import { isLessonComplete, modeForBudget } from '../../domain/lessons';
import {
  BUDGET_CATEGORY_LABEL,
  BUDGET_STATUS_LABEL,
  CANDIDATE_STATUS_LABEL,
  EXAM_MINUTES,
  TARGET_MINUTES,
  budgetSummary,
  candidateStates,
  repeatDefects,
} from '../../domain/practical';
import { useVault } from '../../state/VaultContext';
import type { BudgetItem, LessonMode } from '../../domain/types';

export function PracticalPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const { snapshot, skillGate, reload } = useVault();
  const [recording, setRecording] = useState<number | undefined>();

  // 工具・材料の初期候補を一度だけ入れる(FR-012)。既存は上書きしない
  useEffect(() => {
    if (snapshot.budgetItems.length === 0) {
      void repo.seedBudgetItems(defaultBudgetItems).then(reload);
    }
  }, [snapshot.budgetItems.length, reload]);

  const states = candidateStates(snapshot.skillAttempts);
  const repeats = repeatDefects(snapshot.skillAttempts);
  const summary = budgetSummary(snapshot.budgetItems);
  const skillLessons = curriculum.lessons.filter(
    (l) => l.skillTouch || l.phaseId === 'phase-5' || l.phaseId === 'phase-6',
  );
  const candidates = getResource('official-candidates');
  const defect = getResource('official-defect');

  if (recording !== undefined) {
    return <AttemptForm candidateNo={recording} onClose={() => setRecording(undefined)} />;
  }

  return (
    <main className="app">
      <h1>技能</h1>

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
        速さの指標は最速ではなく直近3回の中央値で見る。
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
                  : 'まだ触れていない'}
              </span>
            </span>
            <button className="btn-sm" onClick={() => setRecording(s.candidateNo)}>
              記録する
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

      <h2>反復欠陥</h2>
      <div className="card">
        {repeats.length === 0 ? (
          <p className="muted">
            同じ欠陥が2回出ると、ここに上がる。上がったら候補問題を丸ごと作り直さず、その工程だけ繰り返す。
          </p>
        ) : (
          <ul className="plain stack">
            {repeats.map((r) => (
              <li key={r.code} className="row row--between">
                <span>{defectLabel(r.code)}</span>
                <span className="badge badge--danger">
                  {r.count}回 / 直近 {formatJstShort(r.lastOn)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>技能ゲート</h2>
      <div className="card">
        <p className="muted">
          いま {skillGate.passedCount} / {skillGate.total}。13問中12問が欠陥なしでも通らない。
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

function AttemptForm({ candidateNo, onClose }: { candidateNo: number; onClose: () => void }) {
  const { reload } = useVault();
  const [diagram, setDiagram] = useState('');
  const [work, setWork] = useState('');
  const [completed, setCompleted] = useState(true);
  const [codes, setCodes] = useState<string[]>([]);
  const [nextFix, setNextFix] = useState('');
  const [busy, setBusy] = useState(false);

  const defectFree = completed && codes.length === 0;

  const submit = async () => {
    setBusy(true);
    try {
      await repo.addSkillAttempt({
        candidateNo,
        diagramMinutes: diagram === '' ? undefined : Number(diagram),
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
            min={0}
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
          <span>時間内に完成した</span>
        </label>
      </div>

      <div className="card">
        <h2>欠陥(公式の判断基準で自己点検)</h2>
        <p className="muted">
          1つでも該当すれば不合格。該当が無ければチェックせずに保存する。
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
          <label htmlFor="next-fix">次に直す1点</label>
          <textarea id="next-fix" value={nextFix} onChange={(e) => setNextFix(e.target.value)} />
        </div>
        <button
          className="btn-primary btn-block"
          disabled={busy || work === '' || Number(work) <= 0}
          onClick={submit}
        >
          {busy ? '保存中…' : '保存する'}
        </button>
      </div>
    </main>
  );
}
