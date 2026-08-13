import { useEffect, useMemo, useRef, useState } from 'react';
import { questions as questionBank, questionsFor, resolveResource, skillDefects, topicIds } from '../../data';
import { countsAsBasics } from '../../domain/onboarding';
import { CANDIDATE_NUMBERS, EXAM_MINUTES, TARGET_MINUTES } from '../../domain/practical';
import { repo } from '../../db/repo';
import { nowJstIso } from '../../domain/jst';
import {
  MODE_LABEL,
  STEP_LABEL,
  applyStep,
  isLessonComplete,
  nextStep,
  requiredSteps,
  stepDone,
  stepMinutes,
  xpForLesson,
  type LessonStep,
} from '../../domain/lessons';
import {
  grade,
  pickMistakes,
  pickWeakTopic,
  present,
  toAttemptInput,
  type QuizAnswer,
  type PresentedQuestion,
} from '../../domain/quiz';
import { useVault } from '../../state/VaultContext';
import type {
  CreatorKind,
  CurriculumLesson,
  LessonMode,
  LessonProgress,
  RecallMark,
  ResourceUse,
  SessionKind,
} from '../../domain/types';

/** 並び順。今日まず開く1本を必ず先頭に出す */
const USE_ORDER: Record<ResourceUse, number> = { first: 0, more: 1, stuck: 2, official: 3 };

const USE_LABEL: Record<ResourceUse, string> = {
  first: 'まずこれ',
  more: '余力があれば',
  stuck: '詰まったときだけ',
  official: '公式で答え合わせ',
};

const CREATOR_LABEL: Record<CreatorKind, string> = {
  public: '公式・官公庁',
  company: '企業',
  individual: '個人の解説者',
};

const PRACTICE_TO_SESSION: Record<string, SessionKind> = {
  'external-questions': 'questions',
  'in-app-questions': 'questions',
  'wiring-diagram': 'wiring-diagram',
  'basic-skill': 'basic-skill',
  candidate: 'candidate',
  checklist: 'theory',
};

type QuizPick = { choiceIndex: number; sure?: boolean };

function restoreQuizDraft(
  presented: PresentedQuestion[],
  draft: LessonProgress['quizDraft'],
): Record<string, QuizPick> {
  const restored: Record<string, QuizPick> = {};
  for (const item of draft ?? []) {
    const shown = presented.find(({ question }) => question.id === item.questionId);
    const choiceIndex = shown?.choices.indexOf(item.choice) ?? -1;
    if (choiceIndex >= 0) {
      restored[item.questionId] = { choiceIndex, sure: item.sure };
    }
  }
  return restored;
}

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

  /**
   * 「見ないで思い出す」の答え合わせ。
   *
   * 以前は書いて保存するだけで、合っているかどうかがどこにも出なかった。
   * 書いた本人は、思い出せたのか作文しただけなのかを判別できない。
   * 模範解答を出し、○△×を自分で付けて、△×だけを次に戻す。
   * 自己申告なので**合格準備度には入れない**(科目別正答率を汚さない)。
   */
  const [revealed, setRevealed] = useState<boolean[]>(() => lesson.recallPrompts.map(() => false));
  const [marks, setMarks] = useState<(RecallMark | undefined)[]>(
    () => progress?.recallSelfMarks ?? lesson.recallPrompts.map(() => undefined),
  );

  /**
   * アプリ内出題。**今日「まず見る」で見た内容だけから出す**。
   * 固定の問題番号を持たないレッスン(直前期の誤答潰し)は、その場の記録から選ぶ。
   */
  const quizQuestions = useMemo(() => {
    const pool = lesson.practice.questionPool;
    const picked =
      pool === 'mistakes'
        ? pickMistakes(questionBank, snapshot.questionAttempts, lesson.practice.targetCount ?? 10)
        : pool === 'weak-topic'
          ? pickWeakTopic(
              questionBank,
              snapshot.questionAttempts,
              topicIds,
              lesson.practice.targetCount ?? 10,
            )
          : questionsFor(lesson.practice.questionIds);
    // 選択肢を並べ替える。バンクは正解を先頭に書いてあるので、
    // そのまま出すと一番上を選び続けるだけで全問正解になる
    return present(picked);
    // 出題は画面を開いた時点で固定する。解いている途中で並びが変わらないようにする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  const hasQuiz = quizQuestions.length > 0;
  // 誤答が0件なら、そのこと自体がこの復習レッスンの達成。必須レッスンを進行不能にしない。
  const emptyQuestionPool = Boolean(lesson.practice.questionPool && !hasQuiz);
  /** 2段階。選択肢を選ぶ → 解説を読む → 「バッチリ / あやふや」で確定 */
  const [picks, setPicks] = useState<Record<string, QuizPick>>(() =>
    restoreQuizDraft(quizQuestions, progress?.quizDraft),
  );
  const restoredQuizDraftRef = useRef(Boolean(progress?.quizDraft?.length));

  // Vault の IndexedDB 読み込みは初回描画より後になることがある。
  // その場合も、保存済みの途中回答を一度だけ画面へ戻す。
  useEffect(() => {
    if (restoredQuizDraftRef.current || !progress?.quizDraft?.length) return;
    const restored = restoreQuizDraft(quizQuestions, progress.quizDraft);
    setPicks((current) => (Object.keys(current).length > 0 ? current : restored));
    restoredQuizDraftRef.current = true;
  }, [progress?.quizDraft, quizQuestions]);

  const settled: QuizAnswer[] = quizQuestions.flatMap(({ question }) => {
    const p = picks[question.id];
    if (p?.sure === undefined) return [];
    return [{ questionId: question.id, choiceIndex: p.choiceIndex, sure: p.sure }];
  });
  const quizResults = grade(quizQuestions, settled);
  const quizCorrect = quizResults.filter((r) => r.correct).length;
  const quizDone = hasQuiz && settled.length === quizQuestions.length;

  /**
   * 候補問題のレッスンは、この画面の「解く／作る」がそのまま技能の記録になる。
   *
   * 分けていたときは、ホームの「候補No.1を作る」を完了しても技能側に何も残らず、
   * 数週間後に「カリキュラムは完了、技能は0/13」になり得た。二重入力を求めない。
   */
  const isCandidate = lesson.practice.kind === 'candidate';
  const [candidateNo, setCandidateNo] = useState<number>(lesson.practice.candidateNo ?? 1);
  const [diagramMinutes, setDiagramMinutes] = useState('');
  const [workMinutes, setWorkMinutes] = useState('');
  const [completedWork, setCompletedWork] = useState(false);
  const [defectCodes, setDefectCodes] = useState<string[]>([]);
  const alreadyRecorded = snapshot.skillAttempts.some(
    (a) => a.lessonId === lesson.id && (a.kind ?? 'candidate') === 'candidate',
  );
  const candidateTotalMinutes = Number(workMinutes || 0) + Number(diagramMinutes || 0);

  /**
   * 学習時間は**段階ごとに**実測して、段階を保存するたびに記録する。
   *
   * 完了時に1件だけ記録していたときは、「今日は見るだけで終えてよい」と案内しながら
   * その日の時間がどこにも残らなかった。翌日以降に完了しても、記録されるのは
   * 最後に開いてからの時間だけ。基礎180分が実態より進まず、20問診断へ行けなくなる。
   * 見積(estimatedMinutes)をそのまま実績にしないという原則はそのまま。
   */
  const stepStartRef = useRef<number>(Date.now());
  const quizSaveRef = useRef<Promise<void>>(Promise.resolve());
  const [actualMinutes, setActualMinutes] = useState<string>('');

  const steps = requiredSteps(lesson);
  const upcoming = nextStep(lesson, progress);
  const complete = isLessonComplete(lesson, progress);
  const isUngradedFive = lesson.stage === 'ungraded-five';

  const measuredMinutes = () =>
    Math.max(1, Math.round((Date.now() - stepStartRef.current) / 60_000));

  // 段階が進んだら計測を切り直し、実測値を入れておく。本人はそのまま出すか直せる
  useEffect(() => {
    stepStartRef.current = Date.now();
    setActualMinutes('');
  }, [upcoming]);

  const quizDraftFrom = (nextPicks: Record<string, QuizPick>) =>
    quizQuestions.flatMap(({ question, choices }) => {
      const pick = nextPicks[question.id];
      const choice = pick ? choices[pick.choiceIndex] : undefined;
      return choice === undefined ? [] : [{ questionId: question.id, choice, sure: pick?.sure }];
    });

  const persistQuizDraft = async (nextPicks: Record<string, QuizPick>) => {
    const before = await repo.getLessonProgress(lesson.id);
    await repo.saveLessonProgress({
      ...(before ?? { lessonId: lesson.id, xpAwarded: 0, updatedAt: nowJstIso() }),
      mode,
      quizDraft: quizDraftFrom(nextPicks),
      updatedAt: nowJstIso(),
    });
  };

  const queueQuizDraft = (nextPicks: Record<string, QuizPick>) => {
    const pending = quizSaveRef.current.then(() => persistQuizDraft(nextPicks));
    // 1回失敗しても次の回答を保存できるよう、待ち行列自体は解決状態へ戻す。
    quizSaveRef.current = pending.catch(() => undefined);
    return pending;
  };

  const updateQuizPick = (questionId: string, pick: QuizPick) => {
    setPicks((prev) => {
      const next = { ...prev, [questionId]: pick };
      void queueQuizDraft(next);
      return next;
    });
  };

  const savePartialQuiz = async () => {
    setBusy(true);
    try {
      await quizSaveRef.current;
      await persistQuizDraft(picks);
      const measured = measuredMinutes();
      const confirmed = Number(actualMinutes);
      await repo.addSession({
        durationMinutes:
          Number.isFinite(confirmed) && confirmed > 0 ? confirmed : measured,
        measuredMinutes: measured,
        estimatedMinutes: stepMinutes(lesson, mode, 'practice'),
        kind: PRACTICE_TO_SESSION[lesson.practice.kind] ?? 'questions',
        lessonId: lesson.id,
        step: 'practice',
        countsAsBasics: countsAsBasics(lesson),
        nextFix: `クイズ ${settled.length}/${quizQuestions.length}問まで`,
      });
      stepStartRef.current = Date.now();
      setActualMinutes('');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  /**
   * 教材は「リンク+道案内」で1組。リンクだけ出すと、飛んだ先の何を見ればいいか
   * 分からずに終わる(実際に差し戻された)。use の順に並べ、まず開く1本を先頭に固定する。
   */
  const guides = useMemo(
    () =>
      [...lesson.resources]
        .sort((a, b) => USE_ORDER[a.use] - USE_ORDER[b.use])
        .map((ref) => ({ ref, resource: resolveResource(ref.resourceId) }))
        .filter((x) => x.resource !== undefined),
    [lesson.resources],
  );
  const firstGuide = guides.find((x) => x.ref.use === 'first') ?? guides[0];

  const commit = async (step: LessonStep) => {
    setBusy(true);
    try {
      if (hasQuiz && step === 'practice') {
        await quizSaveRef.current;
      }
      // 画面のスナップショットではなく保存済みの値から積む。
      // 続けて2段階を保存したとき、再読込が間に合わないと直前の段階が消える
      const before = await repo.getLessonProgress(lesson.id);
      const next = applyStep(lesson, before, step, {
        mode,
        recallAnswers: recall,
        recallSelfMarks: marks,
        practiceNote:
          emptyQuestionPool && practiceNote.trim() === ''
            ? 'リベンジ対象なし'
            : practiceNote,
        // アプリ内出題は自己申告ではなく採点結果をそのまま入れる
        practiceCorrect: hasQuiz
          ? quizCorrect
          : emptyQuestionPool
            ? 0
            : correct === '' ? undefined : Number(correct),
        practiceTotal: hasQuiz
          ? quizQuestions.length
          : emptyQuestionPool
            ? 0
          : total === ''
            ? undefined
            : Number(total),
        takeaway,
      });
      if (hasQuiz && step === 'practice') {
        next.quizDraft = undefined;
      }
      await repo.saveLessonProgress(next);

      // 1問ごとの記録は科目別成績と復習キューへ直結する。二重に積まないよう初回だけ
      if (hasQuiz && step === 'practice' && !stepDone(before, 'practice')) {
        await repo.recordQuiz(lesson.id, quizResults.map(toAttemptInput));
      }

      // その段階を**はじめて**終えたときに、その段階ぶんの時間を記録する。
      // 上書き保存では二重に記録しない。
      // XPと完了は4段階そろってから(AT-003)。時間の記録はそれとは別に、やった分だけ残す。
      // 候補問題は、この保存がそのまま技能の記録になる(13問到達・欠陥・時間に効く)
      if (isCandidate && step === 'practice' && !alreadyRecorded && Number(diagramMinutes) > 0 && Number(workMinutes) > 0) {
        await repo.addSkillAttempt({
          kind: 'candidate',
          candidateNo,
          lessonId: lesson.id,
          diagramMinutes: Number(diagramMinutes),
          workMinutes: Number(workMinutes),
          completed: completedWork,
          defectFree: completedWork && defectCodes.length === 0,
          defectCodes,
          photoIds: [],
          nextFix: practiceNote || undefined,
        });
      }

      if (!stepDone(before, step)) {
        const measured = measuredMinutes();
        const confirmed = Number(actualMinutes);
        await repo.addSession({
          // 本人が確認・修正した実績時間。未入力なら実測値。
          // 候補問題の施工は、画面の滞在時間ではなく複線図+施工の合計を実績とする
          durationMinutes:
            isCandidate && step === 'practice' && candidateTotalMinutes > 0
              ? candidateTotalMinutes
              : Number.isFinite(confirmed) && confirmed > 0
                ? confirmed
                : measured,
          measuredMinutes: measured,
          estimatedMinutes: stepMinutes(lesson, mode, step),
          kind: PRACTICE_TO_SESSION[lesson.practice.kind] ?? 'theory',
          lessonId: lesson.id,
          step,
          // オリエンテーション(§6 Step 1)と無採点5問(Step 2)は基礎学習(Step 3)ではない
          countsAsBasics: countsAsBasics(lesson),
          nextFix: step === 'takeaway' ? takeaway : undefined,
        });
      }

      if (!before?.completedAt && next.completedAt) {
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
      <div className="lesson-hero">
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
      </div>

      {lesson.safetyNote && <div className="notice notice--safety">{lesson.safetyNote}</div>}

      <div className="card">
        <div className="field">
          <label htmlFor="actual-minutes">
            このステップにかかった時間(分)
            {upcoming ? ` — ${STEP_LABEL[upcoming]}` : ''}
          </label>
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
              タイマーの時間を入れる
            </button>
          </div>
          <p className="muted">
            <strong>1ステップ終わるたびに、がんばった時間を残せる。</strong>
            今日は「まず見る」だけでもOK。そこまでの時間はちゃんと残る。空欄ならタイマーの時間を使うよ。
            目安は{upcoming ? stepMinutes(lesson, mode, upcoming) : 0}分。記録には実際にかかった時間が入る。
            {countsAsBasics(lesson)
              ? ' この時間は基礎トレ180分にもプラス！'
              : ' これは準備ステージ。基礎トレ180分のカウントは次から。'}
          </p>
        </div>
      </div>

      {/* --- 1. 見る --------------------------------------------------- */}
      <section className="card">
        <h2>1. まず見る</h2>
        {guides.length === 0 && (
          <p className="muted">
            直前期は新しい教材を増やさない。手元の材料と自分の記録だけで仕上げよう。
          </p>
        )}
        {firstGuide && guides.length > 1 && (
          <p className="notice">
            まず開くのは<strong>「{firstGuide.resource!.title}」の1本。</strong>
            問いの出どころが別なら、その問題の下にリンクを出すよ。
          </p>
        )}
        <ul className="plain stack">
          {guides.filter(({ ref }) => ref.use === 'first').map(({ ref, resource: r }) => (
            <li key={`${ref.resourceId}-${ref.use}`} className="resource-card resource-card--primary">
              <div className="resource-card__body">
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
                <span className={ref.use === 'first' ? 'badge badge--ok' : 'badge'}>
                  {USE_LABEL[ref.use]}
                </span>
              </div>
              <a className="resource-link" href={ref.openUrl ?? r!.url} target="_blank" rel="noreferrer">
                {r!.provider}｜{r!.title}
              </a>
              <dl className="guide">
                <dt>開く</dt>
                <dd>{ref.where}</dd>
                <dt>見る</dt>
                <dd>{ref.watch}</dd>
                <dt>止める</dt>
                <dd>{ref.stop}</dd>
              </dl>
              <div className="muted resource-meta">
                {r!.creatorKind ? CREATOR_LABEL[r!.creatorKind] : r!.role === 'official-check' ? '公式・官公庁' : '民間の解説'}
                {r!.creatorNote ? `(${r!.creatorNote})` : ''}
                {ref.minutes ? ` ・このレッスンでは約${ref.minutes}分` : ''}
                {r!.runtimeMinutes ? ` ・動画全体は${r!.runtimeMinutes}分` : ''}
                {' ・確認日 '}
                {r!.lastVerified}
                {r!.verification === 'requirements-doc' ? '(要件書記載。到達性は未検証)' : ''}
              </div>
              {r!.copyrightNote && <div className="muted">{r!.copyrightNote}</div>}
              {r!.note && <div className="muted">{r!.note}</div>}
              </div>
            </li>
          ))}
          {guides.some(({ ref }) => ref.use !== 'first') && (
            <li>
              <details className="supplemental-resources">
                <summary>ヘルプ教材を見る（{guides.filter(({ ref }) => ref.use !== 'first').length}件）</summary>
                <div className="supplemental-resources__body stack">
                  {guides.filter(({ ref }) => ref.use !== 'first').map(({ ref, resource: r }) => (
                    <div key={`${ref.resourceId}-${ref.use}`} className="resource-card">
                      <div className="resource-card__body">
                        <span className="badge">{USE_LABEL[ref.use]}</span>
                        <a className="resource-link" href={ref.openUrl ?? r!.url} target="_blank" rel="noreferrer">{r!.provider}｜{r!.title}</a>
                        <dl className="guide"><dt>開く</dt><dd>{ref.where}</dd><dt>見る</dt><dd>{ref.watch}</dd><dt>止める</dt><dd>{ref.stop}</dd></dl>
                        <div className="muted resource-meta">
                          {r!.creatorKind ? CREATOR_LABEL[r!.creatorKind] : r!.role === 'official-check' ? '公式・官公庁' : '民間の解説'}
                          {ref.minutes ? ` ・約${ref.minutes}分` : ''}{' ・確認日 '}{r!.lastVerified}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </li>
          )}
        </ul>
        <button
          className="btn-primary btn-block"
          disabled={busy || stepDone(progress, 'input')}
          onClick={() => commit('input')}
        >
          {stepDone(progress, 'input') ? '✓ 見終わった' : '見終わった！ 次へ'}
        </button>
        <p className="muted">いいスタート！ 次は、画面を閉じて思い出してみよう。</p>
      </section>

      {/* --- 2. 閉じて答える -------------------------------------------- */}
      <section className="card">
        <h2>2. 見ないで思い出す</h2>
        <p className="muted">
          問いの下に<strong>出どころ</strong>を出しているよ。必要なら先にそこだけ見て、
          教材を閉じてから思い出せたぶんを書こう。書いたら答え合わせ！
        </p>
        {lesson.recallPrompts.map((p, i) => {
          const guide = guides.find((g) => g.ref.resourceId === p.sourceResourceId);
          return (
            <div className="field recall-item" key={p.id}>
              <label htmlFor={p.id}>{p.prompt}</label>
              {guide && (
                <p className="muted recall-source">
                  出どころ:{' '}
                  <a href={guide.ref.openUrl ?? guide.resource!.url} target="_blank" rel="noreferrer">
                    {guide.resource!.provider}
                  </a>
                  ｜{p.sourceWatch}
                </p>
              )}
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
              {!revealed[i] ? (
                <button
                  type="button"
                  className="btn-sm"
                  disabled={(recall[i] ?? '').trim() === ''}
                  onClick={() =>
                    setRevealed((prev) => prev.map((v, j) => (j === i ? true : v)))
                  }
                >
                  答え合わせ
                </button>
              ) : (
                <div className="model-answer">
                  <strong>模範解答</strong>
                  <p>{p.modelAnswer}</p>
                  {p.acceptKeywords.length > 0 && (
                    <p className="muted">
                      この言葉が入っていればOK: {p.acceptKeywords.join(' / ')}
                    </p>
                  )}
                  <div className="row" role="group" aria-label="自己採点">
                    {(
                      [
                        ['ok', '言えた！'],
                        ['partial', 'ちょっと惜しい'],
                        ['miss', '出てこなかった'],
                      ] as [RecallMark, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={marks[i] === value ? 'btn-primary btn-sm' : 'btn-sm'}
                        aria-pressed={marks[i] === value}
                        onClick={() => setMarks((prev) => prev.map((m, j) => (j === i ? value : m)))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="muted">
                    自己採点は<strong>合格準備度には入らない</strong>。
                    「ちょっと惜しい」「出てこなかった」を選んだ項目は、次の自分へのひとことに残しておこう。
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {/*
          全部の問いに書いて、全部の答え合わせに○△×を付けてから保存する。
          1問に1文字書けば通れた頃は、模範解答を一度も見ずにステップを終えられた。
        */}
        <button
          className="btn-sm btn-block"
          disabled={
            busy ||
            recall.some((r) => r.trim() === '') ||
            marks.some((m) => m === undefined)
          }
          onClick={() => commit('recall')}
        >
          {stepDone(progress, 'recall') ? '✓ ここまで保存済み' : 'ここまでを保存'}
        </button>
        {(recall.some((r) => r.trim() === '') || marks.some((m) => m === undefined)) && (
          <p className="muted">
            全部の問いに書いて、<strong>答え合わせ</strong>まで進むと保存できるよ。
            うろ覚えでも書いてOK。模範解答を見て「出てこなかった」を押すのも立派な1手。
          </p>
        )}
      </section>

      {/* --- 3. 解く／作る ---------------------------------------------- */}
      <section className="card">
        <h2>3. 手を動かす</h2>
        <p>
          {lesson.practice.instruction.replace('今日見た内容だけから出るよ', '出どころは各問題の下に表示するよ')}
        </p>
        {lesson.practice.where && (
          <p className="muted">
            <strong>今日やる場所:</strong> {lesson.practice.where}
          </p>
        )}
        {lesson.practice.resourceIds?.map((id) => {
          const r = resolveResource(id);
          return r ? (
            <p key={id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.provider}｜{r.title}を開く
              </a>
            </p>
          ) : null;
        })}
        {!lesson.practice.scored && !hasQuiz && (
          <p className="notice">
            {isUngradedFive
              ? 'ここはウォーミングアップ。点数は気にせず、知らない言葉を拾えたらクリア！'
              : 'ここは練習タイム。点数は気にしなくてOK。'}
          </p>
        )}

        {/* アプリ内出題。別教材由来の問題には、その場で出どころを表示する */}
        {hasQuiz && (
          <div className="quiz stack">
            <p className="notice">
              {lesson.practice.questionPool
                ? '前に落とした問題から出るよ。1問ずつ答えて、解説まで読もう。'
                : '1問ずつ答えて、解説とその問題の出どころまで確認しよう。'}
              {' '}結果は<strong>科目別の成績と復習リストに自動で入る</strong>。
            </p>
            <p className="badge">
              {settled.length} / {quizQuestions.length} 問 ・ 正解 {quizCorrect}
            </p>
            {quizQuestions.map((presented, qi) => {
              const qq = presented.question;
              const pick = picks[qq.id];
              const chosen = pick?.choiceIndex;
              const answered = chosen !== undefined;
              const right = chosen === presented.answerIndex;
              const source = resolveResource(qq.sourceResourceId);
              return (
                <div className="quiz-item" key={qq.id}>
                  <p className="quiz-stem">
                    <strong>Q{qi + 1}.</strong> {qq.stem}
                  </p>
                  <ul className="plain stack quiz-choices">
                    {presented.choices.map((choice, ci) => (
                      <li key={ci}>
                        <button
                          type="button"
                          className={[
                            'btn-sm btn-block quiz-choice',
                            answered && ci === presented.answerIndex ? 'quiz-choice--right' : '',
                            answered && ci === chosen && !right ? 'quiz-choice--wrong' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          disabled={answered}
                          aria-pressed={ci === chosen}
                          onClick={() => updateQuizPick(qq.id, { choiceIndex: ci })}
                        >
                          {/* 色だけで正解を示さない。答えたあとは記号でも分かるようにする */}
                          {answered && ci === presented.answerIndex ? '✓ ' : ''}
                          {['ア', 'イ', 'ウ', 'エ'][ci] ?? ci + 1}. {choice}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {answered && (
                    <div className={right ? 'quiz-feedback quiz-feedback--ok' : 'quiz-feedback'}>
                      <strong>{right ? '正解！' : 'おしい！ ✓が正解'}</strong>
                      <p>{qq.explanation}</p>
                      {source && (
                        <p className="muted">
                          出どころ: {source.provider}｜{qq.sourceWatch}
                        </p>
                      )}
                      {pick?.sure === undefined ? (
                        right ? (
                          <div className="row">
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => updateQuizPick(qq.id, { choiceIndex: chosen, sure: true })}
                            >
                              バッチリだった
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              onClick={() => updateQuizPick(qq.id, { choiceIndex: chosen, sure: false })}
                            >
                              あやふやだった
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-sm"
                            onClick={() => updateQuizPick(qq.id, { choiceIndex: chosen, sure: false })}
                          >
                            リベンジ登録して次へ
                          </button>
                        )
                      ) : (
                        <p className="muted">
                          {pick.sure
                            ? '✓ 記録した。この問題はしばらく出てこないよ'
                            : '✓ 記録した。この問題はまた戻ってくるよ'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!quizDone && (
              <p className="muted">
                全部の問題で「バッチリ／あやふや」まで選ぶと保存できるよ。
                <strong>あやふやを正直に押すほど、復習が効く。</strong>
              </p>
            )}
            {settled.length > 0 && !quizDone && (
              <button
                type="button"
                className="btn-sm btn-block"
                disabled={busy}
                onClick={savePartialQuiz}
              >
                ここまで保存（{settled.length}/{quizQuestions.length}問）
              </button>
            )}
            <p className="muted">回答は1問ごとに自動保存。閉じても続きから戻れるよ。</p>
          </div>
        )}

        {/*
          記録から選ぶ出題(誤答潰し)が0件になったとき、黙って自己申告欄へ落とさない。
          誤答がなくて空なのか、選び方の不具合で空なのかが本人に分からなくなる。
        */}
        {lesson.practice.questionPool && !hasQuiz && (
          <p className="notice notice--safety">
            リベンジ問題は0件！ このステップはそのままクリアできるよ。
            {lesson.practice.questionPool === 'mistakes'
              ? ' 間違いがまだ無いか、全部リベンジ済み。次のクエストへ進もう。'
              : ' 科目別の記録がまだ足りないときは、学科タブの「腕だめし」で各科目へ着手しよう。'}
          </p>
        )}
        {lesson.practice.scored && !hasQuiz && !lesson.practice.questionPool && (
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
        {isCandidate && (
          <div className="stack">
            <p className="notice">
              ここで保存すれば、<strong>技能の記録にも自動で入る</strong>。
              二重入力なし！ 13問・欠陥・時間のチェックもこの記録で進む。
            </p>
            {lesson.practice.candidateNo === undefined && (
              <div className="field">
                <label htmlFor="candidate-no">挑戦した候補問題</label>
                <select
                  id="candidate-no"
                  value={candidateNo}
                  onChange={(e) => setCandidateNo(Number(e.target.value))}
                >
                  {CANDIDATE_NUMBERS.map((n) => (
                    <option key={n} value={n}>
                      候補No.{n}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="row">
              <div style={{ flex: 1 }}>
                <label htmlFor="diagram-minutes">複線図(分)</label>
                <input
                  id="diagram-minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={diagramMinutes}
                  onChange={(e) => setDiagramMinutes(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="work-minutes">施工(分)</label>
                <input
                  id="work-minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  required
                  value={workMinutes}
                  onChange={(e) => setWorkMinutes(e.target.value)}
                />
              </div>
            </div>
            {candidateTotalMinutes > 0 && (
              <p className={candidateTotalMinutes <= TARGET_MINUTES ? 'badge badge--ok' : 'badge badge--warn'}>
                合計 {candidateTotalMinutes} 分(本番{EXAM_MINUTES}分・練習の目標{TARGET_MINUTES}分)
              </p>
            )}
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto', minHeight: 'auto' }}
                checked={completedWork}
                onChange={(e) => setCompletedWork(e.target.checked)}
              />
              <span>時間内に完成！</span>
            </label>
            <div>
              <strong>欠陥チェック（公式基準）</strong>
              <p className="muted">見つかった項目だけチェック。ゼロを目指そう。</p>
              {skillDefects.map((d) => (
                <label className="row" key={d.code} style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', minHeight: 'auto' }}
                    checked={defectCodes.includes(d.code)}
                    onChange={(e) =>
                      setDefectCodes((c) =>
                        e.target.checked ? [...c, d.code] : c.filter((x) => x !== d.code),
                      )
                    }
                  />
                  <span style={{ fontSize: '0.85rem' }}>{d.label}</span>
                </label>
              ))}
            </div>
            {alreadyRecorded && (
              <p className="muted">このレッスンの技能記録は保存済み！ もう一度挑戦するときは技能タブへ。</p>
            )}
          </div>
        )}
        {isUngradedFive && (
          <div className="field">
            <label>今日見つけた新しい言葉(最大3つ)</label>
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
          <label htmlFor="practiceNote">今日やったこと</label>
          <textarea
            id="practiceNote"
            value={practiceNote}
            onChange={(e) => setPracticeNote(e.target.value)}
          />
        </div>
        <button
          className="btn-sm btn-block"
          disabled={
            busy ||
            // 本番40分には複線図も含む。両方の時間がない記録を合格判定へ入れない
            (isCandidate && !alreadyRecorded && (!(Number(diagramMinutes) > 0) || !(Number(workMinutes) > 0))) ||
            // アプリ内出題は解ききってから保存する。途中の点を成績へ入れない
            (hasQuiz && !quizDone) ||
            (hasQuiz
              ? false
              : emptyQuestionPool
                ? false
              : lesson.practice.scored
                ? total.trim() === ''
                : practiceNote.trim() === '')
          }
          onClick={() => commit('practice')}
        >
          {stepDone(progress, 'practice')
            ? '✓ 結果は保存済み'
            : hasQuiz
              ? `結果を残す（${quizCorrect}/${quizQuestions.length}）`
              : emptyQuestionPool
                ? 'リベンジなしでクリア！'
              : '結果を残す'}
        </button>
        {isCandidate && !alreadyRecorded && (!(Number(diagramMinutes) > 0) || !(Number(workMinutes) > 0)) && (
          <p className="muted">複線図と施工、両方の時間を入れたら保存できるよ。</p>
        )}
      </section>

      {/* --- 4. 1点残す ------------------------------------------------- */}
      <section className="card">
        <h2>4. 次の自分にひとこと</h2>
        <p className="muted">次に直したいことを1つだけ。短くてOK！</p>
        <textarea
          aria-label="次の自分へのひとこと"
          value={takeaway}
          onChange={(e) => setTakeaway(e.target.value)}
        />
        <button
          className="btn-primary btn-block"
          disabled={busy || takeaway.trim() === ''}
          onClick={() => commit('takeaway')}
        >
          {stepDone(progress, 'takeaway') ? '✓ クリア済み' : '保存してクリア！'}
        </button>
      </section>

      {complete ? (
        <div className="card card--accent">
          <strong>クエストクリア！ XP +{xpForLesson(lesson)}</strong>
          <p className="muted">
            4ステップ達成！ 今日の積み上げは{' '}
            {snapshot.studySessions
              .filter((s) => s.lessonId === lesson.id)
              .reduce((n, s) => n + s.durationMinutes, 0)}{' '}
            分。ナイスチャレンジ！
          </p>
          <button className="btn-block" onClick={onClose}>
            次のクエストを見る
          </button>
        </div>
      ) : (
        <p className="muted">
          あとこれだけ: {steps.filter((s) => !stepDone(progress, s)).map((s) => STEP_LABEL[s]).join(' → ')}
        </p>
      )}
    </main>
  );
}
