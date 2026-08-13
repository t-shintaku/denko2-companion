import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onRepoChange, repo, type VaultSnapshot } from '../db/repo';
import { syncEngine } from '../sync/engine';
import { adminTaskTemplates, curriculum, examCycle, questions, syllabus } from '../data';
import { resolveAdminTasks, type ResolvedAdminTask } from '../domain/adminTasks';
import { buildSchedule, type ScheduleResult } from '../domain/schedule';
import { evaluateOnboarding, type OnboardingState } from '../domain/onboarding';
import { recallGaps as computeRecallGaps, type RecallGap } from '../domain/lessons';
import {
  academicGate as computeAcademicGate,
  reviewQueue as computeReviewQueue,
  topicStats as computeTopicStats,
  type AcademicGate,
  type ReviewItem,
  type TopicStat,
} from '../domain/academic';
import { skillGate as computeSkillGate } from '../domain/practical';
import {
  coverageGaps as computeCoverageGaps,
  overallCoverage as computeOverallCoverage,
  syllabusStatus as computeSyllabusStatus,
  topicCoverage as computeTopicCoverage,
  type SyllabusStatus,
  type TopicCoverage,
} from '../domain/coverage';
import { todayJst } from '../domain/jst';
import { topicIds } from '../data';
import type { IsoDate, SyncStatus, UserSettings } from '../domain/types';

export type VaultValue = {
  ready: boolean;
  today: IsoDate;
  snapshot: VaultSnapshot;
  settings?: UserSettings;
  schedule: ScheduleResult;
  adminTasks: ResolvedAdminTask[];
  onboarding: OnboardingState;
  topicStats: TopicStat[];
  academicGate: AcademicGate;
  reviewQueue: ReviewItem[];
  skillGate: ReturnType<typeof computeSkillGate>;
  /** 出題項目ごとの「教わった/正解した」。合格ラインまでの穴を出すのに使う */
  syllabusStatus: SyllabusStatus[];
  topicCoverage: TopicCoverage[];
  /** 学科50問の重みで加重したカバレッジ(0〜1) */
  overallCoverage: number;
  /** 次に埋める穴。上から順に潰せば範囲が閉じる */
  coverageGaps: SyllabusStatus[];
  /** 「見ないで思い出す」で言えなかった項目。合格準備度には入れず、言い直し用に出す */
  recallGaps: RecallGap[];
  reload: () => Promise<void>;
  /** 端末間同期の状態。設定画面と各タブの表示に使う */
  syncStatus: SyncStatus;
  /** 手で押したときの同期。間隔の制限を無視して必ず走る */
  syncNow: () => Promise<void>;
};

const emptySnapshot: VaultSnapshot = {
  lessonProgress: {},
  adminTaskStates: {},
  studySessions: [],
  questionAttempts: [],
  mockExams: [],
  unknownTerms: [],
  skillAttempts: [],
  budgetItems: [],
};

const VaultContext = createContext<VaultValue | undefined>(undefined);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<VaultSnapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ phase: 'off' });
  const today = todayJst();

  const reload = useCallback(async () => {
    const next = await repo.load();
    setSnapshot(next);
    setReady(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 端末間同期。IndexedDB は端末ごとに別なので、ここで繋がないと
  // スマホ・PC・タブレットが別々の正答率とゲート判定を出し続ける。
  useEffect(() => {
    syncEngine.onPulled = reload;
    const unsubscribeStatus = syncEngine.subscribe(setSyncStatus);
    const unsubscribeRepo = onRepoChange(() => syncEngine.scheduleSoon());

    void syncEngine.load().then((config) => {
      if (config) void syncEngine.syncNow(true);
    });

    const onOnline = () => void syncEngine.syncNow(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncEngine.syncNow();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      unsubscribeStatus();
      unsubscribeRepo();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      syncEngine.onPulled = undefined;
    };
  }, [reload]);

  const syncNow = useCallback(async () => {
    await syncEngine.syncNow(true);
  }, []);

  const value = useMemo<VaultValue>(() => {
    const settings = snapshot.settings;
    const schedule = buildSchedule({
      today,
      startDate: settings?.startDate ?? today,
      academicDate: settings?.academicDate,
      skillDate: settings?.skillDate,
      weekdayMinutes: settings?.weekdayMinutes ?? 35,
      weekendMinutes: settings?.weekendMinutes ?? 150,
      curriculum,
      progress: snapshot.lessonProgress,
    });

    const adminTasks = resolveAdminTasks(adminTaskTemplates, snapshot.adminTaskStates, {
      academicMode: settings?.academicMode ?? 'undecided',
      academicDate: settings?.academicDate,
      skillDate: settings?.skillDate ?? examCycle.skillExamDates[0],
    });

    const onboarding = evaluateOnboarding(curriculum, snapshot.lessonProgress, snapshot.studySessions, {
      beginnerMode: settings?.beginnerMode ?? true,
      diagnosticUnlockedManually: settings?.diagnosticUnlockedManually ?? false,
      diagnosticCompletedAt: settings?.diagnosticCompletedAt,
      ungradedFiveCompletedAt: settings?.ungradedFiveCompletedAt,
    });

    const topicStats = computeTopicStats(snapshot.questionAttempts, topicIds, today);
    const academicGate = computeAcademicGate(
      snapshot.questionAttempts,
      snapshot.mockExams,
      topicStats,
    );
    const reviewQueue = computeReviewQueue(snapshot.questionAttempts, topicStats, 30, today);
    const skillGate = computeSkillGate(snapshot.skillAttempts, snapshot.budgetItems);

    // 「レッスンを何本終えたか」ではなく「出題項目を何個押さえたか」で範囲を見る
    const syllabusStatus = computeSyllabusStatus(
      syllabus,
      curriculum.lessons,
      questions,
      snapshot.lessonProgress,
      snapshot.questionAttempts,
    );
    const topicCoverage = computeTopicCoverage(syllabusStatus, topicIds);
    const overallCoverage = computeOverallCoverage(topicCoverage);
    const coverageGaps = computeCoverageGaps(syllabusStatus);
    const recallGaps = computeRecallGaps(curriculum.lessons, snapshot.lessonProgress);

    return {
      ready,
      today,
      snapshot,
      settings,
      schedule,
      adminTasks,
      onboarding,
      topicStats,
      academicGate,
      reviewQueue,
      skillGate,
      syllabusStatus,
      topicCoverage,
      overallCoverage,
      coverageGaps,
      recallGaps,
      reload,
      syncStatus,
      syncNow,
    };
  }, [snapshot, ready, today, reload, syncStatus, syncNow]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
