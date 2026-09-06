import { questions, topics } from '../../data';
import { dailyPractice, learningDays, questionMemory } from '../../domain/studyCoach';
import { examReadiness } from '../../domain/officialExam';
import { useVault } from '../../state/VaultContext';
import type { QuizQuestion } from '../../domain/types';

export function StudyCoach({ onPractice, onOfficial, onNextLesson }: {
  onPractice: (questions: QuizQuestion[]) => void; onOfficial: () => void; onNextLesson?: () => void;
}) {
  const { snapshot, today, onboarding } = useVault();
  const picks = dailyPractice(questions, snapshot.questionAttempts, snapshot.lessonProgress, today);
  const days = learningDays(snapshot.studySessions, snapshot.questionAttempts, today);
  const state = questions.map(q => ({ q, memory: questionMemory(q, snapshot.questionAttempts, today) }));
  const retained = state.filter(s => s.memory.spaced).length;
  const seen = state.filter(s => s.memory.seen).length;
  const due = state.filter(s => s.memory.due).length;
  const readiness = examReadiness(snapshot.mockExams, today);
  const familiar = onboarding.stage === 'regular' || onboarding.stage === 'diagnostic';
  const headline = due ? '思い出すたび、力になる。' : readiness.passed ? '合格ラインの先へ、もう一歩。' : '今日の一歩を、合格につなぐ。';
  return <section className="study-coach" aria-label="学科の学習コーチ">
    <div className="coach-hero"><div className="coach-hero-copy"><p className="coach-kicker">YOUR DAILY SPARK</p><h2>{headline}</h2>
      <p>{picks.length ? `今日は${picks.length}問。${due ? '忘れかけを取り戻してから、先へ進もう。' : '教わったことを、自力で解けるか確かめよう。'}` : '見る → 思い出す → 解く。ひとつずつ積み重ねよう。'}</p></div>
      <div className="coach-orb" aria-hidden="true"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M45 14 25 43h16l-6 23 23-32H42Z" fill="currentColor"/></svg></div>
      <button className="coach-start" onClick={() => picks.length ? onPractice(picks.map(p => p.question)) : onNextLesson ? onNextLesson() : onOfficial()}>
        {picks.length ? `今日の${picks.length}問を始める` : onNextLesson ? '次のレッスンを始める' : '公式問題で確かめる'} <span aria-hidden="true">→</span>
      </button><p className="coach-footnote">{picks.length ? '約5分 · 確定した回答は1問ずつ保存' : '自分のペースで。途中まででも記録に残る。'}</p>
    </div>
    <div className="coach-week" aria-label="直近7日の学習"><strong>積み重ねた日</strong><div>{days.map(d => <span key={d.date} className={d.active ? 'day-spark day-spark--active' : 'day-spark'} aria-label={`${d.date} ${d.active ? '学習あり' : '学習なし'}`}>{d.active ? '✓' : Number(d.date.slice(-2))}</span>)}</div><small>休んでも、覚えたことはゼロにならない。</small></div>
    <ol className="coach-path" aria-label="合格までの学習経路">
      <li className={seen ? 'path-lit' : ''}><span>01</span><strong>基礎を知る</strong><small>{seen}/{questions.length}問に挑戦</small></li>
      <li className={retained ? 'path-lit' : ''}><span>02</span><strong>日を空けて解く</strong><small>{retained}問を3日以上空けて正解</small></li>
      <li className={readiness.qualifying.length ? 'path-lit' : ''}><span>03</span><strong>初見で確かめる</strong><small>{readiness.qualifying.length}/3回 · 公式50問</small></li>
    </ol>
    <details className="coach-map"><summary>7科目の伸びを見る</summary>{topics.map(t => {
      const mine = state.filter(s => s.q.topicId === t.id), n = mine.filter(s => s.memory.spaced).length;
      return <div className="coach-topic" key={t.id}><span>{t.shortName}</span><progress value={n} max={mine.length} aria-label={`${t.shortName} 日を空けて正解`} /><small>{n}/{mine.length}</small></div>;
    })}<p className="muted">自作問題で日を空けて思い出せた範囲。仕上げは図や写真を含む公式問題で確かめます。</p></details>
    {familiar && <div className="coach-checkpoint"><div><strong>本番の図と写真に挑戦</strong><p>まずは5問。仕上げは50問・120分。</p></div><button onClick={onOfficial}>公式トレーニング →</button></div>}
    {readiness.passed && <p className="quiz-feedback quiz-feedback--ok">初見3回の目標に到達。受験までは弱点と復習を続けよう。</p>}
  </section>;
}
