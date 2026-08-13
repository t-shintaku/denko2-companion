/**
 * アプリ内出題(FR-010 P1)。**「まず見る」で見た内容だけを出す**ための層。
 *
 * なぜ要るか: 以前の「手を動かす」は全部が外部サイトへの誘導で、戻ってきて
 * 正答数を自己申告する形だった。何を間違えたかが残らないので、
 * 復習キューにも科目別成績にも実質つながらず、「動画を見た記録」に近かった。
 * ここで1問ずつ採点して QuestionAttempt を作ると、そのまま準備度と復習へ流れる。
 *
 * 過去問の本文は収録しない。バンクにあるのは自作問題だけ(QuizQuestion.origin)。
 */

import type { QuestionAttempt, QuizQuestion, TopicId } from './types';

/** アプリ内出題を記録するときの出典名。外部教材の記録と区別できるようにする */
export const IN_APP_SOURCE = 'アプリ内問題';

/**
 * 1問の答え。
 *
 * 自信は**必ず本人に選ばせる**。既定値を「自信あり」にすると復習キューが空になり、
 * 「まぐれ当たりを次に落とす」対策が効かなくなる。逆に既定を低くすると
 * 正解した問題まで全部キューへ入って、何を直せばいいのか分からなくなる。
 */
export type QuizAnswer = {
  questionId: string;
  /** 選んだ選択肢。時間切れ等で未選択なら undefined(誤答として扱う) */
  choiceIndex?: number;
  /** 迷わず選べたか。false は「あやふや」 */
  sure: boolean;
  seconds?: number;
};

export type QuizResult = {
  question: QuizQuestion;
  answer: QuizAnswer;
  correct: boolean;
};

/**
 * 画面へ出す形。**選択肢を毎回並べ替える。**
 *
 * バンクの JSON は正解を先頭(answerIndex 0)に書いてある。編集しやすいからだが、
 * そのまま出すと**一番上を選び続けるだけで全問正解**になり、演習として成立しない。
 * 並べ替えは出題のたびに行い、正解の位置を追従させる。
 * 採点はこの `answerIndex`(並べ替え後)で行う。
 */
export type PresentedQuestion = {
  question: QuizQuestion;
  choices: string[];
  answerIndex: number;
};

/** Fisher–Yates。rng を差し替えられるようにしてテストで並びを固定する */
export function presentQuestion(
  question: QuizQuestion,
  rng: () => number = Math.random,
): PresentedQuestion {
  const order = question.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return {
    question,
    choices: order.map((i) => question.choices[i]!),
    answerIndex: order.indexOf(question.answerIndex),
  };
}

export function present(
  questions: QuizQuestion[],
  rng: () => number = Math.random,
): PresentedQuestion[] {
  return questions.map((q) => presentQuestion(q, rng));
}

export function isCorrect(presented: PresentedQuestion, answer: QuizAnswer): boolean {
  return answer.choiceIndex === presented.answerIndex;
}

export function grade(presented: PresentedQuestion[], answers: QuizAnswer[]): QuizResult[] {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  return presented
    .map((p) => {
      const answer = byId.get(p.question.id);
      if (!answer) return undefined;
      return { question: p.question, answer, correct: isCorrect(p, answer) };
    })
    .filter((x): x is QuizResult => x !== undefined);
}

export function correctCount(results: QuizResult[]): number {
  return results.filter((r) => r.correct).length;
}

/**
 * 記録用の1問ぶんへ変換する(純関数。保存は repo 側)。
 *
 * 自信は 3(バッチリ) / 1(あやふや)。誤答は必ず 1 にする。
 * 「間違えたが自信はあった」を残しても復習の優先度は変わらないうえ、
 * 平均自信度が実態より高く出て、科目の見え方を歪める。
 */
export function toAttemptInput(result: QuizResult): {
  topicId: TopicId;
  correct: boolean;
  confidence: QuestionAttempt['confidence'];
  questionRef: string;
  seconds?: number;
} {
  return {
    topicId: result.question.topicId,
    correct: result.correct,
    confidence: result.correct ? (result.answer.sure ? 3 : 1) : 1,
    questionRef: result.question.id,
    seconds: result.answer.seconds,
  };
}

// ---------------------------------------------------------------------------
// 動的出題(誤答潰し・弱点補強)
// ---------------------------------------------------------------------------

/**
 * 直前期の「誤答上位を潰す」を、固定の問題番号ではなく記録から組む。
 *
 * 優先順:
 * 1. アプリ内で落とした問題(新しい誤答が先)
 * 2. アプリ内で当てたが「あやふや」だった問題
 * 3. 誤答が出ている科目の、まだ解いていない問題
 *
 * 3 を入れているのは、外部の過去問で落とした科目がアプリ内では未着手のことがあるため。
 * ここが無いと、公式50問で配線図を10問落としても、この画面には1問も出ない。
 */
export function pickMistakes(
  bank: QuizQuestion[],
  attempts: QuestionAttempt[],
  limit: number,
): QuizQuestion[] {
  // 学科タブで解き直した記録は、元の正誤を上書きせず review 情報として残る。
  // attemptedAt だけを見ると、リベンジ成功後も元の誤答を即座に出し直してしまうため、
  // 各記録の最新イベント（初回回答または解き直し）を現在の結果として扱う。
  const inApp = attempts
    .filter((a) => a.source === IN_APP_SOURCE && a.scored)
    .map((attempt) => ({
      attempt,
      at: attempt.reviewedAt ?? attempt.attemptedAt,
      correct: attempt.reviewedAt
        ? (attempt.lastReviewCorrect ?? attempt.correct)
        : attempt.correct,
      confidence: attempt.reviewedAt && attempt.lastReviewCorrect ? 3 : attempt.confidence,
    }))
    .sort(
      (a, b) =>
        b.at.localeCompare(a.at) ||
        Number(Boolean(a.attempt.reviewedAt)) - Number(Boolean(b.attempt.reviewedAt)) ||
        b.attempt.id.localeCompare(a.attempt.id),
    );

  const wrongIds: string[] = [];
  const unsureIds: string[] = [];
  const seen = new Set<string>();
  for (const state of inApp) {
    const ref = state.attempt.questionRef;
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!state.correct) wrongIds.push(ref);
    else if (state.confidence <= 2) unsureIds.push(ref);
  }

  const byId = new Map(bank.map((qq) => [qq.id, qq]));
  const picked: QuizQuestion[] = [];
  const take = (id: string) => {
    const qq = byId.get(id);
    if (qq && !picked.some((p) => p.id === qq.id)) picked.push(qq);
  };
  for (const id of wrongIds) {
    if (picked.length >= limit) break;
    take(id);
  }
  for (const id of unsureIds) {
    if (picked.length >= limit) break;
    take(id);
  }
  if (picked.length < limit) {
    // 誤答が出ている科目を、誤答の多い順に
    const wrongByTopic = new Map<TopicId, number>();
    for (const a of attempts) {
      if (!a.scored || a.correct) continue;
      wrongByTopic.set(a.topicId, (wrongByTopic.get(a.topicId) ?? 0) + 1);
    }
    const order = [...wrongByTopic.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t);
    for (const topicId of order) {
      for (const qq of bank) {
        if (picked.length >= limit) break;
        if (qq.topicId !== topicId) continue;
        if (seen.has(qq.id)) continue;
        take(qq.id);
      }
    }
  }
  return picked.slice(0, limit);
}

/**
 * いちばん弱い科目から出す。判定に足るサンプルが無い科目は「弱い」と決めつけない。
 * 未着手の科目があるときは、そこを先に埋める(0問の科目はゲートを永久に閉じる)。
 */
export function pickWeakTopic(
  bank: QuizQuestion[],
  attempts: QuestionAttempt[],
  topicIds: TopicId[],
  limit: number,
): QuizQuestion[] {
  const scoredAttempts = attempts.filter((a) => a.scored);
  const rate = (topicId: TopicId): { total: number; accuracy: number } => {
    const mine = scoredAttempts.filter((a) => a.topicId === topicId);
    return {
      total: mine.length,
      accuracy: mine.length === 0 ? 0 : mine.filter((a) => a.correct).length / mine.length,
    };
  };
  const ranked = [...topicIds].sort((x, y) => {
    const a = rate(x);
    const b = rate(y);
    // 未着手を最優先、次に正答率の低い順
    if (a.total === 0 && b.total !== 0) return -1;
    if (b.total === 0 && a.total !== 0) return 1;
    return a.accuracy - b.accuracy;
  });

  const answered = new Set(
    scoredAttempts.filter((a) => a.source === IN_APP_SOURCE).map((a) => a.questionRef),
  );
  const picked: QuizQuestion[] = [];
  // まだ解いていない問題を優先し、足りなければ解いた問題も戻す
  for (const pass of [0, 1]) {
    for (const topicId of ranked) {
      for (const qq of bank) {
        if (picked.length >= limit) return picked;
        if (qq.topicId !== topicId) continue;
        if (pass === 0 && answered.has(qq.id)) continue;
        if (picked.some((p) => p.id === qq.id)) continue;
        picked.push(qq);
      }
    }
  }
  return picked.slice(0, limit);
}
