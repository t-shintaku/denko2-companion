import { getLesson } from '../../data';
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
  const { snapshot } = useVault();
  const sessions = [...snapshot.studySessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const totalMinutes = sessions.reduce((s, x) => s + x.durationMinutes, 0);
  const xp = Object.values(snapshot.lessonProgress).reduce((s, p) => s + p.xpAwarded, 0);
  const completed = Object.values(snapshot.lessonProgress).filter((p) => p.completedAt).length;
  const days = new Set(sessions.map((s) => s.jstDate));

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
          連続日数は数えない。数えるのは「今週戻った日数」と「累計の復帰回数」(Sprint 4)。
        </p>
      </div>

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

      <p className="muted">
        模試推移・分野別正答率・技能時間と欠陥の推移・週次レビューは Sprint 2〜4。
      </p>
    </main>
  );
}
