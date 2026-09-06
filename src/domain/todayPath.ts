/**
 * 「今日やること」を**順番の付いた1本道**にする。
 *
 * なぜ要るか(2026-09-06 本人の指摘):
 * > いろいろメニューみたいなのがあるのはいいんだけど、どれから始めたらいいのかがよく分からない。
 * > まずはこの教材を見て、その復習問題。みたいな、何も考えずにツールの通りにやっていったら
 * > 自然と知識が身についている、みたいなのが理想。
 *
 * 判断材料(次に何をやるか)は `quests.ts` の `nextTenMinutes` と
 * `studyCoach.ts` の `dailyPractice` が既に持っている。**足りないのは順番の提示**だった。
 * ホームに入口が3つ(コーチのボタン・クエスト開始・公式トレーニング)並び、
 * その周りに数字のカードが9枚あったので、どれが「今日の1歩目」か画面から読めなかった。
 *
 * 規則(ここを崩さないこと):
 *
 * 1. **問題を先に出さない。** 復習を道のりへ載せるのは `dailyPractice` が
 *    「教材を見たレッスンの問題」を返したときだけ。知識ゼロの人へ初手で問題を出さない。
 * 2. **忘れかけを先に、新しいことを後に。** 期日が来た問題があればそれが1番、無ければ教材が1番。
 * 3. **今やる1件にしかボタンを出さない。** 先の段階は見えるが押せない。迷いを画面から消す。
 * 4. **1件やれば今日は勝ち。** 続きは任意。ここは既存の設計(1件でクリア)を引き継ぐ。
 */

import type { Quest } from './quests';
import type { IsoDate, StudySession } from './types';

export type TodayStepKind = 'review' | 'lesson' | 'official';

export type TodayStep = {
  kind: TodayStepKind;
  /** 何をするかが、この1行だけで分かること */
  title: string;
  /** どこまでやれば終わりか。「ここまでで今日はクリア」まで書く */
  detail: string;
  /** この一手の目安(分)。レッスン全体ではない */
  minutes: number;
  /**
   * 見積と実際のズレを隠さないための一言。
   * 「10分」と書いて60分渡すのが一番効く嘘なので、収まらない日はそう書く。
   */
  note?: string;
  /** 今日すでに済ませたか */
  done: boolean;
};

export type TodayPathInput = {
  today: IsoDate;
  sessions: StudySession[];
  /** 今日出せる復習問題(dailyPractice の結果の件数) */
  practiceCount: number;
  /** そのうち期日が来ているもの。1件でもあれば復習が先 */
  dueCount: number;
  /** 次の一手(nextTenMinutes 由来)。レッスンが尽きていれば undefined */
  quest?: Quest;
  /** レッスンも復習も無いとき、公式問題へ送ってよい段階か */
  officialReady: boolean;
};

export type TodayPath = {
  steps: TodayStep[];
  /** 今やる1件。全部済んでいれば undefined */
  currentIndex?: number;
  /** 今日ぶんを1件以上こなしたか(1件でクリア) */
  clearedToday: boolean;
};

export function buildTodayPath(input: TodayPathInput): TodayPath {
  const { today, sessions, practiceCount, dueCount, quest, officialReady } = input;
  const todaysSessions = sessions.filter((s) => s.jstDate === today);
  const reviewDone = todaysSessions.some((s) => s.kind === 'review');
  const lessonDone = quest?.lessonId
    ? todaysSessions.some((s) => s.lessonId === quest.lessonId)
    : false;
  const officialDone = todaysSessions.some((s) => s.kind === 'mock');

  const review: TodayStep | undefined =
    practiceCount > 0
      ? {
          kind: 'review',
          title: `習ったところから ${practiceCount}問`,
          detail:
            dueCount > 0
              ? '忘れかけを取り戻す。1問ずつ保存されるので、途中でやめても消えない。'
              : '教わったことを、見ないで解けるか確かめる。1問ずつ保存される。',
          minutes: 5,
          done: reviewDone,
        }
      : undefined;

  const lesson: TodayStep | undefined = quest
    ? {
        kind: 'lesson',
        title: quest.title,
        detail: quest.clearCondition,
        minutes: quest.minutes,
        note: !quest.fitsBudget
          ? `この続きは約${quest.minutes}分。今日は途中まででOK。キリのいいところでストップOK！`
          : quest.remainingMinutes !== undefined && quest.remainingMinutes > quest.minutes
            ? `レッスン全体は残り約${quest.remainingMinutes}分。今日はキリのいいところでストップOK！`
            : undefined,
        done: lessonDone,
      }
    : undefined;

  const steps: TodayStep[] = [];
  // 期日が来ているときだけ復習が先。それ以外は「まず教材」を守る
  if (review && dueCount > 0) steps.push(review);
  if (lesson) steps.push(lesson);
  if (review && dueCount === 0) steps.push(review);

  if (steps.length === 0 && officialReady) {
    steps.push({
      kind: 'official',
      title: '公式問題で確かめる',
      detail: 'まずは5問。仕上げは50問・120分。本番の図と写真で解けるかを見る。',
      minutes: 10,
      done: officialDone,
    });
  }

  const currentIndex = steps.findIndex((s) => !s.done);
  return {
    steps,
    currentIndex: currentIndex === -1 ? undefined : currentIndex,
    clearedToday: todaysSessions.some((s) => s.durationMinutes > 0) || steps.some((s) => s.done),
  };
}
