/**
 * 「伸びているか」を数字にする(FR-014 のうち、レベルやXPより先に要るもの)。
 *
 * ここで出すのは3つだけ:
 *   1. 言った時間で終わったか(予定と実績の差)
 *   2. 昨日より進んだか(今週の学習日数・完了数)
 *   3. 間違えた箇所が本当に減ったか(模試の推移・科目の直近変化・復習で解けた数・技能の欠陥と時間)
 *
 * XP やレベルを先に増やさない。数字が実態とずれたまま増えるバッジは、
 * 3日で「どうせ増えるだけ」になり、その時点でこのツール全体が信用を失う。
 * 連続日数も数えない(FR-014: 空白期間を罰しない)。数えるのは戻ってきた回数。
 */

import { addDays, diffDays, jstWeekday, todayJst } from './jst';
import { mocks, scoreOf, scored } from './academic';
import { attemptMinutes, candidateAttempts } from './practical';
import type {
  IsoDate,
  MockExam,
  QuestionAttempt,
  SkillAttempt,
  StudySession,
  TopicId,
} from './types';

/** 週の始まりは月曜。日曜だけ学習した週を「2週にまたがった」と見せない */
export function startOfWeek(date: IsoDate): IsoDate {
  const w = jstWeekday(date); // 0=日
  const back = w === 0 ? 6 : w - 1;
  return addDays(date, -back);
}

export type WeekSummary = {
  /** 学習した日数(0〜7)。連続である必要はない */
  days: number;
  minutes: number;
  /** 先週との差。先週が0でも比較する */
  daysDelta: number;
  minutesDelta: number;
};

export function weekSummary(
  sessions: StudySession[],
  today: IsoDate = todayJst(),
): WeekSummary {
  const thisStart = startOfWeek(today);
  const lastStart = addDays(thisStart, -7);

  const inRange = (from: IsoDate, to: IsoDate) =>
    sessions.filter((s) => s.jstDate >= from && s.jstDate <= to);

  const thisWeek = inRange(thisStart, today);
  // 先週は同じ曜日までで比べる。週の途中で「先週より少ない」と言わないため
  const lastWeek = inRange(lastStart, addDays(lastStart, diffDays(thisStart, today)));

  const days = (list: StudySession[]) => new Set(list.map((s) => s.jstDate)).size;
  const minutes = (list: StudySession[]) => list.reduce((n, s) => n + s.durationMinutes, 0);

  return {
    days: days(thisWeek),
    minutes: minutes(thisWeek),
    daysDelta: days(thisWeek) - days(lastWeek),
    minutesDelta: minutes(thisWeek) - minutes(lastWeek),
  };
}

/**
 * 戻ってきた回数。3日以上空けてから再開した回数を数える。
 * 連続日数の代わりに置く指標(FR-014「空白期間を罰しない」)。
 * 途切れたことではなく、そのたびに戻ってきたことを数える。
 */
export function comebackCount(sessions: StudySession[], gapDays = 3): number {
  const days = [...new Set(sessions.map((s) => s.jstDate))].sort();
  let n = 0;
  for (let i = 1; i < days.length; i += 1) {
    if (diffDays(days[i - 1]!, days[i]!) >= gapDays) n += 1;
  }
  return n;
}

export type MockTrend = {
  scores: { date: IsoDate; label: string; score: number; timed: boolean }[];
  latest?: number;
  previous?: number;
  /** 前回との差。前回が無ければ undefined */
  delta?: number;
  best?: number;
};

export function mockTrend(exams: MockExam[]): MockTrend {
  const list = mocks(exams);
  const scores = list.map((e) => ({
    date: e.jstDate,
    label: e.label,
    score: scoreOf(e),
    timed: e.timed,
  }));
  const latest = scores[scores.length - 1]?.score;
  const previous = scores[scores.length - 2]?.score;
  return {
    scores,
    latest,
    previous,
    delta: latest !== undefined && previous !== undefined ? latest - previous : undefined,
    best: scores.length > 0 ? Math.max(...scores.map((s) => s.score)) : undefined,
  };
}

export type ReviewProgress = {
  /** 復習で解き直して正解できた問題数 */
  solved: number;
  /** まだ解き直していない、または解けなかった問題数 */
  pending: number;
  /** 4回の間隔をすべて通過した問題数 */
  graduated: number;
};

/**
 * 「間違えた箇所が本当に減った」の証拠。
 * 誤答・低自信だった問題のうち、解き直して解けたものを数える。
 */
export function reviewProgress(attempts: QuestionAttempt[]): ReviewProgress {
  const targets = scored(attempts).filter((a) => !a.correct || a.confidence <= 2);
  const solved = targets.filter((a) => a.lastReviewCorrect === true).length;
  const graduated = targets.filter(
    (a) => a.lastReviewCorrect === true && a.reviewedAt !== undefined && !a.nextReviewOn,
  ).length;
  return { solved, pending: targets.length - solved, graduated };
}

export type SkillTrend = {
  /** 直近3作品の合計時間(複線図込み) */
  recentMinutes: number[];
  /** その前の3作品 */
  earlierMinutes: number[];
  /** 平均の差(マイナスなら速くなっている) */
  minutesDelta?: number;
  /** 直近5作品の欠陥件数 */
  recentDefects: number;
  earlierDefects: number;
  defectsDelta?: number;
  attempts: number;
};

export function skillTrend(attempts: SkillAttempt[]): SkillTrend {
  const list = candidateAttempts(attempts);
  const recent = list.slice(-3);
  const earlier = list.slice(-6, -3);
  const avg = (xs: number[]) => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);

  const recentMinutes = recent.map(attemptMinutes);
  const earlierMinutes = earlier.map(attemptMinutes);
  const r = avg(recentMinutes);
  const e = avg(earlierMinutes);

  const recent5 = list.slice(-5);
  const earlier5 = list.slice(-10, -5);
  const defects = (xs: SkillAttempt[]) => xs.reduce((n, a) => n + a.defectCodes.length, 0);

  return {
    recentMinutes,
    earlierMinutes,
    minutesDelta: r !== undefined && e !== undefined ? r - e : undefined,
    recentDefects: defects(recent5),
    earlierDefects: defects(earlier5),
    defectsDelta: earlier5.length > 0 ? defects(recent5) - defects(earlier5) : undefined,
    attempts: list.length,
  };
}

/**
 * 見積と実績の差。「言った時間で終わる」を検証する唯一の指標。
 * ここが大きくずれている間は、時間の提示そのものを信じてはいけない。
 */
export function estimateAccuracy(
  sessions: StudySession[],
  n = 10,
): { samples: number; estimated: number; actual: number; ratio?: number } {
  const withEstimate = sessions
    .filter((s) => s.estimatedMinutes !== undefined && s.estimatedMinutes > 0)
    .slice(-n);
  const estimated = withEstimate.reduce((x, s) => x + (s.estimatedMinutes ?? 0), 0);
  const actual = withEstimate.reduce((x, s) => x + s.durationMinutes, 0);
  return {
    samples: withEstimate.length,
    estimated,
    actual,
    ratio: estimated > 0 ? actual / estimated : undefined,
  };
}

export type TopicMove = { topicId: TopicId; recent: number; before: number; delta: number };

/** 科目別の直近変化。伸びた順に返す(下がったものも隠さない) */
export function topicMoves(
  attempts: QuestionAttempt[],
  topicIds: TopicId[],
  window = 20,
  minSample = 10,
): TopicMove[] {
  const out: TopicMove[] = [];
  for (const topicId of topicIds) {
    const mine = scored(attempts)
      .filter((a) => a.topicId === topicId)
      .sort((a, b) => (a.attemptedAt < b.attemptedAt ? -1 : 1));
    if (mine.length < minSample * 2) continue;
    const recent = mine.slice(-window);
    const before = mine.slice(0, -recent.length);
    if (before.length < minSample) continue;
    const rate = (list: QuestionAttempt[]) => list.filter((a) => a.correct).length / list.length;
    const r = rate(recent);
    const b = rate(before);
    out.push({ topicId, recent: r, before: b, delta: r - b });
  }
  return out.sort((a, b) => b.delta - a.delta);
}
