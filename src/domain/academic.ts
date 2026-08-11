/**
 * 学科の成績・復習キュー・ゲート(FR-009 / FR-010 / FR-013)。
 *
 * 原則:
 * - 公式基準は60点(50問中30問)。80点は本ツールの運用目標。UIで必ず書き分ける。
 * - 平均点で通さない。1科目でも60%未満なら準備完了にしない。
 * - `scored: false`(無採点5問)は一切集計に入れない。
 */

import { diffDays, todayJst } from './jst';
import type {
  ErrorReason,
  IsoDate,
  IsoDateTime,
  MockExam,
  QuestionAttempt,
  TopicId,
} from './types';

/** 1問2点。50問で100点満点 */
export const POINTS_PER_QUESTION = 2;
/** 公式の合格基準(50問中30問=60点) */
export const OFFICIAL_PASS_SCORE = 60;
/** 本ツールの運用目標 */
export const TARGET_AVERAGE_SCORE = 80;
export const TOPIC_MIN_ACCURACY = 0.6;
export const REQUIRED_TOTAL_QUESTIONS = 300;
export const REQUIRED_TIMED_MOCKS = 2;
export const RECENT_WINDOW = 20;
/** 科目別正答率を判定に使うのに必要な最低問題数。3問で100%を「得意」と呼ばない */
export const TOPIC_MIN_SAMPLE = 10;

export function scoreOf(exam: Pick<MockExam, 'correctCount'>): number {
  return exam.correctCount * POINTS_PER_QUESTION;
}

export function scored(attempts: QuestionAttempt[]): QuestionAttempt[] {
  return attempts.filter((a) => a.scored);
}

export type TopicStat = {
  topicId: TopicId;
  total: number;
  correct: number;
  /** 累計正答率。total が 0 なら undefined */
  accuracy?: number;
  recentTotal: number;
  recentCorrect: number;
  recentAccuracy?: number;
  lastAttemptedOn?: IsoDate;
  daysSinceLast?: number;
  /** 自信度の平均(1〜3)。低いほど当てずっぽう */
  averageConfidence?: number;
  started: boolean;
  /** 判定に足る問題数があるか */
  hasSample: boolean;
  meetsMinimum: boolean;
};

export function topicStats(
  attempts: QuestionAttempt[],
  topicIds: TopicId[],
  today: IsoDate = todayJst(),
): TopicStat[] {
  const all = scored(attempts);
  return topicIds.map((topicId) => {
    const mine = all
      .filter((a) => a.topicId === topicId)
      .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1));
    const recent = mine.slice(-RECENT_WINDOW);
    const total = mine.length;
    const correct = mine.filter((a) => a.correct).length;
    const recentCorrect = recent.filter((a) => a.correct).length;
    const last = mine[mine.length - 1];
    const accuracy = total > 0 ? correct / total : undefined;
    const hasSample = total >= TOPIC_MIN_SAMPLE;
    return {
      topicId,
      total,
      correct,
      accuracy,
      recentTotal: recent.length,
      recentCorrect,
      recentAccuracy: recent.length > 0 ? recentCorrect / recent.length : undefined,
      lastAttemptedOn: last?.jstDate,
      daysSinceLast: last ? diffDays(last.jstDate, today) : undefined,
      averageConfidence:
        total > 0 ? mine.reduce((s, a) => s + a.confidence, 0) / total : undefined,
      started: total > 0,
      hasSample,
      // 判定に足るサンプルが無いうちは「達成」と言わない
      meetsMinimum: hasSample && (accuracy ?? 0) >= TOPIC_MIN_ACCURACY,
    };
  });
}

// ---------------------------------------------------------------------------
// 復習キュー
// ---------------------------------------------------------------------------

export type ReviewReason = 'wrong' | 'low-confidence' | 'stale-weak';

export type ReviewItem = {
  attempt: QuestionAttempt;
  reason: ReviewReason;
  /** 小さいほど先に出す */
  priority: number;
};

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  wrong: '誤答',
  'low-confidence': '自信の低い正解',
  'stale-weak': '放置している弱点',
};

/**
 * 復習キュー(FR-009)。
 * 誤答だけでなく「自信の低い正解」を同じ重みで拾う。まぐれ当たりは次に落ちる。
 */
export function reviewQueue(
  attempts: QuestionAttempt[],
  stats: TopicStat[],
  limit = 30,
): ReviewItem[] {
  const weakTopics = new Set(
    stats.filter((s) => s.started && (s.recentAccuracy ?? 1) < TOPIC_MIN_ACCURACY).map((s) => s.topicId),
  );

  const items: ReviewItem[] = [];
  for (const a of scored(attempts)) {
    if (a.reviewedAt) continue;
    if (!a.correct) items.push({ attempt: a, reason: 'wrong', priority: 0 });
    else if (a.confidence <= 2) items.push({ attempt: a, reason: 'low-confidence', priority: 1 });
    else if (weakTopics.has(a.topicId)) items.push({ attempt: a, reason: 'stale-weak', priority: 2 });
  }

  return items
    .sort(
      (x, y) =>
        x.priority - y.priority ||
        (x.attempt.attemptedAt < y.attempt.attemptedAt ? -1 : 1),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 模試
// ---------------------------------------------------------------------------

export function mocks(exams: MockExam[]): MockExam[] {
  return exams
    .filter((e) => e.kind === 'mock-50')
    .sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
}

/** 直近 n 回の平均点。回数が足りなければ undefined(足りない平均で通さない) */
export function recentAverageScore(exams: MockExam[], n = 3): number | undefined {
  const list = mocks(exams).slice(-n);
  if (list.length < n) return undefined;
  return list.reduce((s, e) => s + scoreOf(e), 0) / n;
}

export function lowestRecentScore(exams: MockExam[], n = 3): number | undefined {
  const list = mocks(exams).slice(-n);
  if (list.length === 0) return undefined;
  return Math.min(...list.map(scoreOf));
}

export function timedMockCount(exams: MockExam[]): number {
  return mocks(exams).filter((e) => e.timed).length;
}

/** 模試のあとに出す「次までに直す上位3つ」(FR-010) */
export function topWeaknesses(
  attempts: QuestionAttempt[],
  examId: string,
  stats: TopicStat[],
  limit = 3,
): { topicId: TopicId; wrong: number; accuracy?: number }[] {
  const mine = scored(attempts).filter((a) => a.examId === examId);
  const byTopic = new Map<TopicId, number>();
  for (const a of mine) {
    if (!a.correct) byTopic.set(a.topicId, (byTopic.get(a.topicId) ?? 0) + 1);
  }
  return [...byTopic.entries()]
    .map(([topicId, wrong]) => ({
      topicId,
      wrong,
      accuracy: stats.find((s) => s.topicId === topicId)?.accuracy,
    }))
    .sort((a, b) => b.wrong - a.wrong || (a.accuracy ?? 1) - (b.accuracy ?? 1))
    .slice(0, limit);
}

export const ERROR_REASON_LABEL: Record<ErrorReason, string> = {
  knowledge: '知識',
  calculation: '計算',
  reading: '読解',
  symbol: '図記号',
  law: '法令',
  time: '時間',
  other: 'その他',
};

// ---------------------------------------------------------------------------
// 学科ゲート(FR-013)
// ---------------------------------------------------------------------------

export type GateCriterion = {
  id: string;
  label: string;
  passed: boolean;
  /** 「何をどこまでやったか」を数字で見せる。%だけ出さない */
  evidence: string;
  official: boolean;
};

export type AcademicGate = {
  criteria: GateCriterion[];
  passedCount: number;
  total: number;
  passed: boolean;
};

export function academicGate(
  attempts: QuestionAttempt[],
  exams: MockExam[],
  stats: TopicStat[],
  options: { requiredTotal?: number } = {},
): AcademicGate {
  const requiredTotal = options.requiredTotal ?? REQUIRED_TOTAL_QUESTIONS;
  const total = scored(attempts).length;
  const started = stats.filter((s) => s.started).length;
  const avg = recentAverageScore(exams, 3);
  const timed = timedMockCount(exams);
  const belowMinimum = stats.filter((s) => s.started && !s.meetsMinimum);
  const noSample = stats.filter((s) => s.started && !s.hasSample);

  const criteria: GateCriterion[] = [
    {
      id: 'all-topics-started',
      label: '7科目すべてに着手',
      passed: started === stats.length,
      evidence: `${started} / ${stats.length} 科目`,
      official: false,
    },
    {
      id: 'total-questions',
      label: `累計${requiredTotal}問`,
      passed: total >= requiredTotal,
      evidence: `${total} 問`,
      official: false,
    },
    {
      id: 'recent-average',
      label: `直近3模試の平均${TARGET_AVERAGE_SCORE}点`,
      passed: avg !== undefined && avg >= TARGET_AVERAGE_SCORE,
      evidence:
        avg === undefined
          ? `50問模試が${mocks(exams).length}回(3回必要)`
          : `平均 ${avg.toFixed(1)}点 / 最低回 ${lowestRecentScore(exams, 3)}点`,
      official: false,
    },
    {
      id: 'per-topic',
      label: `各科目${Math.round(TOPIC_MIN_ACCURACY * 100)}%以上`,
      passed: belowMinimum.length === 0 && noSample.length === 0 && started === stats.length,
      evidence:
        belowMinimum.length > 0
          ? `未達 ${belowMinimum.length}科目`
          : noSample.length > 0
            ? `${noSample.length}科目が${TOPIC_MIN_SAMPLE}問未満で判定不能`
            : '全科目クリア',
      official: false,
    },
    {
      id: 'timed-mocks',
      label: `120分の本番同様模試を${REQUIRED_TIMED_MOCKS}回以上`,
      passed: timed >= REQUIRED_TIMED_MOCKS,
      evidence: `${timed} 回`,
      official: false,
    },
  ];

  const passedCount = criteria.filter((c) => c.passed).length;
  return { criteria, passedCount, total: criteria.length, passed: passedCount === criteria.length };
}

/** 公式基準を満たしているか(60点)。運用目標とは別に必ず見せる */
export function meetsOfficialStandard(exams: MockExam[]): boolean {
  const last = mocks(exams).slice(-1)[0];
  return last !== undefined && scoreOf(last) >= OFFICIAL_PASS_SCORE;
}

export type ExamInput = {
  kind: MockExam['kind'];
  label: string;
  timed: boolean;
  minutes?: number;
  note?: string;
  /** 1問ずつの記録 */
  questions: {
    topicId: TopicId;
    correct: boolean;
    confidence: 1 | 2 | 3;
    errorReason?: ErrorReason;
    questionRef?: string;
  }[];
};

/** 入力から MockExam と QuestionAttempt を組み立てる(純関数。保存は repo 側) */
export function buildExamRecords(
  input: ExamInput,
  ids: { examId: string; attemptId: (i: number) => string },
  at: IsoDateTime,
  jstDate: IsoDate,
): { exam: MockExam; attempts: QuestionAttempt[] } {
  const correctCount = input.questions.filter((q) => q.correct).length;
  const exam: MockExam = {
    id: ids.examId,
    takenAt: at,
    jstDate,
    kind: input.kind,
    label: input.label,
    totalQuestions: input.questions.length,
    correctCount,
    minutes: input.minutes,
    timed: input.timed,
    note: input.note,
    updatedAt: at,
  };
  const attempts: QuestionAttempt[] = input.questions.map((q, i) => ({
    id: ids.attemptId(i),
    attemptedAt: at,
    jstDate,
    source: input.label,
    questionRef: q.questionRef ?? `${input.label} 第${i + 1}問`,
    topicId: q.topicId,
    correct: q.correct,
    confidence: q.confidence,
    errorReason: q.correct ? undefined : q.errorReason,
    scored: true,
    examId: ids.examId,
    updatedAt: at,
  }));
  return { exam, attempts };
}
