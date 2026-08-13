import { useEffect, useMemo, useRef, useState } from 'react';
import { topics } from '../../data';
import { repo } from '../../db/repo';
import {
  ACADEMIC_EXAM_MINUTES,
  ERROR_REASON_LABEL,
  EXAM_QUESTION_COUNT,
  POINTS_PER_QUESTION,
} from '../../domain/academic';
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
  /** まとめ入力でも「どの問題を落としたか」だけは残せるようにする欄 */
  const [wrongInput, setWrongInput] = useState('');
  const wrongNumbers = useMemo(
    () =>
      wrongInput
        .split(/[,、\s]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= count),
    [wrongInput, count],
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

  /** 計測ボタンで測れている分数(保存前の判定に使う) */
  const measuredSoFar = Math.floor(elapsed / 60);

  const perQuestionAnswered = rows.filter((r) => r.correct !== undefined).length;
  const perQuestionCorrect = rows.filter((r) => r.correct === true).length;

  /**
   * 保存できない理由を先に全部出す。
   * 50問模試は50問ちょうどでないと点数が意味を持たない(1問2点なので、
   * 80問入れれば120点の模試ができてしまい、平均80点ゲートが壊れる)。
   */
  const requiredCount = EXAM_QUESTION_COUNT[kind];
  const blockers = useMemo(() => {
    const list: string[] = [];
    if (label.trim() === '') list.push('出典(年度・期)を入れる');

    if (mode === 'bulk') {
      for (const t of topics) {
        const c = Number(bulk[t.id]?.correct || 0);
        const n = Number(bulk[t.id]?.total || 0);
        if (c > n) list.push(`${t.shortName}: 正答数(${c})が問題数(${n})を超えている`);
      }
      if (requiredCount !== undefined && bulkTotals.total !== requiredCount) {
        list.push(
          `問題数の合計を${requiredCount}問ちょうどにする(いま ${bulkTotals.total}問)。` +
            `学科は${requiredCount}問固定なので、ここがずれると点数も判定も狂う`,
        );
      }
      if (requiredCount === undefined && bulkTotals.total < 1) list.push('問題数を入れる');
    }
    // 「本番同様」は学科ゲートの「120分模試2回」に直接効く。
    // タイマーも使わず時間も空欄のまま数えると、2件で条件が通ってしまう
    if (timed) {
      const entered = minutes === '' ? measuredSoFar : Number(minutes);
      if (!(entered > 0)) {
        list.push(
          '「本番同様」にするなら、かかった時間を入れる(または計測を使う)。' +
            '時間の無い回は120分模試として数えない',
        );
      } else if (entered > ACADEMIC_EXAM_MINUTES) {
        list.push(
          `${ACADEMIC_EXAM_MINUTES}分を超えた回は「本番同様」にしない(${entered}分)。` +
            'チェックを外せばそのまま保存できる',
        );
      }
    } else if (perQuestionAnswered !== rows.length) {
      list.push(`未回答が ${rows.length - perQuestionAnswered}問ある`);
    }
    return list;
  }, [
    label,
    mode,
    bulk,
    bulkTotals,
    perQuestionAnswered,
    rows.length,
    requiredCount,
    timed,
    minutes,
    measuredSoFar,
  ]);

  const ready = blockers.length === 0;

  const submit = async () => {
    setBusy(true);
    try {
      // 誤答番号は入力された順に、誤答レコードへ割り当てる
      const wrongQueue = [...wrongNumbers];
      const questions: ExamInput['questions'] =
        mode === 'bulk'
          ? topics.flatMap((t) => {
              const total = Number(bulk[t.id]?.total || 0);
              const correct = Number(bulk[t.id]?.correct || 0);
              return Array.from({ length: total }, (_, i) => {
                const isCorrect = i < correct;
                const no = isCorrect ? undefined : wrongQueue.shift();
                return {
                  topicId: t.id,
                  correct: isCorrect,
                  /**
                   * まとめ入力では1問ずつの自信度を取れない。
                   * 正解は 3(=復習キューへ入れない)、誤答は 2 にする。
                   * ここを一律 2 にすると、40問正解でも50問全部が復習キューへ入り、
                   * 「間違えた箇所を潰す」という復習の意味が消える。
                   */
                  confidence: (isCorrect ? 3 : 2) as 1 | 2 | 3,
                  // 番号を入れてもらえたら本物の問題番号を残す。
                  // 入れていないときに連番を振ると、解き直す問題を特定できない偽番号になる
                  questionRef: isCorrect
                    ? `${label.trim()} ${t.shortName}(まとめ入力・正解)`
                    : no !== undefined
                      ? `${label.trim()} 第${no}問`
                      : `${label.trim()} ${t.shortName}(番号未記入の誤答)`,
                };
              });
            })
          : rows.map((r, i) => ({
              topicId: r.topicId,
              correct: r.correct === true,
              confidence: r.confidence,
              errorReason: r.errorReason,
              questionRef: `${label.trim()} 第${i + 1}問`,
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
      <h1>{KIND_TITLE[kind]}の結果</h1>
      <p className="muted">
        公式ページで問題を解いたら、結果だけサクッと記録しよう。
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
              <span>
                本番同様({ACADEMIC_EXAM_MINUTES}分を計って中断なし)
                <br />
                <span className="muted">
                  学科ミッションの「{ACADEMIC_EXAM_MINUTES}分模試2回」にプラス。時間を入れた回だけカウント
                </span>
              </span>
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className={running ? 'btn-sm' : 'btn-primary btn-sm'}
                onClick={() => {
                  if (!running) startedRef.current = Date.now();
                  setRunning(!running);
                }}
              >
                {running ? 'タイマーを止める' : '120分タイマー開始'}
              </button>
              <span className="badge">
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')} / 120:00
              </span>
            </div>
            {running && (
              <p className="notice">
                本番モードで計測中！ 解き終わってから結果を入れよう。
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
        じっくり残すなら「1問ずつ」、早く終えるなら「まとめて」。
        まとめても<strong>間違えた問題</strong>はリベンジ問題に入るよ。
        あやふやな正解も残したいなら「1問ずつ」がおすすめ。
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
          <div className="field">
            <label htmlFor="wrong-numbers">落とした問題の番号(任意・例: 3,7,12)</label>
            <input
              id="wrong-numbers"
              inputMode="numeric"
              placeholder="3, 7, 12"
              value={wrongInput}
              onChange={(e) => setWrongInput(e.target.value)}
            />
            <p className="muted">
              入れておくと復習キューに<strong>本物の問題番号</strong>が残り、あとで解き直す問題を特定できる。
              空欄でも保存できるが、そのときは科目だけが手がかりになる。
              いま {wrongNumbers.length} 件 / 誤答 {bulkTotals.total - bulkTotals.correct} 問。
            </p>
          </div>
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
          {busy ? '保存中…' : '結果を保存！'}
        </button>
        {!ready && (
          <ul className="plain muted" data-testid="exam-blockers">
            {blockers.map((b) => (
              <li key={b}>・{b}</li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
