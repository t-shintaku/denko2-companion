import { useState } from 'react';
import { curriculum, resources, topicName, topics } from '../../data';
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
import type { ExamKind, LessonMode } from '../../domain/types';

export function AcademicPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const { snapshot, schedule, onboarding, topicStats, academicGate, reviewQueue, reload } = useVault();
  const [sheet, setSheet] = useState<{ kind: ExamKind; count: number } | undefined>();
  const [showCurriculum, setShowCurriculum] = useState(false);

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
      <h1>学科</h1>

      {/* 20問診断は、基礎180分に達するまで前面に出さない(FR-003) */}
      {onboarding.stage === 'diagnostic' && !onboarding.diagnosticDone && (
        <div className="card card--accent">
          <strong>20問診断を受けられる</strong>
          <p className="muted">
            基礎 {onboarding.basicsMinutes} 分を積んだ。ここで7科目の初期値を取る。
            公式の過去問から20問を選んで解き、結果を入れる。
          </p>
          <button
            className="btn-primary btn-block"
            onClick={() => setSheet({ kind: 'diagnostic-20', count: 20 })}
          >
            20問診断を記録する
          </button>
        </div>
      )}
      {onboarding.stage !== 'diagnostic' && !onboarding.diagnosticDone && (
        <div className="card">
          <strong>20問診断はまだ開いていない</strong>
          <p className="muted">
            {STAGE_LABEL[onboarding.stage]}の段階。オリエンテーション → 採点なし5問 → 基礎
            {onboarding.basicsRequiredMinutes}分 の順に進むと開く(いまの基礎:{' '}
            {onboarding.basicsMinutes}分)。
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

      <h2>復習キュー</h2>
      <div className="card">
        {reviewQueue.length === 0 ? (
          <p className="muted">
            いまは空。誤答・自信の低い正解・放置している弱点がここに溜まる。
          </p>
        ) : (
          <>
            <p className="muted">
              誤答だけでなく「自信の低い正解」も同じ重みで入れている。まぐれ当たりは次に落ちる。
              解けたら翌日 → 3日後 → 7日後 → 14日後と間隔を空けて戻ってくる。
              4つの間隔をすべて解けたら卒業。解けなければ翌日また出る。
            </p>
            <ul className="plain stack">
              {reviewQueue.slice(0, 10).map((item) => (
                <li key={item.attempt.id} className="stack" style={{ marginBottom: 12 }}>
                  <span>
                    {topicName(item.attempt.topicId)} — {item.attempt.questionRef}
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
                  <div className="row">
                    <button
                      className="btn-primary btn-sm"
                      onClick={async () => {
                        await repo.markReviewed([item.attempt.id], true);
                        await reload();
                      }}
                    >
                      ○ 解けた
                    </button>
                    <button
                      className="btn-sm"
                      onClick={async () => {
                        await repo.markReviewed([item.attempt.id], false);
                        await reload();
                      }}
                    >
                      × まだ(明日また出す)
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {reviewQueue.length > 10 && (
              <p className="muted">ほか {reviewQueue.length - 10} 件</p>
            )}
          </>
        )}
      </div>

      <h2>小テスト・模試</h2>
      <div className="card">
        <div className="stack">
          <button className="btn-sm btn-block" onClick={() => setSheet({ kind: 'topic-quiz', count: 10 })}>
            カテゴリ小テスト(10問)を記録
          </button>
          <button className="btn-sm btn-block" onClick={() => setSheet({ kind: 'topic-quiz', count: 20 })}>
            週末チェック(20問)を記録
          </button>
          <button className="btn-primary btn-block" onClick={() => setSheet({ kind: 'mock-50', count: 50 })}>
            50問模試を記録
          </button>
        </div>
        <p className="muted">
          公式基準は{OFFICIAL_PASS_SCORE}点(50問中30問)。本ツールの運用目標は直近3回平均
          {TARGET_AVERAGE_SCORE}点。60点は公式、80点は自分向け。
        </p>
      </div>

      {excluded.length > 0 && (
        <p className="notice">
          {excluded.length}件の模試を集計から外している(50問でない、または正答数が0〜問題数の範囲外)。
          点数の水増しは受験の判断をそのまま誤らせるので、集計側でも弾いている。
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

      <h2>学科ゲート</h2>
      <div className="card">
        <p className="muted">
          総合パーセントは出さない。5つの条件を1つずつ満たす。
          いま {academicGate.passedCount} / {academicGate.total}。
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

      <h2>カリキュラム</h2>
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
                        {done ? '完了' : `${Math.round(completionRatio(lesson, progress) * 100)}%`}
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
                        <span className="badge">{STAGE_LABEL[lesson.stage]}まで待つ</span>
                      ) : (
                        <button
                          className="btn-sm"
                          onClick={() => onOpenLesson(lesson.id, modeForBudget(30))}
                        >
                          {done ? '見直す' : '開く'}
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
