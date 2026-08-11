import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { repo, type VaultSnapshot } from '../db/repo';
import { adminTaskTemplates, curriculum, examCycle } from '../data';
import { resolveAdminTasks, type ResolvedAdminTask } from '../domain/adminTasks';
import { buildSchedule, type ScheduleResult } from '../domain/schedule';
import { evaluateOnboarding, type OnboardingState } from '../domain/onboarding';
import {
  academicGate as computeAcademicGate,
  reviewQueue as computeReviewQueue,
  topicStats as computeTopicStats,
  type AcademicGate,
  type ReviewItem,
  type TopicStat,
} from '../domain/academic';
import { skillGate as computeSkillGate } from '../domain/practical';
import { todayJst } from '../domain/jst';
import { topicIds } from '../data';
import type { IsoDate, UserSettings } from '../domain/types';

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
  reload: () => Promise<void>;
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
  const today = todayJst();

  const reload = useCallback(async () => {
    const next = await repo.load();
    setSnapshot(next);
    setReady(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    const reviewQueue = computeReviewQueue(snapshot.questionAttempts, topicStats);
    const skillGate = computeSkillGate(snapshot.skillAttempts, snapshot.budgetItems);

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
      reload,
    };
  }, [snapshot, ready, today, reload]);

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
