import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveResource } from '../../data';
import { countsAsBasics } from '../../domain/onboarding';
import { repo } from '../../db/repo';
import { nowJstIso } from '../../domain/jst';
import {
  LESSON_COMPLETE_XP,
  MODE_LABEL,
  STEP_LABEL,
  applyStep,
  isLessonComplete,
  nextStep,
  requiredSteps,
  stepDone,
  type LessonStep,
} from '../../domain/lessons';
import { useVault } from '../../state/VaultContext';
import type { CurriculumLesson, LessonMode, SessionKind } from '../../domain/types';

const PRACTICE_TO_SESSION: Record<string, SessionKind> = {
  'external-questions': 'questions',
  'in-app-questions': 'questions',
  'wiring-diagram': 'wiring-diagram',
  'basic-skill': 'basic-skill',
  candidate: 'candidate',
  checklist: 'theory',
};

export function LessonPage({
  lesson,
  initialMode,
  onClose,
}: {
  lesson: CurriculumLesson;
  initialMode: LessonMode;
  onClose: () => void;
}) {
  const { snapshot, settings, reload } = useVault();
  const progress = snapshot.lessonProgress[lesson.id];
  const [mode, setMode] = useState<LessonMode>(progress?.mode ?? initialMode);
  const [recall, setRecall] = useState<string[]>(
    () => progress?.recallAnswers ?? lesson.recallPrompts.map(() => ''),
  );
  const [practiceNote, setPracticeNote] = useState(progress?.practiceNote ?? '');
  const [correct, setCorrect] = useState<string>(
    progress?.practiceCorrect != null ? String(progress.practiceCorrect) : '',
  );
  const [total, setTotal] = useState<string>(
    progress?.practiceTotal != null
      ? String(progress.practiceTotal)
      : lesson.practice.targetCount != null
        ? String(lesson.practice.targetCount)
        : '',
  );
  const [takeaway, setTakeaway] = useState(progress?.takeaway ?? '');
  const [terms, setTerms] = useState<string[]>(['', '', '']);
  const [busy, setBusy] = useState(false);

  // 学習時間は実測する。見積(estimatedMinutes)をそのまま実績にしない。
  // 見積を自動記録すると、画面をクリックするだけで基礎180分ゲートが開いてしまう。
  const openedAtRef = useRef<number>(Date.now());
  const [actualMinutes, setActualMinutes] = useState<string>('');

  const steps = requiredSteps(lesson);
  const upcoming = nextStep(lesson, progress);
  const complete = isLessonComplete(lesson, progress);
  const isUngradedFive = lesson.stage === 'ungraded-five';

  const measuredMinutes = () =>
    Math.max(1, Math.round((Date.now() - openedAtRef.current) / 60_000));

  // 「1点残す」まで来た時点で実測値を入れておく。本人はそのまま出すか直せる。
  const reachedTakeaway = upcoming === 'takeaway';
  useEffect(() => {
    if (reachedTakeaway && actualMinutes === '') setActualMinutes(String(measuredMinutes()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachedTakeaway]);

  const resources = useMemo(
    () => lesson.resources.map(resolveResource).filter((r) => r !== undefined),
    [lesson.resources],
  );

  const commit = async (step: LessonStep) => {
    setBusy(true);
    try {
      const before = snapshot.lessonProgress[lesson.id];
      const next = applyStep(lesson, before, step, {
        mode,
        recallAnswers: recall,
        practiceNote,
        practiceCorrect: correct === '' ? undefined : Number(correct),
        practiceTotal: total === '' ? undefined : Number(total),
        takeaway,
      });
      await repo.saveLessonProgress(next);

      // 完了した瞬間にだけ学習セッションを1件記録する。
      // 動画を開いただけ(input のみ)では記録もXPも増えない(AT-003)。
      if (!before?.completedAt && next.completedAt) {
        const measured = measuredMinutes();
        const confirmed = Number(actualMinutes);
        await repo.addSession({
          // 本人が確認・修正した実績時間。未入力なら実測値
          durationMinutes: Number.isFinite(confirmed) && confirmed > 0 ? confirmed : measured,
          measuredMinutes: measured,
          estimatedMinutes: lesson.estimatedMinutes[mode],
          kind: PRACTICE_TO_SESSION[lesson.practice.kind] ?? 'theory',
          lessonId: lesson.id,
          // オリエンテーション(§6 Step 1)と無採点5問(Step 2)は基礎学習(Step 3)ではない
          countsAsBasics: countsAsBasics(lesson),
          nextFix: takeaway,
        });
        if (isUngradedFive && settings) {
          await repo.addUnknownTerms(terms, 'ungraded-five');
          await repo.saveSettings({ ...settings, ungradedFiveCompletedAt: nowJstIso() });
        }
        if (lesson.stage === 'diagnostic' && settings) {
          await repo.saveSettings({ ...settings, diagnosticCompletedAt: nowJstIso() });
        }
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app">
      <button className="btn-sm" onClick={onClose}>
        ← 戻る
      </button>
      <h1>{lesson.title}</h1>
      <p className="muted">{lesson.objective}</p>

      <div className="row" role="group" aria-label="今日の持ち時間">
        {(['minimum', 'standard', 'deep'] as LessonMode[]).map((m) => (
          <button
            key={m}
            className={m === mode ? 'btn-primary btn-sm' : 'btn-sm'}
            onClick={() => setMode(m)}
            aria-pressed={m === mode}
          >
            {MODE_LABEL[m]}版({lesson.estimatedMinutes[m]}分)
          </button>
        ))}
      </div>

      <div className="steps" style={{ marginTop: 12 }}>
        {steps.map((s) => (
          <div
            key={s}
            className={[
              'step',
              stepDone(progress, s) ? 'step--done' : '',
              upcoming === s ? 'step--next' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {stepDone(progress, s) ? '✓ ' : ''}
            {STEP_LABEL[s]}
          </div>
        ))}
      </div>

      {lesson.safetyNote && <div className="notice notice--safety">{lesson.safetyNote}</div>}

      {/* --- 1. 見る --------------------------------------------------- */}
      <section className="card">
        <h2>1. 見る</h2>
        {resources.length === 0 && <p className="muted">教材リンクなし。手元の材料・記録を使う。</p>}
        <ul className="plain stack">
          {resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.provider}｜{r.title}
              </a>
              <div className="muted">
                {r.role === 'official-check' ? '公式資料' : '民間の解説'}
                {r.expectedMinutes ? ` ・約${r.expectedMinutes}分` : ''} ・確認日 {r.lastVerified}
                {r.verification === 'requirements-doc' ? '(要件書記載。到達性は未検証)' : ''}
              </div>
              {r.copyrightNote && <div className="muted">{r.copyrightNote}</div>}
            </li>
          ))}
        </ul>
        <button
          className="btn-sm btn-block"
          disabled={busy || stepDone(progress, 'input')}
          onClick={() => commit('input')}
        >
          {stepDone(progress, 'input') ? '✓ 見た' : '見たので次へ'}
        </button>
        <p className="muted">見ただけでは完了にならない。XPも0のまま。</p>
      </section>

      {/* --- 2. 閉じて答える -------------------------------------------- */}
      <section className="card">
        <h2>2. 閉じて答える</h2>
        <p className="muted">教材の画面を閉じてから答える。見ながら書くと意味がない。</p>
        {lesson.recallPrompts.map((p, i) => (
          <div className="field" key={p.id}>
            <label htmlFor={p.id}>{p.prompt}</label>
            <textarea
              id={p.id}
              value={recall[i] ?? ''}
              onChange={(e) =>
                setRecall((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                })
              }
            />
          </div>
        ))}
        <button
          className="btn-sm btn-block"
          disabled={busy || recall.every((r) => r.trim() === '')}
          onClick={() => commit('recall')}
        >
          {stepDone(progress, 'recall') ? '✓ 保存済み(上書き)' : '思い出した内容を保存'}
        </button>
      </section>

      {/* --- 3. 解く／作る ---------------------------------------------- */}
      <section className="card">
        <h2>3. 解く／作る</h2>
        <p>{lesson.practice.instruction}</p>
        {lesson.practice.resourceIds?.map((id) => {
          const r = resolveResource(id);
          return r ? (
            <p key={id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.title}を開く
              </a>
            </p>
          ) : null;
        })}
        {!lesson.practice.scored && (
          <p className="notice">
            {isUngradedFive
              ? 'これは診断テストではない。点は数えない。知らなかった言葉を拾えれば成功。'
              : 'このステップは採点しない。'}
          </p>
        )}
        {lesson.practice.scored && (
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="correct">正答数</label>
              <input
                id="correct"
                type="number"
                inputMode="numeric"
                min={0}
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="total">問題数</label>
              <input
                id="total"
                type="number"
                inputMode="numeric"
                min={0}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
          </div>
        )}
        {isUngradedFive && (
          <div className="field">
            <label>知らなかった言葉(最大3つ)</label>
            {terms.map((t, i) => (
              <input
                key={i}
                value={t}
                placeholder={`${i + 1}つめ`}
                style={{ marginBottom: 6 }}
                onChange={(e) =>
                  setTerms((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  })
                }
              />
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor="practiceNote">やったことのメモ</label>
          <textarea
            id="practiceNote"
            value={practiceNote}
            onChange={(e) => setPracticeNote(e.target.value)}
          />
        </div>
        <button
          className="btn-sm btn-block"
          disabled={busy || (lesson.practice.scored ? total.trim() === '' : practiceNote.trim() === '')}
          onClick={() => commit('practice')}
        >
          {stepDone(progress, 'practice') ? '✓ 保存済み(上書き)' : '結果を保存'}
        </button>
      </section>

      {/* --- 4. 1点残す ------------------------------------------------- */}
      <section className="card">
        <h2>4. 1点残す</h2>
        <p className="muted">間違い・不明語・次に直す点を1つだけ。多く書かない。</p>
        <textarea
          aria-label="次に直す1点"
          value={takeaway}
          onChange={(e) => setTakeaway(e.target.value)}
        />
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="actual-minutes">実際にかかった時間(分)</label>
          <div className="row">
            <input
              id="actual-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              max={600}
              style={{ flex: 1 }}
              value={actualMinutes}
              onChange={(e) => setActualMinutes(e.target.value)}
            />
            <button
              type="button"
              className="btn-sm"
              onClick={() => setActualMinutes(String(measuredMinutes()))}
            >
              計測値を使う
            </button>
          </div>
          <p className="muted">
            この画面を開いてからの実測値を入れている。動画を別の場所で見た分などは自分で直す。
            記録するのは見積({lesson.estimatedMinutes[mode]}分)ではなく、この実績。
            {countsAsBasics(lesson)
              ? ' この時間は基礎学習180分に算入される。'
              : ' このレッスンは入口段階なので、基礎学習180分には算入しない。'}
          </p>
        </div>
        <button
          className="btn-primary btn-block"
          disabled={busy || takeaway.trim() === ''}
          onClick={() => commit('takeaway')}
        >
          {stepDone(progress, 'takeaway') ? '✓ 保存済み(上書き)' : '保存してレッスンを閉じる'}
        </button>
      </section>

      {complete ? (
        <div className="card card--accent">
          <strong>完了。XP +{LESSON_COMPLETE_XP}</strong>
          <p className="muted">
            4段階すべてを満たした。学習時間 {lesson.estimatedMinutes[mode]} 分を記録した。
          </p>
          <button className="btn-block" onClick={onClose}>
            ホームへ戻る
          </button>
        </div>
      ) : (
        <p className="muted">
          残り: {steps.filter((s) => !stepDone(progress, s)).map((s) => STEP_LABEL[s]).join(' → ')}
        </p>
      )}
    </main>
  );
}
