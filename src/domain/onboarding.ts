/**
 * 完全未経験者オンボーディングのゲート(FR-003 / §6 / AT-002)。
 *
 *   オリエンテーション → 無採点5問 → 基礎180分 → 20問診断 → 通常
 *
 * 破ってはいけないこと:
 * - 初回に20問診断を出さない
 * - 無採点5問を「診断テスト」と呼ばない / 得点・正答率を出さない / 準備度へ反映しない
 * - 基礎180分に達する前に20問診断を前面へ出さない(本人の手動解禁は別導線で許す)
 */

import type {
  Curriculum,
  CurriculumLesson,
  LessonProgress,
  OnboardingStage,
  StudySession,
  UserSettings,
} from './types';

export const BASICS_REQUIRED_MINUTES = 180;

export type OnboardingState = {
  stage: OnboardingStage;
  orientationTotal: number;
  orientationDone: number;
  ungradedFiveDone: boolean;
  basicsMinutes: number;
  basicsRequiredMinutes: number;
  diagnosticDone: boolean;
  /** 20問診断を前面に出してよいか */
  diagnosticAvailable: boolean;
  /** 手動解禁ボタンを出してよいか(基礎未達だが本人が理解できている場合) */
  diagnosticManualUnlockOffered: boolean;
};

/**
 * そのレッスンの学習時間を「基礎学習180分」へ算入してよいか。
 *
 * §6 は Step 1 オリエンテーション(60〜90分)と Step 3 基礎学習(3〜5時間)を別の段階として置いている。
 * オリエンテーションを算入すると、標準見積100分ぶんが先に埋まり、
 * 本来3時間必要な基礎が実質80分で診断解禁になる。
 * 無採点5問(体験)も同じ理由で算入しない。
 */
export function countsAsBasics(lesson: Pick<CurriculumLesson, 'stage'>): boolean {
  return lesson.stage === 'basics' || lesson.stage === 'regular';
}

/** 基礎学習として数える時間。オリエンテーション・無採点5問は countsAsBasics=false で除外 */
export function basicsMinutes(sessions: StudySession[]): number {
  return sessions
    .filter((s) => s.countsAsBasics)
    .reduce((sum, s) => sum + (Number.isFinite(s.durationMinutes) ? s.durationMinutes : 0), 0);
}

export function evaluateOnboarding(
  curriculum: Curriculum,
  progress: Record<string, LessonProgress>,
  sessions: StudySession[],
  settings: Pick<
    UserSettings,
    'beginnerMode' | 'diagnosticUnlockedManually' | 'diagnosticCompletedAt' | 'ungradedFiveCompletedAt'
  >,
): OnboardingState {
  const orientationLessons = curriculum.lessons.filter((l) => l.stage === 'orientation');
  const orientationDone = orientationLessons.filter((l) => progress[l.id]?.completedAt).length;
  const orientationComplete =
    orientationLessons.length > 0 && orientationDone === orientationLessons.length;

  const ungradedLesson = curriculum.lessons.find((l) => l.stage === 'ungraded-five');
  const ungradedFiveDone = Boolean(
    settings.ungradedFiveCompletedAt ||
      (ungradedLesson && progress[ungradedLesson.id]?.completedAt),
  );

  const minutes = basicsMinutes(sessions);
  const diagnosticDone = Boolean(settings.diagnosticCompletedAt);

  const basicsMet = minutes >= BASICS_REQUIRED_MINUTES;
  const diagnosticAvailable =
    orientationComplete &&
    ungradedFiveDone &&
    (basicsMet || settings.diagnosticUnlockedManually);

  let stage: OnboardingStage;
  if (!settings.beginnerMode) stage = 'regular';
  else if (!orientationComplete) stage = 'orientation';
  else if (!ungradedFiveDone) stage = 'ungraded-five';
  else if (!diagnosticAvailable) stage = 'basics';
  else if (!diagnosticDone) stage = 'diagnostic';
  else stage = 'regular';

  return {
    stage,
    orientationTotal: orientationLessons.length,
    orientationDone,
    ungradedFiveDone,
    basicsMinutes: minutes,
    basicsRequiredMinutes: BASICS_REQUIRED_MINUTES,
    diagnosticDone,
    diagnosticAvailable,
    // 「本人が理解できた場合は手動で早められる」(§6 Step 4)。
    // ただし前面には出さない。基礎が半分を超えてから設定画面に現れる。
    diagnosticManualUnlockOffered:
      settings.beginnerMode &&
      orientationComplete &&
      ungradedFiveDone &&
      !basicsMet &&
      !settings.diagnosticUnlockedManually &&
      minutes >= BASICS_REQUIRED_MINUTES / 2,
  };
}

export const STAGE_LABEL: Record<OnboardingStage, string> = {
  orientation: 'STAGE 1 電気の地図',
  'ungraded-five': 'STAGE 2 お試し5問',
  basics: 'STAGE 3 基礎トレ',
  diagnostic: 'STAGE 4 20問診断',
  regular: 'STAGE 5 合格クエスト',
};

export const STAGE_HINT: Record<OnboardingStage, string> = {
  orientation: 'まずは電気の全体マップへ。資格でできること、電気の基本、器具と工具をざっくり見よう。',
  'ungraded-five':
    '過去問を5問だけのぞいてみよう。点数は気にしなくてOK。知らない言葉を3つ拾えたらクリア！',
  basics: `写真・図記号・器具工具・超基礎をトレーニング。累計${BASICS_REQUIRED_MINUTES}分で20問診断がアンロック！`,
  diagnostic: '20問でいまの実力をチェック。ここから7科目の攻略が始まる。',
  regular: '7科目の過去問と技能を回して、合格ラインを1つずつクリアしよう。',
};
