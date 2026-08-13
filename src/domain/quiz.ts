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

export function isCorrect(question: QuizQuestion, answer: QuizAnswer): boolean {
  return answer.choiceIndex === question.answerIndex;
}

export function grade(questions: QuizQuestion[], answers: QuizAnswer[]): QuizResult[] {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  return questions
    .map((question) => {
      const answer = byId.get(question.id);
      if (!answer) return undefined;
      return { question, answer, correct: isCorrect(question, answer) };
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
  const inApp = attempts
    .filter((a) => a.source === IN_APP_SOURCE && a.scored)
    .sort((a, b) => (a.attemptedAt < b.attemptedAt ? 1 : -1));

  const wrongIds: string[] = [];
  const unsureIds: string[] = [];
  const seen = new Set<string>();
  for (const a of inApp) {
    if (seen.has(a.questionRef)) continue;
    seen.add(a.questionRef);
    if (!a.correct) wrongIds.push(a.questionRef);
    else if (a.confidence <= 2) unsureIds.push(a.questionRef);
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
