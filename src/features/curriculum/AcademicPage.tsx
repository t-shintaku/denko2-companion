import { useRef, useState } from 'react';
import { curriculum, getQuestion, resources, topicName, topics } from '../../data';
import { repo } from '../../db/repo';
import {
  ERROR_REASON_LABEL,
  OFFICIAL_PASS_SCORE,
  RECENT_WINDOW,
  REVIEW_REASON_LABEL,
  TARGET_AVERAGE_SCORE,
  TOPIC_MIN_SAMPLE,
  excludedMocks,
  mocks,
  recentAverageScore,
  scoreOf,
} from '../../domain/academic';
import { mockTrend, reviewProgress, topicMoves } from '../../domain/growth';
import { topicIds } from '../../data';
import { formatJstShort } from '../../domain/jst';
import { completionRatio, isLessonComplete, modeForBudget } from '../../domain/lessons';
import { STAGE_LABEL } from '../../domain/onboarding';
import { useVault } from '../../state/VaultContext';
import { ExamSheet } from '../academic/ExamSheet';
import { presentQuestion, type PresentedQuestion } from '../../domain/quiz';
import type { ExamKind, LessonMode, QuizQuestion } from '../../domain/types';

export function AcademicPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const {
    snapshot,
    schedule,
    onboarding,
    topicStats,
    academicGate,
    reviewQueue,
    topicCoverage,
    overallCoverage,
    coverageGaps,
    recallGaps,
    reload,
  } = useVault();
  const [sheet, setSheet] = useState<{ kind: ExamKind; count: number } | undefined>();
  const [showCurriculum, setShowCurriculum] = useState(false);
  /** リベンジ問題で選んだ選択肢。attempt.id → 選んだ番号 */
  const [retry, setRetry] = useState<Record<string, number>>({});
  /**
   * リベンジ問題も選択肢を並べ替える。並べ替えないと、
   * 「前に選んだのはこの位置だったから違うほう」で正解できてしまう。
   * 一度組んだ並びは保持する(答えている途中で動かさない)。
   */
  const presentedRetry = useRef(new Map<string, PresentedQuestion>());
  const presentFor = (attemptId: string, question: QuizQuestion) => {
    const cached = presentedRetry.current.get(attemptId);
    if (cached) return cached;
    const next = presentQuestion(question);
    presentedRetry.current.set(attemptId, next);
    return next;
  };

  if (sheet) {
    return <ExamSheet kind={sheet.kind} count={sheet.count} onClose={() => setSheet(undefined)} />;
  }

  const stageRank: Record<string, number> = {
    orientation: 0,
    'ungraded-five': 1,
    basics: 2,
    diagnostic: 3,
    regular: 4,
  };
  const currentRank = stageRank[onboarding.stage] ?? 4;
  const mockList = mocks(snapshot.mockExams);
  const avg = recentAverageScore(snapshot.mockExams, 3);
  const excluded = excludedMocks(snapshot.mockExams);
  const trend = mockTrend(snapshot.mockExams);
  const moves = topicMoves(snapshot.questionAttempts, topicIds);
  const review = reviewProgress(snapshot.questionAttempts);

  return (
    <main className="app">
      <h1>学科クエスト</h1>

      {/* 20問診断は、基礎180分に達するまで前面に出さない(FR-003) */}
      {onboarding.stage === 'diagnostic' && !onboarding.diagnosticDone && (
        <div className="card card--accent">
          <strong>20問診断、アンロック！</strong>
          <p className="muted">
            基礎トレ {onboarding.basicsMinutes} 分クリア。ここから7科目の攻略スタート！
            公式過去問から20問選んで、いまの実力を見てみよう。
          </p>
          <button
            className="btn-primary btn-block"
            onClick={() => setSheet({ kind: 'diagnostic-20', count: 20 })}
          >
            20問に挑戦する
          </button>
        </div>
      )}
      {onboarding.stage !== 'diagnostic' && !onboarding.diagnosticDone && (
        <div className="card">
          <strong>20問診断まで、あと少し！</strong>
          <p className="muted">
            いまは{STAGE_LABEL[onboarding.stage]}。電気の地図 → お試し5問 → 基礎トレ
            {onboarding.basicsRequiredMinutes}分でアンロック（いま{' '}
            {onboarding.basicsMinutes}分）。
          </p>
        </div>
      )}

      <h2>7科目</h2>
      <div className="card scroll-x">
        <table>
          <thead>
            <tr>
              <th>科目</th>
              <th>累計</th>
              <th>累計正答率</th>
              <th>直近{RECENT_WINDOW}問(判定はこちら)</th>
              <th>最終</th>
            </tr>
          </thead>
          <tbody>
            {topicStats.map((s) => (
              <tr key={s.topicId}>
                <td>{topicName(s.topicId)}</td>
                <td>{s.total}問</td>
                <td>
                  {s.accuracy === undefined
                    ? '—'
                    : `${Math.round(s.accuracy * 100)}%`}
                </td>
                <td>
                  {s.recentAccuracy === undefined
                    ? '—'
                    : `${Math.round(s.recentAccuracy * 100)}%`}
                  {s.started && !s.hasSample && (
                    <span className="muted"> (判定に直近{TOPIC_MIN_SAMPLE}問必要)</span>
                  )}
                  {s.started && s.hasSample && !s.meetsMinimum && (
                    <span className="badge badge--warn"> 未達</span>
                  )}
                  {(() => {
                    const move = moves.find((m) => m.topicId === s.topicId);
                    if (!move || Math.abs(move.delta) < 0.05) return null;
                    return (
                      <span className={move.delta > 0 ? 'badge badge--ok' : 'badge badge--warn'}>
                        {move.delta > 0 ? '↑' : '↓'}
                        {Math.abs(Math.round(move.delta * 100))}pt
                      </span>
                    );
                  })()}
                </td>
                <td>{s.lastAttemptedOn ? formatJstShort(s.lastAttemptedOn) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>出題範囲マップ</h2>
      <div className="card">
        <p className="muted">
          <strong>「レッスンを何本やったか」ではなく「試験に出る項目を何個押さえたか」。</strong>
          1項目は<strong>レッスンを完了</strong>して、その項目の問題に<strong>必要数だけ正解</strong>したら埋まる
          (本番で1問以上出る重さの項目は2問、それ未満は1問)。
          学科50問の重みで数えているから、配線図(20問ぶん)が空だと数字は伸びないよ。
        </p>
        <p className="badge badge--ok">
          範囲カバー {Math.round(overallCoverage * 100)}%
        </p>
        {/*
          アプリ内の配線図問題は、記号の「意味」を言葉で問う形。
          記号の「形」を見て答える鑑別は写真が要るので、HOZANの一問一答が担当する。
          ここを書かないと、100%が「配線図が読める」と誤読される。
        */}
        <p className="notice">
          <strong>配線図だけは、この数字だけで安心しない。</strong>
          アプリ内は記号の意味を言葉で問う形。記号や器具の<strong>「形」を見て答える鑑別</strong>は、
          配線図記号レッスンから飛ぶHOZANの一問一答でやろう。本番の配線図20問はそこが効く。
        </p>
        <div style={{ marginTop: 10 }}>
          {topicCoverage.map((c) => (
            <div className="coverage-row" key={c.topicId}>
              <span className="coverage-row__name">
                {topicName(c.topicId)}
                <span className="muted">
                  {' '}
                  ({c.confirmedCount}/{c.items.length}項目・本番{Math.round(c.weight)}問ぶん)
                </span>
              </span>
              <span className="coverage-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(c.ratio * 100)}%` }} />
              </span>
              <span className="coverage-row__value">{Math.round(c.ratio * 100)}%</span>
            </div>
          ))}
        </div>
        {coverageGaps.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <strong>次に埋める穴</strong>
            <ul className="plain stack" style={{ marginTop: 6 }}>
              {coverageGaps.map((g) => (
                <li key={g.item.id} className="muted">
                  {topicName(g.item.topicId)}｜{g.item.name} —{' '}
                  {g.taught && !g.confirmed
                    ? `レッスンは終わってる。あと${g.requiredCorrect - g.correct}問正解すれば埋まる！`
                    : 'まだレッスンが残ってる'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h2>言い直しリスト</h2>
      <div className="card">
        {recallGaps.length === 0 ? (
          <p className="muted">
            いまは言い直し待ちなし！ レッスンの「見ないで思い出す」で
            「ちょっと惜しい」「出てこなかった」を選んだ項目がここに集まるよ。
          </p>
        ) : (
          <>
            <p className="muted">
              自分で「言えなかった」と付けた項目。
              <strong>合格準備度には入らない</strong>けど、口に出して言えるまで戻ってくる。
              1日1つ、声に出して言い直すだけでいい。
            </p>
            <ul className="plain stack">
              {recallGaps.map((g) => (
                <li key={`${g.lessonId}-${g.promptId}`} style={{ marginBottom: 12 }}>
                  <span className={g.mark === 'miss' ? 'badge badge--warn' : 'badge'}>
                    {g.mark === 'miss' ? '出てこなかった' : 'ちょっと惜しい'}
                  </span>{' '}
                  <strong>{g.prompt}</strong>
                  <details className="supplemental-resources">
                    <summary>模範解答を見る</summary>
                    <div className="supplemental-resources__body">
                      <p>{g.modelAnswer}</p>
                      <p className="muted">
                        {g.lessonTitle} ・{formatJstShort(g.at.slice(0, 10))}
                      </p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <h2>リベンジ問題</h2>
      <div className="card">
        {reviewQueue.length === 0 ? (
          <p className="muted">
            いまはリベンジ問題なし！ 間違えた問題や、あやふやな正解がここに入るよ。
          </p>
        ) : (
          <>
            <p className="muted">
              「たまたま正解」も、次は自力で解けるようにリベンジ。
              クリアするたび翌日 → 3日後 → 7日後 → 14日後と間隔が広がる。
              最後の14日後をクリアしたら卒業！ 途中で落としたら翌日からやり直し。
            </p>
            <ul className="plain stack">
              {reviewQueue.slice(0, 10).map((item) => {
                // アプリ内出題は questionRef が問題ID。問題そのものを出し直せる
                const question = getQuestion(item.attempt.questionRef);
                const shown = question ? presentFor(item.attempt.id, question) : undefined;
                const picked = retry[item.attempt.id];
                return (
                <li key={item.attempt.id} className="stack" style={{ marginBottom: 12 }}>
                  <span>
                    {topicName(item.attempt.topicId)} —{' '}
                    {question?.stem ?? item.attempt.questionRef}
                    <br />
                    <span className="muted">
                      {REVIEW_REASON_LABEL[item.reason]}
                      {item.attempt.errorReason
                        ? ` / ${ERROR_REASON_LABEL[item.attempt.errorReason]}`
                        : ''}
                      {` / ${formatJstShort(item.attempt.jstDate)}`}
                      {item.attempt.reviewCount
                        ? ` / 解き直し${item.attempt.reviewCount}回目まで通過`
                        : ''}
                    </span>
                  </span>
                  {/*
                    アプリ内出題は、その場で解き直させる。自己申告の「クリア」だけだと
                    解けたかどうかを本人の気分が決めてしまい、間隔反復が意味を失う。
                    外部教材(過去問)の記録は問題文を持っていないので、従来どおり自己申告。
                  */}
                  {question && shown ? (
                    <div className="quiz-item">
                      <ul className="plain stack quiz-choices">
                        {shown.choices.map((choice, ci) => (
                          <li key={ci}>
                            <button
                              type="button"
                              className={[
                                'btn-sm btn-block quiz-choice',
                                picked !== undefined && ci === shown.answerIndex
                                  ? 'quiz-choice--right'
                                  : '',
                                picked === ci && ci !== shown.answerIndex
                                  ? 'quiz-choice--wrong'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              disabled={picked !== undefined}
                              onClick={async () => {
                                setRetry((prev) => ({ ...prev, [item.attempt.id]: ci }));
                                await repo.markReviewed(
                                  [item.attempt.id],
                                  ci === shown.answerIndex,
                                );
                                await reload();
                              }}
                            >
                              {picked !== undefined && ci === shown.answerIndex ? '✓ ' : ''}
                              {['ア', 'イ', 'ウ', 'エ'][ci] ?? ci + 1}. {choice}
                            </button>
                          </li>
                        ))}
                      </ul>
                      {picked !== undefined && (
                        <div
                          className={
                            picked === shown.answerIndex
                              ? 'quiz-feedback quiz-feedback--ok'
                              : 'quiz-feedback'
                          }
                        >
                          <strong>
                            {picked === shown.answerIndex
                              ? 'リベンジ成功！ 次は間隔をあけて戻ってくるよ'
                              : 'おしい！ ✓が正解。明日もう一回'}
                          </strong>
                          <p>{question.explanation}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="row">
                      <button
                        className="btn-primary btn-sm"
                        onClick={async () => {
                          await repo.markReviewed([item.attempt.id], true);
                          await reload();
                        }}
                      >
                        ✓ クリア！
                      </button>
                      <button
                        className="btn-sm"
                        onClick={async () => {
                          await repo.markReviewed([item.attempt.id], false);
                          await reload();
                        }}
                      >
                        ↻ もう一回（明日リトライ）
                      </button>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
            {reviewQueue.length > 10 && (
              <p className="muted">ほか {reviewQueue.length - 10} 件</p>
            )}
          </>
        )}
      </div>

      <h2>腕だめし</h2>
      <div className="card">
        <div className="stack">
          <button className="btn-sm btn-block" onClick={() => setSheet({ kind: 'topic-quiz', count: 10 })}>
            10問チャレンジ
          </button>
          <button className="btn-sm btn-block" onClick={() => setSheet({ kind: 'topic-quiz', count: 20 })}>
            週末20問チェック
          </button>
          <button className="btn-primary btn-block" onClick={() => setSheet({ kind: 'mock-50', count: 50 })}>
            50問模試に挑戦
          </button>
        </div>
        <p className="muted">
          公式基準は{OFFICIAL_PASS_SCORE}点(50問中30問)。本ツールの運用目標は直近3回平均
          {TARGET_AVERAGE_SCORE}点。60点は公式、80点は自分向け。
        </p>
      </div>

      {excluded.length > 0 && (
        <p className="notice">
          {excluded.length}件は集計の対象外（50問でない、または入力値が範囲外）。
          合格ラインを正しく見るため、条件を満たした模試だけで計算しているよ。
        </p>
      )}

      {mockList.length > 0 && (
        <div className="card">
          <div className="row row--between">
            <strong>模試の推移</strong>
            {avg !== undefined && <span className="badge">直近3回平均 {avg.toFixed(1)}点</span>}
          </div>
          <p className="muted">
            {trend.latest !== undefined && `最新 ${trend.latest}点`}
            {trend.delta !== undefined && (
              <span className={trend.delta >= 0 ? 'badge badge--ok' : 'badge badge--warn'}>
                {trend.delta >= 0 ? `前回より+${trend.delta}点` : `前回より${trend.delta}点`}
              </span>
            )}
            {trend.best !== undefined && ` / 自己最高 ${trend.best}点`}
          </p>
          {review.solved > 0 && (
            <p className="muted">
              復習で解き直して解けた問題: <strong>{review.solved}</strong> 問
              {review.graduated > 0 && `(うち${review.graduated}問は間隔をすべて通過して卒業)`}
              {review.pending > 0 && ` / 残り ${review.pending} 問`}
            </p>
          )}
          <ul className="plain">
            {[...mockList].reverse().map((e) => (
              <li key={e.id} className="row row--between">
                <span>
                  {formatJstShort(e.jstDate)} {e.label}
                  {e.timed && <span className="badge"> 120分</span>}
                </span>
                <strong>
                  {scoreOf(e)}点
                  <span className="muted">
                    {' '}
                    ({e.correctCount}/{e.totalQuestions})
                  </span>
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>学科クリアへの5ミッション</h2>
      <div className="card">
        <p className="muted">
          合格の準備は、5つのミッションでチェック。
          いま {academicGate.passedCount} / {academicGate.total} クリア！
        </p>
        <ul className="plain stack">
          {academicGate.criteria.map((c) => (
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

      <h2>レッスン一覧</h2>
      <button className="btn-sm btn-block" onClick={() => setShowCurriculum((v) => !v)}>
        {showCurriculum ? '閉じる' : `全${curriculum.lessons.length}レッスンを表示`}
      </button>
      {showCurriculum &&
        curriculum.phases.map((phase) => {
          const lessons = curriculum.lessons
            .filter((l) => l.phaseId === phase.id)
            .sort((a, b) => a.order - b.order);
          return (
            <section key={phase.id}>
              <h3>{phase.title}</h3>
              <p className="muted">{phase.goal}</p>
              {lessons.map((lesson) => {
                const progress = snapshot.lessonProgress[lesson.id];
                const done = isLessonComplete(lesson, progress);
                const date = schedule.byLessonId[lesson.id];
                const locked = (stageRank[lesson.stage] ?? 4) > currentRank;
                return (
                  <div className="card" key={lesson.id}>
                    <div className="row row--between">
                      <strong>{lesson.title}</strong>
                      <span className={done ? 'badge badge--ok' : 'badge'}>
                        {done ? 'クリア' : `${Math.round(completionRatio(lesson, progress) * 100)}%`}
                      </span>
                    </div>
                    <p className="muted">{lesson.objective}</p>
                    <div className="row row--between">
                      <span className="muted">
                        {date ? `予定 ${formatJstShort(date)}` : '未配置'} ・
                        {lesson.required ? ' 必須' : ' 任意'}
                        {lesson.skillTouch ? ' ・技能接触' : ''}
                      </span>
                      {locked ? (
                        <span className="badge">{STAGE_LABEL[lesson.stage]}でアンロック</span>
                      ) : (
                        <button
                          className="btn-sm"
                          onClick={() => onOpenLesson(lesson.id, modeForBudget(30))}
                        >
                          {done ? 'もう一度' : '挑戦する'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}

      <h2>公式資料</h2>
      <ul className="plain stack">
        {resources
          .filter((r) => r.role === 'official-check')
          .map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.title}
              </a>
              <div className="muted">
                {r.provider} ・確認日 {r.lastVerified}
                {r.verification === 'requirements-doc' && '(要件書記載。到達性は未検証)'}
              </div>
            </li>
          ))}
      </ul>
      <p className="muted">
        科目は公式7分類({topics.map((t) => t.shortName).join('・')})。
      </p>
    </main>
  );
}
