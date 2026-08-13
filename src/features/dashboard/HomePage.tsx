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

export function HomePage({
  onOpenLesson,
  onGoTo,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
  onGoTo?: (tab: 'academic' | 'settings') => void;
}) {
  const vault = useVault();
  const [budget, setBudget] = useState<10 | 30 | 60>(30);
  const [keepGoing, setKeepGoing] = useState(false);
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

  const urgent = actionableAdminTasks(adminTasks);
  const gap = daysSinceLastActivity(snapshot.studySessions, snapshot.lessonProgress, today, adminTasks);
  const week = weekSummary(snapshot.studySessions, today);
  const comebacks = comebackCount(snapshot.studySessions);
  const review = reviewProgress(snapshot.questionAttempts);
  const learnedToday = snapshot.studySessions.some((session) => session.jstDate === today);
  const showQuests = !learnedToday || keepGoing;
  const xp = Object.values(snapshot.lessonProgress).reduce((sum, p) => sum + p.xpAwarded, 0);
  const effortLevel = Math.floor(xp / 100) + 1;
  const xpToNextLevel = 100 - (xp % 100);
  const basicsLeft = Math.max(
    0,
    onboarding.basicsRequiredMinutes - onboarding.basicsMinutes,
  );
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
          <strong>{gap}日ぶり。おかえり！</strong>
          <p className="muted">
            戻ってきた時点で、もう1歩前進。復帰はこれで{comebacks + 1}回目。
            今日は下のクエストを1つクリアすればOK！
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
        <div className="xp-strip__label">
          努力レベル Lv.{effortLevel}
          <span className="xp-strip__sub">
            {xpToNextLevel === 0 ? 'レベルアップ目前！' : `次のレベルまで ${xpToNextLevel} XP`}。
            合格ラインは別でチェック。
          </span>
        </div>
        <span className="xp-strip__value">{xp} XP</span>
      </div>

      {urgent[0] && (
        <>
          <h2>先にクリアする手続き</h2>
          <AdminTaskRow task={urgent[0]} />
        </>
      )}

      <div className="quest-section-title">
        <h2>{learnedToday && !keepGoing ? '今日のクエスト、クリア！' : '今日のクエスト'}</h2>
        <span>{learnedToday && !keepGoing ? 'よくやった！' : '1件でクリア'}</span>
      </div>
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

      {learnedToday && !keepGoing && (
        <div className="card card--accent">
          <strong>今日はここで終わってOK！</strong>
          <p className="muted">1つ進めた時点で今日の勝ち。続きは明日の自分に任せよう。</p>
          <button className="btn-sm" type="button" onClick={() => setKeepGoing(true)}>
            まだいける。もう1つだけ！
          </button>
        </div>
      )}

      {/*
        基礎トレのレッスンを全部終えても、10分モードの見積合計(142分)は
        必要な180分に届かない。ここで「コンプリート！」とだけ出すと、
        やることが無いのに20問診断も開かない行き止まりになる。
        抜け道(腕だめし・手動アンロック)は設定と学科タブにあるが、
        ホームから案内していなかったので、その場で出す。
      */}
      {showQuests && quests.length === 0 && onboarding.stage === 'basics' && (
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

      {showQuests && quests.length === 0 && onboarding.stage !== 'basics' && (
        <div className="card">
          <p>今日の必須クエストはコンプリート！ あとは休むも、もう1問やるも自由。</p>
        </div>
      )}

      {showQuests && quests.map((q) => (
        <div className={q.slot === 'main' ? 'card quest-card' : 'card'} key={q.id}>
          <div className="row row--between">
            <strong className={q.slot === 'main' ? 'quest-card__title' : undefined}>{q.title}</strong>
            <span className="badge">{REASON_LABEL[q.reason]}</span>
          </div>
          <p className="muted">{q.detail}</p>
          <p className="muted">クリアすると: {q.clearCondition}</p>
          {q.remainingMinutes !== undefined && q.remainingMinutes > q.minutes && (
            <p className="muted">
              レッスン全体は残り約{q.remainingMinutes}分。今日はキリのいいところでストップOK！
            </p>
          )}
          {!q.fitsBudget && (
            // 収まらないなら黙って出さない。「10分」と書いて60分渡すのが一番効く嘘
            <p className="notice">
              このクエストは約{q.minutes}分。今日は{budget}分だけ進めればOK。
              終わったステップまで、ちゃんと記録に残る。
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
                クエスト開始
              </button>
            ) : (
              <span className="muted">↑ 先に上の手続きをクリアしよう</span>
            )}
          </div>
        </div>
      ))}

      {/*
        合格に直結する数字を、いちばん見る場所へ出す。
        以前はXPと今週の分数だけがトップにあり、範囲カバーも学科ゲートも
        学科タブまで潜らないと見えなかった。努力の数字だけが目立つ状態になっていた。
      */}
      <h2>合格までの現在地</h2>
      <div className="card">
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
          <li>
            オリエンテーション: {onboarding.orientationDone} / {onboarding.orientationTotal} 本
          </li>
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
      </div>

      {settings?.motivation && (
        <>
          <h2>合格したら、やりたいこと</h2>
          <div className="card">
            <p>{settings.motivation}</p>
          </div>
        </>
      )}
    </main>
  );
}
