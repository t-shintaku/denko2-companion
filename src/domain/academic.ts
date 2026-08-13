/**
 * 学科の成績・復習キュー・ゲート(FR-009 / FR-010 / FR-013)。
 *
 * 原則:
 * - 公式基準は60点(50問中30問)。80点は本ツールの運用目標。UIで必ず書き分ける。
 * - 平均点で通さない。1科目でも60%未満なら準備完了にしない。
 * - `scored: false`(無採点5問)は一切集計に入れない。
 */

import { addDays, diffDays, todayJst } from './jst';
import { IN_APP_SOURCE } from './quiz';
import type {
  ErrorReason,
  ExamKind,
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
/**
 * 科目別正答率を判定に使うのに必要な問題数。3問で100%を「得意」と呼ばない。
 *
 * **判定窓と同じ20問を要求する。** 10問で足りることにしていたとき、
 * 画面が「各科目 直近20問で60%以上」と書いているのに10問で達成になっていた。
 * 表示より甘い条件で通すのは、合格判断としては嘘に等しい。
 */
export const TOPIC_MIN_SAMPLE = RECENT_WINDOW;

/**
 * 受験区分ごとの問題数。**学科は50問120分**なので、模試の50問は入力チェックではなく
 * 合格判定の前提そのもの。ここが自由だと、80問入力して120点の模試が作れてしまい、
 * 平均80点ゲートも「120分模試2回」も意味を失う。
 * 出典: https://www.shiken.or.jp/construction/second/department/
 */
export const EXAM_QUESTION_COUNT: Record<ExamKind, number | undefined> = {
  'diagnostic-20': 20,
  'mock-50': 50,
  // カテゴリ小テストは問題数が決まっていない
  'topic-quiz': undefined,
};

export const MAX_TOPIC_QUIZ_QUESTIONS = 50;

/** 保存してよい記録か。ドメインで止める(画面をすり抜けても入らないようにする) */
export function validateExamInput(input: ExamInput): string[] {
  const issues: string[] = [];
  const required = EXAM_QUESTION_COUNT[input.kind];
  const n = input.questions.length;

  if (required !== undefined && n !== required) {
    issues.push(
      `${input.kind === 'mock-50' ? '50問模試' : '20問診断'}は${required}問ちょうどで記録する(いまは${n}問)`,
    );
  }
  if (required === undefined && (n < 1 || n > MAX_TOPIC_QUIZ_QUESTIONS)) {
    issues.push(`小テストは1〜${MAX_TOPIC_QUIZ_QUESTIONS}問で記録する(いまは${n}問)`);
  }
  if (input.label.trim() === '') issues.push('出典(年度・期)を書く。あとで推移を追えなくなる');
  if (input.minutes !== undefined && (input.minutes < 1 || input.minutes > 600)) {
    issues.push('所要時間が現実的でない');
  }
  return issues;
}

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
  /** 公式過去問だけの成績。アプリ内の自作問題を混ぜた数字と取り違えさせないために分けて持つ */
  pastExamTotal: number;
  pastExamCorrect: number;
  pastExamAccuracy?: number;
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
    // アプリ内の自作問題と、公式過去問を分けて持つ。
    // 混ぜた1つの数字だけを出すと、易しい自作問題の正解が本番の実力に見える。
    // 判定(meetsMinimum)は従来どおり混ぜたまま。ここは「誤解させない表示」のための材料。
    const pastExam = mine.filter((a) => a.source !== IN_APP_SOURCE);
    const pastExamCorrect = pastExam.filter((a) => a.correct).length;
    const recentCorrect = recent.filter((a) => a.correct).length;
    const last = mine[mine.length - 1];
    const accuracy = total > 0 ? correct / total : undefined;
    const recentAccuracy = recent.length > 0 ? recentCorrect / recent.length : undefined;
    // 判定は直近20問で行う。累計だと、最近崩れても昔の貯金で通り、
    // 最近直しても昔の失点で閉じ続ける。直す努力が数字に出ないと続かない
    const hasSample = recent.length >= TOPIC_MIN_SAMPLE;
    return {
      topicId,
      total,
      correct,
      accuracy,
      recentTotal: recent.length,
      recentCorrect,
      recentAccuracy,
      pastExamTotal: pastExam.length,
      pastExamCorrect,
      pastExamAccuracy: pastExam.length > 0 ? pastExamCorrect / pastExam.length : undefined,
      lastAttemptedOn: last?.jstDate,
      daysSinceLast: last ? diffDays(last.jstDate, today) : undefined,
      averageConfidence:
        total > 0 ? mine.reduce((s, a) => s + a.confidence, 0) / total : undefined,
      started: total > 0,
      hasSample,
      // 判定に足るサンプルが無いうちは「達成」と言わない
      meetsMinimum: hasSample && (recentAccuracy ?? 0) >= TOPIC_MIN_ACCURACY,
    };
  });
}

/**
 * 直近20問と、それ以前の正答率の差。「昨日よりできるようになった」を数字で出すため。
 * どちらかのサンプルが足りなければ undefined(足りない差分で一喜一憂させない)。
 */
export function topicTrend(
  attempts: QuestionAttempt[],
  topicId: TopicId,
): { recent: number; before: number; delta: number } | undefined {
  const mine = scored(attempts)
    .filter((a) => a.topicId === topicId)
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1));
  if (mine.length < TOPIC_MIN_SAMPLE * 2) return undefined;
  const recent = mine.slice(-RECENT_WINDOW);
  const before = mine.slice(0, -recent.length);
  if (before.length < TOPIC_MIN_SAMPLE) return undefined;
  const rate = (list: QuestionAttempt[]) => list.filter((a) => a.correct).length / list.length;
  const r = rate(recent);
  const b = rate(before);
  return { recent: r, before: b, delta: r - b };
}

// ---------------------------------------------------------------------------
// 復習キュー
// ---------------------------------------------------------------------------

export type ReviewReason = 'wrong' | 'low-confidence' | 'stale-weak' | 'spaced';

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
  spaced: '間隔をあけた再確認',
};

/**
 * 解き直したあと、次に戻すまでの日数。忘却に合わせて広げる。
 * 4つの間隔をすべて解ければ卒業(それ以上は出さない)。
 */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14];

/** 弱い科目を「放置している」と見なすまでの日数 */
export const STALE_WEAK_DAYS = 7;
/** 掘り起こしで1科目から入れる最大件数 */
export const STALE_WEAK_PER_TOPIC = 3;

/**
 * 次回の復習日。
 * @param successCount これで何回目の「解けた」か(1始まり)。解けなかったときは無視する
 * 卒業(もう出さない)なら undefined
 */
export function nextReviewDate(
  successCount: number,
  correct: boolean,
  today: IsoDate,
): IsoDate | undefined {
  // 解けなかったら間隔を最初へ戻す。翌日もう一度出す
  if (!correct) return addDays(today, REVIEW_INTERVALS_DAYS[0]!);
  const next = REVIEW_INTERVALS_DAYS[successCount - 1];
  return next === undefined ? undefined : addDays(today, next);
}

/**
 * 復習キュー(FR-009)。
 *
 * 誤答だけでなく「自信の低い正解」を同じ重みで拾う。まぐれ当たりは次に落ちる。
 *
 * **1回解き直したら永久に消える、にはしない。** 1回できたことと覚えたことは違う。
 * 解き直した問題は翌日→3日後→7日後→14日後と戻ってくる。4回続けて解けたら卒業。
 * 途中で解けなければ間隔は翌日へ戻る。
 */
export function reviewQueue(
  attempts: QuestionAttempt[],
  stats: TopicStat[],
  limit = 30,
  today: IsoDate = todayJst(),
): ReviewItem[] {
  /**
   * 「放置している弱点」は**放置しているときだけ**拾う。
   * 弱い科目というだけで正解まで全部入れると、模試を1回入れた瞬間に
   * 50問すべてがキューへ並び、何を直せばいいのか分からなくなる。
   */
  const staleWeakTopics = new Set(
    stats
      .filter(
        (s) =>
          s.started &&
          (s.recentAccuracy ?? 1) < TOPIC_MIN_ACCURACY &&
          (s.daysSinceLast ?? 0) >= STALE_WEAK_DAYS,
      )
      .map((s) => s.topicId),
  );

  const items: ReviewItem[] = [];
  const staleByTopic = new Map<TopicId, number>();
  for (const a of scored(attempts)) {
    if (a.reviewedAt) {
      // 予定日が来たものだけ戻す。予定日が無い(卒業した)ものは出さない
      if (a.nextReviewOn && a.nextReviewOn <= today) {
        items.push({ attempt: a, reason: 'spaced', priority: 1 });
      }
      continue;
    }
    if (!a.correct) items.push({ attempt: a, reason: 'wrong', priority: 0 });
    else if (a.confidence <= 2) items.push({ attempt: a, reason: 'low-confidence', priority: 2 });
    else if (staleWeakTopics.has(a.topicId)) {
      // 科目あたりの上限を設ける。掘り起こしは「思い出す入口」であって総ざらいではない
      const n = staleByTopic.get(a.topicId) ?? 0;
      if (n < STALE_WEAK_PER_TOPIC) {
        staleByTopic.set(a.topicId, n + 1);
        items.push({ attempt: a, reason: 'stale-weak', priority: 3 });
      }
    }
  }

  return items
    .sort(
      (x, y) =>
        x.priority - y.priority ||
        (x.attempt.attemptedAt < y.attempt.attemptedAt ? -1 : 1),
    )
    .slice(0, limit);
}

/** 解き直しの結果を1件分の更新にする(純関数。保存は repo 側) */
export function applyReview(
  attempt: QuestionAttempt,
  correct: boolean,
  at: IsoDateTime,
  today: IsoDate,
): QuestionAttempt {
  const count = correct ? (attempt.reviewCount ?? 0) + 1 : 0;
  return {
    ...attempt,
    reviewedAt: at,
    reviewCount: count,
    lastReviewCorrect: correct,
    nextReviewOn: nextReviewDate(count, correct, today),
    updatedAt: at,
  };
}

// ---------------------------------------------------------------------------
// 模試
// ---------------------------------------------------------------------------

/**
 * 集計に載せてよい行か。**問題数と正答数の両方**を見る。
 *
 * 50問チェックだけだと、旧データや手で書き換えた同期行の「50問・80問正解」が
 * 160点として平均に効く。正答数は 0 以上、問題数以下でなければならない。
 */
export function isSaneExam(e: MockExam): boolean {
  return (
    Number.isFinite(e.correctCount) &&
    Number.isFinite(e.totalQuestions) &&
    e.correctCount >= 0 &&
    e.correctCount <= e.totalQuestions
  );
}

/**
 * 学科ゲートに算入してよい模試。**50問ちょうど、かつ正答数が値域内のものだけ**。
 *
 * 入力側でも弾いているが、集計側でも弾く。片方だけにすると、
 * 検証を入れる前に保存された行や、手で書き換えた同期ファイルの行が
 * そのまま平均点と回数に効く。点数の水増しは受験判断を直接誤らせるので二重に止める。
 */
export function mocks(exams: MockExam[]): MockExam[] {
  return exams
    .filter(
      (e) =>
        e.kind === 'mock-50' &&
        e.totalQuestions === EXAM_QUESTION_COUNT['mock-50'] &&
        isSaneExam(e),
    )
    .sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1));
}

/** 50問でない、または正答数が値域外のため集計から外した模試。画面に理由を出すために数える */
export function excludedMocks(exams: MockExam[]): MockExam[] {
  return exams.filter(
    (e) =>
      e.kind === 'mock-50' &&
      (e.totalQuestions !== EXAM_QUESTION_COUNT['mock-50'] || !isSaneExam(e)),
  );
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

/** 学科の本番時間(分)。50問120分 */
export const ACADEMIC_EXAM_MINUTES = 120;

/**
 * 「本番同様の120分模試」として数えてよい記録か。
 *
 * **時間が記録されていない回は数えない。** チェックを入れるだけで数えていたので、
 * タイマーも使わず時間も空欄の記録2件で「120分模試2回」が通っていた。
 * 本番より長くかかった回も「本番同様」ではない(早く終わるのは構わない)。
 */
export function isTimedMock(e: MockExam): boolean {
  return (
    e.timed === true &&
    typeof e.minutes === 'number' &&
    Number.isFinite(e.minutes) &&
    e.minutes > 0 &&
    e.minutes <= ACADEMIC_EXAM_MINUTES
  );
}

export function timedMockCount(exams: MockExam[]): number {
  return mocks(exams).filter(isTimedMock).length;
}

/** 「本番同様」を選んだのに時間が無い/超過していて数えられない回 */
export function untimedMockCount(exams: MockExam[]): number {
  return mocks(exams).filter((e) => e.timed && !isTimedMock(e)).length;
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
  const untimed = untimedMockCount(exams);
  // 判定に足る問題数がない科目は「未達」ではなく「判定不能」。
  // 10問全問正解を「未達」と呼ぶと、何をすれば通るのかが伝わらない
  const noSample = stats.filter((s) => s.started && !s.hasSample);
  const belowMinimum = stats.filter((s) => s.started && s.hasSample && !s.meetsMinimum);

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
      label: `各科目 直近${RECENT_WINDOW}問で${Math.round(TOPIC_MIN_ACCURACY * 100)}%以上`,
      passed: belowMinimum.length === 0 && noSample.length === 0 && started === stats.length,
      evidence:
        // 未着手の科目があるうちに「全科目クリア」と出さない。0/7で達成表示は嘘になる
        started < stats.length
          ? `未着手 ${stats.length - started}科目`
          : noSample.length > 0
            ? `${noSample.length}科目が直近${TOPIC_MIN_SAMPLE}問未満で判定不能`
            : belowMinimum.length > 0
              ? `未達 ${belowMinimum.length}科目`
              : '全科目クリア',
      official: false,
    },
    {
      id: 'timed-mocks',
      label: `${ACADEMIC_EXAM_MINUTES}分の本番同様模試を${REQUIRED_TIMED_MOCKS}回以上`,
      passed: timed >= REQUIRED_TIMED_MOCKS,
      evidence:
        untimed > 0 ? `${timed} 回(時間未記録で数えない ${untimed}回)` : `${timed} 回`,
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
  const issues = validateExamInput(input);
  if (issues.length > 0) {
    // 画面をすり抜けても記録させない。壊れた点数は復習キューにも科目別成績にも波及する
    throw new Error(`記録できない: ${issues.join(' / ')}`);
  }
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
