import { useState } from 'react';
import { curriculum, getLesson, questions } from '../../data';
import { actionableAdminTasks } from '../../domain/adminTasks';
import { formatJstShort } from '../../domain/jst';
import { modeForBudget } from '../../domain/lessons';
import { STAGE_HINT, STAGE_LABEL } from '../../domain/onboarding';
import { buildTodayQuests, daysSinceLastActivity } from '../../domain/quests';
import { comebackCount, reviewProgress, weekSummary } from '../../domain/growth';
import { dailyPractice, questionMemory } from '../../domain/studyCoach';
import { buildTodayPath, type TodayStep } from '../../domain/todayPath';
import { useVault } from '../../state/VaultContext';
import { AdminTaskRow } from '../milestones/AdminTaskList';
import type { LessonMode, QuizQuestion } from '../../domain/types';
import { ProgressPanel } from './ProgressPanel';
import { TodayPathCard } from './TodayPathCard';

/**
 * ホーム。**この画面の役割は「今日の1歩目を、迷わせずに渡すこと」の1点。**
 *
 * 2026-09-06 の作り直し前は、入口が3つ(コーチのボタン・クエスト開始・公式トレーニング)並び、
 * その周りに数字のカードが9枚あった。本人の言葉:
 * 「いろいろメニューみたいなのがあるのはいいんだけど、どれから始めたらいいのかがよく分からない」。
 * → 今日やることを順番付きの1枚(TodayPathCard)にまとめ、**残りは全部たたむ**。
 *   数字を消したのではない。開けば同じものが全部ある。1歩目の隣に置かないだけ。
 */
export function HomePage({
  onOpenLesson,
  onGoTo,
  onPractice,
  onOfficial,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
  onGoTo?: (tab: 'academic' | 'settings') => void;
  onPractice?: (questions: QuizQuestion[]) => void;
  onOfficial?: () => void;
}) {
  const vault = useVault();
  const [budget, setBudget] = useState<10 | 30 | 60>(30);
  const {
    onboarding,
    settings,
    schedule,
    adminTasks,
    snapshot,
    today,
    academicGate,
    skillGate,
    overallCoverage,
    coverageGaps,
  } = vault;

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
  const quest = quests.find((q) => q.slot === 'main' && q.lessonId);

  const picks = dailyPractice(questions, snapshot.questionAttempts, snapshot.lessonProgress, today);
  const dueCount = picks.filter(
    (p) => questionMemory(p.question, snapshot.questionAttempts, today).due,
  ).length;

  const path = buildTodayPath({
    today,
    sessions: snapshot.studySessions,
    practiceCount: picks.length,
    dueCount,
    quest,
    officialReady: onboarding.stage === 'regular' || onboarding.stage === 'diagnostic',
  });

  const urgent = actionableAdminTasks(adminTasks);
  const gap = daysSinceLastActivity(snapshot.studySessions, snapshot.lessonProgress, today, adminTasks);
  const week = weekSummary(snapshot.studySessions, today);
  const comebacks = comebackCount(snapshot.studySessions);
  const review = reviewProgress(snapshot.questionAttempts);
  const xp = Object.values(snapshot.lessonProgress).reduce((sum, p) => sum + p.xpAwarded, 0);
  const effortLevel = Math.floor(xp / 100) + 1;
  const xpToNextLevel = 100 - (xp % 100);
  const basicsLeft = Math.max(0, onboarding.basicsRequiredMinutes - onboarding.basicsMinutes);
  const basicsPct = Math.min(
    100,
    Math.round((onboarding.basicsMinutes / onboarding.basicsRequiredMinutes) * 100),
  );

  const start = (step: TodayStep) => {
    if (step.kind === 'review') onPractice?.(picks.map((p) => p.question));
    else if (step.kind === 'lesson' && quest?.lessonId) {
      onOpenLesson(quest.lessonId, modeForBudget(budget));
    } else onOfficial?.();
  };

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

      {path.steps.length > 0 && (
        <TodayPathCard
          path={path}
          budget={budget}
          onBudget={setBudget}
          onStart={start}
          gap={gap}
          comebacks={comebacks}
        />
      )}

      {/*
        基礎トレのレッスンを全部終えても、10分モードの見積合計(142分)は
        必要な180分に届かない。やることが無いのに20問診断も開かない行き止まりを、その場で塞ぐ。
      */}
      {path.steps.length === 0 && onboarding.stage === 'basics' && (
        <div className="card card--accent">
          <strong>基礎トレのレッスンは全部クリア！ あと {basicsLeft} 分でアンロック。</strong>
          <p className="muted">
            レッスンは尽きたけど、20問診断はまだ開いていない状態。
            <strong>学科タブの「腕だめし」</strong>を解けば、その時間も基礎トレに入るよ。
          </p>
          <div className="row">
            <button className="btn-primary btn-sm" type="button" onClick={() => onGoTo?.('academic')}>
              腕だめしを解く
            </button>
            {onboarding.diagnosticManualUnlockOffered && (
              <button className="btn-sm" type="button" onClick={() => onGoTo?.('settings')}>
                もう分かってる。先に進む
              </button>
            )}
          </div>
        </div>
      )}

      {path.steps.length === 0 && onboarding.stage !== 'basics' && (
        <div className="card card--accent">
          <strong>今日の学習は、ここまで。</strong>
          <p className="muted">
            {academicGate.passed
              ? '学科の準備目標に到達。受験まで、復習で力を保とう。'
              : '出せるレッスンが今日はもう無い。学科タブの公式トレーニングで、得点を確かめる番。'}
          </p>
        </div>
      )}

      {/* 学習ではないが期限がある。1歩目を隠さない位置に、1件だけ出す */}
      {urgent[0] && (
        <>
          <h2>学習とは別に、期限がある手続き</h2>
          <AdminTaskRow task={urgent[0]} />
        </>
      )}

      {/*
        ここから下は「開けば見られる」場所。閉じているのが既定。
        合格準備度(ゲート)と努力の数字(XP)を混ぜない方針はそのまま。
      */}
      <details className="home-fold">
        <summary>進み具合を見る</summary>
        <div className="stat-grid" aria-label="今週の成長">
          <div className="stat-tile"><strong>{week.days} / 7 日</strong><span>今週やった日</span></div>
          <div className="stat-tile"><strong>{week.minutes}<small>分</small></strong><span>今週の学習</span></div>
          <div className="stat-tile"><strong>{review.solved}<small>問</small></strong><span>復習で克服</span></div>
        </div>
        <div className="xp-strip">
          <svg className="xp-strip__bolt" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z" />
          </svg>
          <div className="xp-strip__label">
            努力レベル Lv.{effortLevel}
            <span className="xp-strip__sub">
              {xpToNextLevel === 0 ? 'レベルアップ目前！' : `次のレベルまで ${xpToNextLevel} XP`}。
              合格ラインは別でチェック。
            </span>
          </div>
          <span className="xp-strip__value">{xp} XP</span>
        </div>
        <ProgressPanel />
      </details>

      <details className="home-fold">
        <summary>合格までの現在地</summary>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <span className={overallCoverage >= 0.9 ? 'badge badge--ok' : 'badge'}>
            範囲カバー {Math.round(overallCoverage * 100)}%
          </span>
          <span className={academicGate.passed ? 'badge badge--ok' : 'badge'}>
            学科ミッション {academicGate.passedCount}/{academicGate.total}
          </span>
          <span className={skillGate.passed ? 'badge badge--ok' : 'badge'}>
            技能ミッション {skillGate.passedCount}/{skillGate.total}
          </span>
        </div>
        {coverageGaps.length > 0 && (
          <p className="muted">
            次に埋める穴: <strong>{coverageGaps[0]!.item.name}</strong>
            {coverageGaps[0]!.taught && !coverageGaps[0]!.confirmed
              ? `（レッスンは終わってる。あと${
                  coverageGaps[0]!.requiredCorrect - coverageGaps[0]!.correct
                }問正解でOK）`
              : '（まだレッスンが残ってる）'}
          </p>
        )}
        <p>{STAGE_HINT[onboarding.stage]}</p>
        <ul className="plain muted">
          <li>オリエンテーション: {onboarding.orientationDone} / {onboarding.orientationTotal} 本</li>
          <li>お試し5問: {onboarding.ungradedFiveDone ? 'クリア' : 'これから'}</li>
          <li>
            基礎学習: {onboarding.basicsMinutes} / {onboarding.basicsRequiredMinutes} 分
            <div className="progressbar" aria-hidden="true">
              <span style={{ width: `${basicsPct}%` }} />
            </div>
          </li>
          <li>
            20問診断:{' '}
            {onboarding.diagnosticDone
              ? 'クリア'
              : onboarding.diagnosticAvailable
                ? 'アンロック済み'
                : '基礎をためるとアンロック'}
          </li>
        </ul>
      </details>

      <details className="home-fold">
        <summary>受験までの残り</summary>
        <ul className="plain">
          <li>
            学科: {settings?.academicDate ?? '未設定'}
            {schedule.academicDaysLeft !== undefined && ` — あと${schedule.academicDaysLeft}日`}
          </li>
          <li>技能: {settings?.skillDate ?? '未設定'}</li>
        </ul>
        {schedule.unplacedRequiredLessonIds.length > 0 && (
          <p className="notice">
            必須レッスンが {schedule.unplacedRequiredLessonIds.length} 本、受験日までに入り切らない。
            設定で学習時間を増やすか、受験日を見直そう。
            <br />
            入り切らない例: {schedule.unplacedRequiredLessonIds
              .slice(0, 3)
              .map((id) => getLesson(id)?.title ?? id)
              .join('、')}
          </p>
        )}
        {schedule.droppedOptionalLessonIds.length > 0 && (
          <p className="muted">
            任意レッスン {schedule.droppedOptionalLessonIds.length} 本は、今回はお休み。必須レッスンは残してある。
          </p>
        )}
        {settings?.motivation && (
          <>
            <h3>合格したら、やりたいこと</h3>
            <p>{settings.motivation}</p>
          </>
        )}
      </details>
    </main>
  );
}
