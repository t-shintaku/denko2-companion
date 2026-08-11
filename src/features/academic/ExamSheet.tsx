import { useEffect, useMemo, useRef, useState } from 'react';
import { topics } from '../../data';
import { repo } from '../../db/repo';
import { ERROR_REASON_LABEL, POINTS_PER_QUESTION } from '../../domain/academic';
import type { ExamInput } from '../../domain/academic';
import { useVault } from '../../state/VaultContext';
import type { ErrorReason, ExamKind, TopicId } from '../../domain/types';

const KIND_TITLE: Record<ExamKind, string> = {
  'diagnostic-20': '20問診断',
  'topic-quiz': 'カテゴリ小テスト',
  'mock-50': '50問模試',
};

type Row = {
  topicId: TopicId;
  correct: boolean | undefined;
  confidence: 1 | 2 | 3;
  errorReason?: ErrorReason;
};

/**
 * 小テスト・模試の記録シート(FR-010)。
 *
 * 問題文はアプリに収録しない(§4.3 著作権)。公式ページで解いて、結果だけここへ入れる。
 * 「1問ずつ」は科目別の弱点と自信度が取れる。50問は「まとめて」でも登録できる。
 */
export function ExamSheet({
  kind,
  count,
  onClose,
}: {
  kind: ExamKind;
  count: number;
  onClose: () => void;
}) {
  const { reload, settings } = useVault();
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'per-question' | 'bulk'>(
    kind === 'mock-50' ? 'bulk' : 'per-question',
  );
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: count }, () => ({
      topicId: 'wiring-diagram' as TopicId,
      correct: undefined,
      confidence: 2 as const,
    })),
  );
  const [bulk, setBulk] = useState<Record<string, { correct: string; total: string }>>(() =>
    Object.fromEntries(topics.map((t) => [t.id, { correct: '', total: '' }])),
  );
  const [timed, setTimed] = useState(kind === 'mock-50');
  const [minutes, setMinutes] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // 本番同様の計測。試験中は正誤を出さない(FR-010)
  const [running, setRunning] = useState(false);
  const startedRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (startedRef.current) setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const bulkTotals = useMemo(() => {
    let correct = 0;
    let total = 0;
    for (const t of topics) {
      correct += Number(bulk[t.id]?.correct || 0);
      total += Number(bulk[t.id]?.total || 0);
    }
    return { correct, total };
  }, [bulk]);

  const perQuestionAnswered = rows.filter((r) => r.correct !== undefined).length;
  const perQuestionCorrect = rows.filter((r) => r.correct === true).length;

  const ready =
    label.trim() !== '' &&
    (mode === 'bulk' ? bulkTotals.total > 0 : perQuestionAnswered === rows.length);

  const submit = async () => {
    setBusy(true);
    try {
      const questions: ExamInput['questions'] =
        mode === 'bulk'
          ? topics.flatMap((t) => {
              const total = Number(bulk[t.id]?.total || 0);
              const correct = Number(bulk[t.id]?.correct || 0);
              return Array.from({ length: total }, (_, i) => ({
                topicId: t.id,
                correct: i < correct,
                // まとめて入力では自信度を取れない。中立の2にする
                confidence: 2 as const,
              }));
            })
          : rows.map((r) => ({
              topicId: r.topicId,
              correct: r.correct === true,
              confidence: r.confidence,
              errorReason: r.errorReason,
            }));

      const measured = startedRef.current
        ? Math.max(1, Math.round((Date.now() - startedRef.current) / 60_000))
        : undefined;

      await repo.recordExam({
        kind,
        label: label.trim(),
        timed,
        minutes: minutes === '' ? measured : Number(minutes),
        note: note || undefined,
        questions,
      });

      if (kind === 'diagnostic-20' && settings && !settings.diagnosticCompletedAt) {
        await repo.saveSettings({ ...settings, diagnosticCompletedAt: new Date().toISOString() });
      }
      await repo.addSession({
        durationMinutes: minutes === '' ? (measured ?? 30) : Number(minutes),
        kind: kind === 'mock-50' ? 'mock' : 'questions',
        countsAsBasics: kind !== 'mock-50',
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
      <h1>{KIND_TITLE[kind]}を記録</h1>
      <p className="muted">
        問題はアプリに入っていない。公式ページで解いて、結果だけここへ入れる。
        {kind === 'mock-50' &&
          ' 50問=100点(1問2点)。公式の合格基準は60点、本ツールの目標は80点。'}
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="exam-label">出典(年度・期がわかるように)</label>
          <input
            id="exam-label"
            value={label}
            placeholder="例: 令和7年度上期 学科(CBT)"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        {kind === 'mock-50' && (
          <>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto', minHeight: 'auto' }}
                checked={timed}
                onChange={(e) => setTimed(e.target.checked)}
              />
              <span>本番同様(120分を計って中断なし)</span>
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className={running ? 'btn-sm' : 'btn-primary btn-sm'}
                onClick={() => {
                  if (!running) startedRef.current = Date.now();
                  setRunning(!running);
                }}
              >
                {running ? '計測を止める' : '120分の計測を始める'}
              </button>
              <span className="badge">
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')} / 120:00
              </span>
            </div>
            {running && (
              <p className="notice">
                計測中。ここでは正誤を表示しない。解き終わってから結果を入れる。
              </p>
            )}
          </>
        )}
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="exam-minutes">かかった時間(分・空欄なら計測値)</label>
          <input
            id="exam-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>

      <div className="row" role="group" aria-label="入力方法">
        <button
          className={mode === 'per-question' ? 'btn-primary btn-sm' : 'btn-sm'}
          onClick={() => setMode('per-question')}
        >
          1問ずつ
        </button>
        <button
          className={mode === 'bulk' ? 'btn-primary btn-sm' : 'btn-sm'}
          onClick={() => setMode('bulk')}
        >
          科目ごとにまとめて
        </button>
      </div>
      <p className="muted">
        1問ずつなら誤答の理由と自信度が残り、復習キューが効く。まとめてなら早いが、
        「自信の低い正解」は拾えない。
      </p>

      {mode === 'bulk' ? (
        <div className="card">
          {topics.map((t) => (
            <div className="row" key={t.id} style={{ marginBottom: 8 }}>
              <span style={{ flex: '1 1 120px', fontSize: '0.85rem' }}>{t.shortName}</span>
              <input
                aria-label={`${t.shortName} 正答数`}
                type="number"
                inputMode="numeric"
                min={0}
                style={{ flex: '0 0 70px' }}
                placeholder="正答"
                value={bulk[t.id]?.correct ?? ''}
                onChange={(e) =>
                  setBulk((b) => ({
                    ...b,
                    [t.id]: { correct: e.target.value, total: b[t.id]?.total ?? '' },
                  }))
                }
              />
              <input
                aria-label={`${t.shortName} 問題数`}
                type="number"
                inputMode="numeric"
                min={0}
                style={{ flex: '0 0 70px' }}
                placeholder="問題数"
                value={bulk[t.id]?.total ?? ''}
                onChange={(e) =>
                  setBulk((b) => ({
                    ...b,
                    [t.id]: { correct: b[t.id]?.correct ?? '', total: e.target.value },
                  }))
                }
              />
            </div>
          ))}
          <p>
            合計 {bulkTotals.correct} / {bulkTotals.total} 問
            {kind === 'mock-50' && ` — ${bulkTotals.correct * POINTS_PER_QUESTION}点`}
          </p>
        </div>
      ) : (
        <div>
          {rows.map((row, i) => (
            <div className="card" key={i}>
              <div className="row row--between">
                <strong>第{i + 1}問</strong>
                <div className="row">
                  <button
                    className={row.correct === true ? 'btn-primary btn-sm' : 'btn-sm'}
                    aria-label={`第${i + 1}問 正解`}
                    aria-pressed={row.correct === true}
                    onClick={() =>
                      setRows((rs) =>
                        rs.map((r, j) => (j === i ? { ...r, correct: true, errorReason: undefined } : r)),
                      )
                    }
                  >
                    ○ 正解
                  </button>
                  <button
                    className={row.correct === false ? 'btn-primary btn-sm' : 'btn-sm'}
                    aria-label={`第${i + 1}問 不正解`}
                    aria-pressed={row.correct === false}
                    onClick={() =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, correct: false } : r)))
                    }
                  >
                    × 不正解
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor={`topic-${i}`}>科目</label>
                <select
                  id={`topic-${i}`}
                  value={row.topicId}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r, j) => (j === i ? { ...r, topicId: e.target.value as TopicId } : r)),
                    )
                  }
                >
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`conf-${i}`}>自信</label>
                <select
                  id={`conf-${i}`}
                  value={row.confidence}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r, j) =>
                        j === i ? { ...r, confidence: Number(e.target.value) as 1 | 2 | 3 } : r,
                      ),
                    )
                  }
                >
                  <option value={1}>1 あてずっぽう</option>
                  <option value={2}>2 たぶん</option>
                  <option value={3}>3 確実</option>
                </select>
              </div>
              {row.correct === false && (
                <div className="field">
                  <label htmlFor={`reason-${i}`}>なぜ落とした?</label>
                  <select
                    id={`reason-${i}`}
                    value={row.errorReason ?? ''}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((r, j) =>
                          j === i
                            ? { ...r, errorReason: (e.target.value || undefined) as ErrorReason }
                            : r,
                        ),
                      )
                    }
                  >
                    <option value="">選ぶ</option>
                    {Object.entries(ERROR_REASON_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}
          <p className="muted">
            {perQuestionAnswered} / {rows.length} 問 入力済み(正答 {perQuestionCorrect})
          </p>
        </div>
      )}

      <div className="card">
        <div className="field">
          <label htmlFor="exam-note">気づいたこと(任意)</label>
          <textarea id="exam-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn-primary btn-block" disabled={!ready || busy} onClick={submit}>
          {busy ? '保存中…' : '結果を保存する'}
        </button>
        {!ready && (
          <p className="muted">
            出典と{mode === 'bulk' ? '問題数' : 'すべての問題の○×'}を入れると保存できる。
          </p>
        )}
      </div>
    </main>
  );
}
