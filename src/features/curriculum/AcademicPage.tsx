import { curriculum, resources, topics } from '../../data';
import { formatJstShort } from '../../domain/jst';
import { completionRatio, isLessonComplete, modeForBudget } from '../../domain/lessons';
import { STAGE_LABEL } from '../../domain/onboarding';
import { useVault } from '../../state/VaultContext';
import type { LessonMode } from '../../domain/types';

export function AcademicPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const { snapshot, schedule, onboarding } = useVault();
  const stageRank: Record<string, number> = {
    orientation: 0,
    'ungraded-five': 1,
    basics: 2,
    diagnostic: 3,
    regular: 4,
  };
  const currentRank = stageRank[onboarding.stage] ?? 4;

  return (
    <main className="app">
      <h1>学科</h1>
      <p className="muted">
        公式基準は60点(50問中30問)。本ツールの運用目標は直近3回平均80点・全科目60%以上。
        60点は公式、80点は自分向けの余裕目標。
      </p>

      <h2>7科目</h2>
      <div className="card scroll-x">
        <table>
          <thead>
            <tr>
              <th>科目</th>
              <th>目安出題数</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.approxQuestions}問</td>
                <td className="muted">Sprint 2で記録</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        科目別の正答率・復習キュー・模試はSprint 2。いまは問題を解いた結果をレッスンの中で記録する。
      </p>

      <h2>カリキュラム</h2>
      {curriculum.phases.map((phase) => {
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
                {r.verification === 'requirements-doc' && '(要件書記載。リンク到達性は未検証)'}
              </div>
            </li>
          ))}
      </ul>
    </main>
  );
}
