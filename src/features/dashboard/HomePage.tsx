import { useState } from 'react';
import { curriculum, getLesson } from '../../data';
import { actionableAdminTasks } from '../../domain/adminTasks';
import { formatJstShort } from '../../domain/jst';
import { MODE_LABEL, modeForBudget } from '../../domain/lessons';
import { STAGE_HINT, STAGE_LABEL } from '../../domain/onboarding';
import { REASON_LABEL, buildTodayQuests, daysSinceLastActivity } from '../../domain/quests';
import { useVault } from '../../state/VaultContext';
import { AdminTaskRow } from '../milestones/AdminTaskList';
import type { LessonMode } from '../../domain/types';

export function HomePage({ onOpenLesson }: { onOpenLesson: (id: string, mode: LessonMode) => void }) {
  const vault = useVault();
  const [budget, setBudget] = useState<10 | 30 | 60>(30);
  const { onboarding, settings, schedule, adminTasks, snapshot, today } = vault;

  const quests = buildTodayQuests({
    today,
    curriculum,
    progress: snapshot.lessonProgress,
    sessions: snapshot.studySessions,
    schedule,
    adminTasks,
    onboarding,
    budgetMinutes: budget,
  });

  const urgent = actionableAdminTasks(adminTasks);
  const gap = daysSinceLastActivity(snapshot.studySessions, snapshot.lessonProgress, today);
  const basicsPct = Math.min(
    100,
    Math.round((onboarding.basicsMinutes / onboarding.basicsRequiredMinutes) * 100),
  );

  return (
    <main className="app">
      <div className="row row--between">
        <h1>今日 {formatJstShort(today)}</h1>
        <span className="badge">{STAGE_LABEL[onboarding.stage]}</span>
      </div>

      {gap !== undefined && gap >= 3 && (
        <div className="card card--accent">
          <strong>{gap}日ぶり。おかえり。</strong>
          <p className="muted">
            失点ではない。連続日数は数えていない。今日は10分だけ戻せば十分。
          </p>
        </div>
      )}

      {urgent[0] && (
        <>
          <h2>いま優先する手続き</h2>
          <AdminTaskRow task={urgent[0]} />
        </>
      )}

      <h2>今日のクエスト</h2>
      <div className="row" role="group" aria-label="今日の持ち時間">
        {([10, 30, 60] as const).map((m) => (
          <button
            key={m}
            className={m === budget ? 'btn-primary btn-sm' : 'btn-sm'}
            aria-pressed={m === budget}
            onClick={() => setBudget(m)}
          >
            {m}分
          </button>
        ))}
      </div>

      {quests.length === 0 && (
        <div className="card">
          <p>今日ぶんの必須はもうない。休んでよい。</p>
        </div>
      )}

      {quests.map((q) => (
        <div className={q.slot === 'main' ? 'card card--accent' : 'card'} key={q.id}>
          <div className="row row--between">
            <strong>{q.title}</strong>
            <span className="badge">{REASON_LABEL[q.reason]}</span>
          </div>
          <p className="muted">{q.detail}</p>
          <p className="muted">クリア条件: {q.clearCondition}</p>
          <div className="row row--between">
            <span className="badge">
              {q.minutes}分 / {MODE_LABEL[modeForBudget(budget)]}版
            </span>
            {q.lessonId ? (
              <button
                className="btn-primary btn-sm"
                onClick={() => onOpenLesson(q.lessonId!, modeForBudget(budget))}
              >
                はじめる
              </button>
            ) : (
              <span className="muted">↑ 上の手続きカードから進む</span>
            )}
          </div>
        </div>
      ))}

      <h2>いまの段階</h2>
      <div className="card">
        <p>{STAGE_HINT[onboarding.stage]}</p>
        <ul className="plain muted">
          <li>
            オリエンテーション: {onboarding.orientationDone} / {onboarding.orientationTotal} 本
          </li>
          <li>無採点5問: {onboarding.ungradedFiveDone ? '済' : 'まだ'}</li>
          <li>
            基礎学習: {onboarding.basicsMinutes} / {onboarding.basicsRequiredMinutes} 分
            <div className="progressbar" aria-hidden="true">
              <span style={{ width: `${basicsPct}%` }} />
            </div>
          </li>
          <li>
            20問診断:{' '}
            {onboarding.diagnosticDone
              ? '済'
              : onboarding.diagnosticAvailable
                ? '受けられる'
                : '基礎が貯まると開く'}
          </li>
        </ul>
      </div>

      <h2>受験までの残り</h2>
      <div className="card">
        <ul className="plain">
          <li>
            学科: {settings?.academicDate ?? '未設定'}
            {schedule.academicDaysLeft !== undefined && ` — あと${schedule.academicDaysLeft}日`}
          </li>
          <li>技能: {settings?.skillDate ?? '未設定'}</li>
        </ul>
        {schedule.unplacedRequiredLessonIds.length > 0 && (
          <p className="notice">
            必須レッスン {schedule.unplacedRequiredLessonIds.length} 本が受験日までに入り切らない。
            設定タブで学習時間を増やすか、受験日を後ろにする。
            <br />
            入り切らない例: {schedule.unplacedRequiredLessonIds
              .slice(0, 3)
              .map((id) => getLesson(id)?.title ?? id)
              .join('、')}
          </p>
        )}
        {schedule.droppedOptionalLessonIds.length > 0 && (
          <p className="muted">
            任意レッスン {schedule.droppedOptionalLessonIds.length} 本は今回の計画から外した(必須は外していない)。
          </p>
        )}
      </div>

      {settings?.motivation && (
        <>
          <h2>なぜ取るのか</h2>
          <div className="card">
            <p>{settings.motivation}</p>
          </div>
        </>
      )}
    </main>
  );
}
