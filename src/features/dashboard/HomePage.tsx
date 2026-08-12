import { useState } from 'react';
import { curriculum, getLesson } from '../../data';
import { actionableAdminTasks } from '../../domain/adminTasks';
import { formatJstShort } from '../../domain/jst';
import { MODE_LABEL, modeForBudget } from '../../domain/lessons';
import { STAGE_HINT, STAGE_LABEL } from '../../domain/onboarding';
import { REASON_LABEL, buildTodayQuests, daysSinceLastActivity } from '../../domain/quests';
import { comebackCount, reviewProgress, weekSummary } from '../../domain/growth';
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
  const week = weekSummary(snapshot.studySessions, today);
  const comebacks = comebackCount(snapshot.studySessions);
  const review = reviewProgress(snapshot.questionAttempts);
  const xp = Object.values(snapshot.lessonProgress).reduce((sum, p) => sum + p.xpAwarded, 0);
  const effortLevel = Math.floor(xp / 100) + 1;
  const basicsPct = Math.min(
    100,
    Math.round((onboarding.basicsMinutes / onboarding.basicsRequiredMinutes) * 100),
  );

  return (
    <main className="app">
      <div className="brandbar">
        <div className="brandmark">
          <span className="brandmark__icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z" />
            </svg>
          </span>
          <div>
            <span className="brandmark__eyebrow">DENKO QUEST</span>
            <h1>今日 {formatJstShort(today)}</h1>
          </div>
        </div>
        <span className="stage-chip">{STAGE_LABEL[onboarding.stage]}</span>
      </div>

      {gap !== undefined && gap >= 3 && (
        <div className="card card--accent">
          <strong>{gap}日ぶり。おかえり。</strong>
          <p className="muted">
            失点ではない。連続日数は数えていない。数えているのは戻ってきた回数(いま{comebacks + 1}回目)。
            下の「今日のクエスト」の1件だけやれば、それで今日は十分。
          </p>
        </div>
      )}

      <div className="stat-grid" aria-label="今週の成長">
        <div className="stat-tile"><strong>{week.days} / 7 日</strong><span>今週やった日</span></div>
        <div className="stat-tile"><strong>{week.minutes}<small>分</small></strong><span>今週の学習</span></div>
        <div className="stat-tile"><strong>{review.solved}<small>問</small></strong><span>復習で克服</span></div>
      </div>

      <div className="xp-strip">
        <svg className="xp-strip__bolt" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z" /></svg>
        <div className="xp-strip__label">努力レベル Lv.{effortLevel}<span className="xp-strip__sub">XPは努力の記録。合格準備度とは別。</span></div>
        <span className="xp-strip__value">{xp} XP</span>
      </div>

      {urgent[0] && (
        <>
          <h2>いま優先する手続き</h2>
          <AdminTaskRow task={urgent[0]} />
        </>
      )}

      <div className="quest-section-title"><h2>今日のクエスト</h2><span>1件でクリア</span></div>
      <div className="budget-switch" role="group" aria-label="今日の持ち時間">
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
        <div className={q.slot === 'main' ? 'card quest-card' : 'card'} key={q.id}>
          <div className="row row--between">
            <strong className={q.slot === 'main' ? 'quest-card__title' : undefined}>{q.title}</strong>
            <span className="badge">{REASON_LABEL[q.reason]}</span>
          </div>
          <p className="muted">{q.detail}</p>
          <p className="muted">クリア条件: {q.clearCondition}</p>
          {q.remainingMinutes !== undefined && q.remainingMinutes > q.minutes && (
            <p className="muted">
              このレッスン全体では残り約{q.remainingMinutes}分。今日はここまでで区切ってよい。
            </p>
          )}
          {!q.fitsBudget && (
            // 収まらないなら黙って出さない。「10分」と書いて60分渡すのが一番効く嘘
            <p className="notice">
              この一手は{q.minutes}分かかる({budget}分には収まらない)。
              途中でやめてよく、段階を終えたところまで記録される。
            </p>
          )}
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
