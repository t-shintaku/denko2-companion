import { getLesson, topicIds, topicName } from '../../data';
import {
  comebackCount,
  estimateAccuracy,
  mockTrend,
  reviewProgress,
  skillTrend,
  topicMoves,
  weekSummary,
} from '../../domain/growth';
import { formatJstShort } from '../../domain/jst';
import { useVault } from '../../state/VaultContext';
import type { SessionKind } from '../../domain/types';

const KIND_LABEL: Record<SessionKind, string> = {
  theory: '学科インプット',
  questions: '問題',
  'wiring-diagram': '複線図',
  'basic-skill': '基本作業',
  candidate: '候補問題',
  mock: '模試',
  review: 'レビュー',
};

export function RecordsPage() {
  const { snapshot, today } = useVault();
  const sessions = [...snapshot.studySessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const totalMinutes = sessions.reduce((s, x) => s + x.durationMinutes, 0);
  const xp = Object.values(snapshot.lessonProgress).reduce((s, p) => s + p.xpAwarded, 0);
  const completed = Object.values(snapshot.lessonProgress).filter((p) => p.completedAt).length;
  const days = new Set(sessions.map((s) => s.jstDate));

  const week = weekSummary(snapshot.studySessions, today);
  const comebacks = comebackCount(snapshot.studySessions);
  const trend = mockTrend(snapshot.mockExams);
  const review = reviewProgress(snapshot.questionAttempts);
  const skill = skillTrend(snapshot.skillAttempts);
  const estimate = estimateAccuracy(snapshot.studySessions);
  const moves = topicMoves(snapshot.questionAttempts, topicIds);

  return (
    <main className="app">
      <h1>記録</h1>

      <div className="card">
        <ul className="plain">
          <li>完了レッスン: {completed} 本</li>
          <li>学習時間: 合計 {totalMinutes} 分</li>
          <li>学習した日: {days.size} 日</li>
          <li>XP: {xp}(動画を見ただけでは増えない)</li>
        </ul>
        <p className="muted">
          連続日数は数えない。数えるのは今週やった日数と、戻ってきた回数。
        </p>
      </div>

      <h2>のびているところ</h2>
      <div className="card">
        <ul className="plain stack">
          <li>
            今週やった日: <strong>{week.days} / 7 日</strong>({week.minutes}分)
            {week.daysDelta !== 0 && (
              <span className={week.daysDelta > 0 ? 'badge badge--ok' : 'badge'}>
                {week.daysDelta > 0
                  ? `先週の同時点より+${week.daysDelta}日`
                  : `先週の同時点より${week.daysDelta}日`}
              </span>
            )}
          </li>
          <li>
            空白のあと戻ってきた回数: <strong>{comebacks}</strong> 回
            <span className="muted">(途切れた回数ではなく、戻った回数を数えている)</span>
          </li>
          {trend.latest !== undefined && (
            <li>
              模試: 最新 <strong>{trend.latest}点</strong> / 自己最高 {trend.best}点
              {trend.delta !== undefined && (
                <span className={trend.delta >= 0 ? 'badge badge--ok' : 'badge badge--warn'}>
                  {trend.delta >= 0 ? `前回より+${trend.delta}点` : `前回より${trend.delta}点`}
                </span>
              )}
            </li>
          )}
          <li>
            復習で解けるようになった問題: <strong>{review.solved}</strong> 問
            {review.graduated > 0 && `(間隔をすべて通過して卒業: ${review.graduated}問)`}
            {review.pending > 0 && ` / まだ ${review.pending} 問`}
          </li>
          {skill.attempts > 0 && (
            <li>
              技能: {skill.attempts}作品
              {skill.recentMinutes.length > 0 &&
                ` / 直近3作品 ${skill.recentMinutes.join('・')}分(複線図込み)`}
              {skill.minutesDelta !== undefined && skill.minutesDelta < 0 && (
                <span className="badge badge--ok">
                  平均{Math.abs(Math.round(skill.minutesDelta))}分速くなった
                </span>
              )}
            </li>
          )}
          {estimate.samples > 0 && estimate.ratio !== undefined && (
            <li>
              言った時間で終わったか: 見積 {estimate.estimated}分 に対して実績 {estimate.actual}分
              <span className={estimate.ratio <= 1.2 ? 'badge badge--ok' : 'badge badge--warn'}>
                {Math.round(estimate.ratio * 100)}%
              </span>
              <br />
              <span className="muted">
                ここが大きくずれている間は、画面に出る「◯分」を鵜呑みにしない。直近
                {estimate.samples}件で見ている。
              </span>
            </li>
          )}
        </ul>
      </div>

      {moves.length > 0 && (
        <>
          <h2>科目別の直近変化</h2>
          <div className="card">
            <ul className="plain stack">
              {moves.map((m) => (
                <li key={m.topicId} className="row row--between">
                  <span>{topicName(m.topicId)}</span>
                  <span className={m.delta >= 0 ? 'badge badge--ok' : 'badge badge--warn'}>
                    {Math.round(m.before * 100)}% → {Math.round(m.recent * 100)}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted">直近20問と、それ以前の比較。両方10問以上ある科目だけ出す。</p>
          </div>
        </>
      )}

      <h2>不明語</h2>
      <div className="card">
        {snapshot.unknownTerms.length === 0 ? (
          <p className="muted">まだない。無採点5問で拾ったものがここに並ぶ。</p>
        ) : (
          <ul className="plain">
            {snapshot.unknownTerms.map((t) => (
              <li key={t.id}>
                {t.term} <span className="muted">({t.createdAt.slice(0, 10)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2>学習セッション</h2>
      {sessions.length === 0 && <p className="muted">まだ記録がない。</p>}
      {sessions.map((s) => (
        <div className="card" key={s.id}>
          <div className="row row--between">
            <strong>{s.lessonId ? (getLesson(s.lessonId)?.title ?? s.lessonId) : KIND_LABEL[s.kind]}</strong>
            <span className="badge">{formatJstShort(s.jstDate)}</span>
          </div>
          <p className="muted">
            {KIND_LABEL[s.kind]} ・{s.durationMinutes}分
            {s.countsAsBasics ? ' ・基礎学習に算入' : ' ・基礎学習には算入しない'}
          </p>
          {s.nextFix && <p>次に直す1点: {s.nextFix}</p>}
        </div>
      ))}

      <p className="muted">週次スナップショットと技能写真のBefore/Afterは次の実装で入れる。</p>
    </main>
  );
}
