/**
 * 出題範囲のカバレッジ。**「このツール通りにやれば合格ラインに乗る」を数字にする層**。
 *
 * 「カリキュラムは完了、でも試験範囲のどこを潰したのか分からない」を防ぐ。
 * 学科の合否は科目別の取りこぼしで決まるので、
 * 「レッスンを何本終えたか」ではなく「出題項目を何個押さえたか」で見る。
 *
 * 1項目は次の2つがそろって初めて「押さえた」とする:
 *   (1) その項目を扱うレッスンを完了している(見て・思い出して・解いて・1点残した)
 *   (2) その項目の問題を実際に正解している
 * 動画を見ただけ、あるいは1度も正解していない項目は、押さえたと呼ばない。
 */

import type {
  CurriculumLesson,
  LessonProgress,
  QuestionAttempt,
  QuizQuestion,
  SyllabusItem,
  TopicId,
} from './types';
import { isLessonComplete } from './lessons';
import { IN_APP_SOURCE } from './quiz';

export type SyllabusStatus = {
  item: SyllabusItem;
  /** この項目を扱うレッスン */
  lessonIds: string[];
  /** この項目を確かめる問題 */
  questionIds: string[];
  taught: boolean;
  /** 1問でも正解したか */
  confirmed: boolean;
  /** 出題した問題のうち正解した数 */
  correct: number;
  attempted: number;
};

export type TopicCoverage = {
  topicId: TopicId;
  items: SyllabusStatus[];
  /** 押さえた項目の重み合計 ÷ その科目の重み合計 */
  ratio: number;
  /** 学科50問中のこの科目の重み */
  weight: number;
  taughtCount: number;
  confirmedCount: number;
};

/** 出題項目 → それを扱うレッスン。lesson.practice が出す問題の syllabusIds から引く */
export function lessonsBySyllabus(
  lessons: CurriculumLesson[],
  questions: QuizQuestion[],
): Map<string, string[]> {
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const map = new Map<string, string[]>();
  for (const lesson of lessons) {
    for (const id of lesson.practice.questionIds ?? []) {
      const q = questionById.get(id);
      if (!q) continue;
      for (const s of q.syllabusIds) {
        const list = map.get(s) ?? [];
        if (!list.includes(lesson.id)) list.push(lesson.id);
        map.set(s, list);
      }
    }
  }
  return map;
}

export function questionsBySyllabus(questions: QuizQuestion[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const q of questions) {
    for (const s of q.syllabusIds) {
      map.set(s, [...(map.get(s) ?? []), q.id]);
    }
  }
  return map;
}

export function syllabusStatus(
  syllabus: SyllabusItem[],
  lessons: CurriculumLesson[],
  questions: QuizQuestion[],
  progress: Record<string, LessonProgress>,
  attempts: QuestionAttempt[],
): SyllabusStatus[] {
  const byLesson = lessonsBySyllabus(lessons, questions);
  const byQuestion = questionsBySyllabus(questions);
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  // アプリ内出題の記録は questionRef に問題IDが入っている
  const inApp = attempts.filter((a) => a.scored && a.source === IN_APP_SOURCE);

  return syllabus.map((item) => {
    const lessonIds = byLesson.get(item.id) ?? [];
    const questionIds = byQuestion.get(item.id) ?? [];
    const taught = lessonIds.some((id) => {
      const lesson = lessonById.get(id);
      return lesson !== undefined && isLessonComplete(lesson, progress[id]);
    });
    const mine = inApp.filter((a) => questionIds.includes(a.questionRef));
    const correct = new Set(mine.filter((a) => a.correct).map((a) => a.questionRef)).size;
    return {
      item,
      lessonIds,
      questionIds,
      taught,
      confirmed: correct > 0,
      correct,
      attempted: new Set(mine.map((a) => a.questionRef)).size,
    };
  });
}

export function topicCoverage(statuses: SyllabusStatus[], topicIds: TopicId[]): TopicCoverage[] {
  return topicIds.map((topicId) => {
    const items = statuses.filter((s) => s.item.topicId === topicId);
    const weight = items.reduce((n, s) => n + s.item.weight, 0);
    // 「教わった」だけでも「正解した」だけでも半分。両方そろって1つぶん
    const earned = items.reduce(
      (n, s) => n + s.item.weight * ((s.taught ? 0.5 : 0) + (s.confirmed ? 0.5 : 0)),
      0,
    );
    return {
      topicId,
      items,
      weight,
      ratio: weight === 0 ? 0 : earned / weight,
      taughtCount: items.filter((s) => s.taught).length,
      confirmedCount: items.filter((s) => s.confirmed).length,
    };
  });
}

/**
 * 全体のカバレッジ。**学科50問の重みで加重する**。
 * 項目数で平均すると、配線図(50問中20問)と法令(4問)が同じ重さになり、
 * 「範囲は8割終わった、でも配線図が空」でも高い数字が出てしまう。
 */
export function overallCoverage(coverage: TopicCoverage[]): number {
  const weight = coverage.reduce((n, c) => n + c.weight, 0);
  if (weight === 0) return 0;
  return coverage.reduce((n, c) => n + c.ratio * c.weight, 0) / weight;
}

/**
 * 次に埋めるべき穴。**重みが大きく、まだ確かめていない項目から**返す。
 * 「まだ習っていない」より「習ったのに正解していない」を先に出す。
 * 後者は今日すぐ取り返せるのに、放っておくと本番で落とす。
 */
export function coverageGaps(statuses: SyllabusStatus[], limit = 5): SyllabusStatus[] {
  return statuses
    .filter((s) => !s.taught || !s.confirmed)
    .sort((a, b) => {
      const rank = (s: SyllabusStatus) => (s.taught && !s.confirmed ? 0 : 1);
      return rank(a) - rank(b) || b.item.weight - a.item.weight;
    })
    .slice(0, limit);
}
