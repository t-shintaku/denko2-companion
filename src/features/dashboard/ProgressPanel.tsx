import { questions, topics } from '../../data';
import { learningDays, questionMemory } from '../../domain/studyCoach';
import { examReadiness } from '../../domain/officialExam';
import { useVault } from '../../state/VaultContext';

/**
 * 進み具合。**ホームの一番上には置かない。**
 * ここは「今日やること」を決めたあとで、見たい人だけが開く場所
 * (2026-09-06: 入口の隣に数字を9枚並べていたので、どれが1歩目か分からなくなっていた)。
 */
export function ProgressPanel() {
  const { snapshot, today } = useVault();
  const days = learningDays(snapshot.studySessions, snapshot.questionAttempts, today);
  const state = questions.map((q) => ({ q, memory: questionMemory(q, snapshot.questionAttempts, today) }));
  const retained = state.filter((s) => s.memory.spaced).length;
  const seen = state.filter((s) => s.memory.seen).length;
  const readiness = examReadiness(snapshot.mockExams, today);

  return (
    <div className="study-coach">
      <div className="coach-week" aria-label="直近7日の学習">
        <strong>積み重ねた日</strong>
        <div>
          {days.map((d) => (
            <span
              key={d.date}
              className={d.active ? 'day-spark day-spark--active' : 'day-spark'}
              aria-label={`${d.date} ${d.active ? '学習あり' : '学習なし'}`}
            >
              {d.active ? '✓' : Number(d.date.slice(-2))}
            </span>
          ))}
        </div>
        <small>休んでも、覚えたことはゼロにならない。</small>
      </div>

      <ol className="coach-path" aria-label="合格までの学習経路">
        <li className={seen ? 'path-lit' : ''}>
          <span>01</span><strong>基礎を知る</strong><small>{seen}/{questions.length}問に挑戦</small>
        </li>
        <li className={retained ? 'path-lit' : ''}>
          <span>02</span><strong>日を空けて解く</strong><small>{retained}問を3日以上空けて正解</small>
        </li>
        <li className={readiness.qualifying.length ? 'path-lit' : ''}>
          <span>03</span><strong>初見で確かめる</strong><small>{readiness.qualifying.length}/3回 · 公式50問</small>
        </li>
      </ol>

      <details className="coach-map">
        <summary>7科目の伸びを見る</summary>
        {topics.map((t) => {
          const mine = state.filter((s) => s.q.topicId === t.id);
          const n = mine.filter((s) => s.memory.spaced).length;
          return (
            <div className="coach-topic" key={t.id}>
              <span>{t.shortName}</span>
              <progress value={n} max={mine.length} aria-label={`${t.shortName} 日を空けて正解`} />
              <small>{n}/{mine.length}</small>
            </div>
          );
        })}
        <p className="muted">
          自作問題で日を空けて思い出せた範囲。仕上げは図や写真を含む公式問題で確かめます。
        </p>
      </details>

      {readiness.passed && (
        <p className="quiz-feedback quiz-feedback--ok">
          初見3回の目標に到達。受験までは弱点と復習を続けよう。
        </p>
      )}
    </div>
  );
}
