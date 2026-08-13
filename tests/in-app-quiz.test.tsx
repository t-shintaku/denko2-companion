/**
 * 【回帰】「まず見る」で見た内容が、そのまま思い出す欄と解く問題になっていること。
 *
 * 以前の壊れ方: 思い出す欄は模範解答のない自由記述、解く欄は外部サイトへの誘導と
 * 正答数の自己申告だった。何を間違えたかがどこにも残らないので、
 * 復習キューにも科目別成績にもつながらず、実質「動画を見た記録」だった。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LessonPage } from '../src/features/curriculum/LessonPage';
import { VaultProvider } from '../src/state/VaultContext';
import { curriculum, questionsFor } from '../src/data';
import { IN_APP_SOURCE } from '../src/domain/quiz';
import { defaultSettings, repo } from '../src/db/repo';
import { fillRecall } from './helpers/recall';

beforeEach(async () => {
  await repo.wipe();
  await repo.saveSettings({
    ...defaultSettings('2026-h2'),
    setupCompletedAt: '2026-08-11T20:00:00+09:00',
  });
});

/** 「オームの法則 — V・I・Rの3つの式」。まず見る=ガミデンキ #5 */
const lesson = curriculum.lessons.find((l) => l.id === 'p0-l2')!;
const bank = questionsFor(lesson.practice.questionIds);

function renderLesson() {
  return render(
    <VaultProvider>
      <LessonPage lesson={lesson} initialMode="standard" onClose={() => {}} />
    </VaultProvider>,
  );
}

/**
 * 出題は同じ選択肢の文言が別の問題にも出る(「電圧」「電流」など)。
 * 画面全体から文言で探すと取り違えるので、必ず問題単位で絞る。
 */
function quizItem(index: number): HTMLElement {
  const items = document.querySelectorAll('.quiz-item');
  return items[index] as HTMLElement;
}

/**
 * index 番目の問題に、**選択肢の本文で**答える。
 * 選択肢は毎回並べ替えられるので、位置(0番目)で指定してはいけない。
 */
async function answerWithText(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  text: string,
) {
  const item = within(quizItem(index));
  const target = item
    .getAllByRole('button', { name: /^(✓ )?(ア|イ|ウ|エ)\./ })
    .find((b) => b.textContent!.includes(text));
  if (!target) throw new Error(`選択肢が見つからない: ${text}`);
  await user.click(target);
}

/** index 番目の問題に正解する */
const answerRight = (
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  q: (typeof bank)[number],
) => answerWithText(user, index, q.choices[q.answerIndex]!);

/** index 番目の問題にわざと間違える */
const answerWrong = (
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  q: (typeof bank)[number],
) => answerWithText(user, index, q.choices[q.answerIndex === 0 ? 1 : 0]!);

/** 正誤の確定(バッチリ / あやふや / リベンジ登録) */
async function settle(user: ReturnType<typeof userEvent.setup>, index: number) {
  const item = within(quizItem(index));
  const sure = item.queryByRole('button', { name: 'バッチリだった' });
  if (sure) await user.click(sure);
  else await user.click(item.getByRole('button', { name: 'リベンジ登録して次へ' }));
}

describe('まず見る教材の表示', () => {
  it('思い出す問いと確認問題の教材を、ヘルプに隠さず先に見せる', () => {
    renderLesson();

    expect(screen.getByText(/思い出す問いと今日の新しい問題は、全部この教材から/)).toBeInTheDocument();
    const primaryCards = document.querySelectorAll('.resource-card--primary');
    expect(primaryCards).toHaveLength(1);
    expect(within(primaryCards[0] as HTMLElement).getByText(/#5 オームの法則/)).toBeInTheDocument();
    expect(screen.getByText(/ヘルプ教材を見る/)).toBeInTheDocument();
  });
});

describe('見ないで思い出す(答え合わせ)', () => {
  it('書くまで模範解答は出ない。書いたら出る', async () => {
    const user = userEvent.setup();
    renderLesson();

    const prompt = lesson.recallPrompts[0]!;
    expect(screen.queryByText(prompt.modelAnswer)).not.toBeInTheDocument();

    const check = screen.getAllByRole('button', { name: '答え合わせ' })[0]!;
    expect(check).toBeDisabled();

    await user.type(screen.getByLabelText(prompt.prompt), 'V=I×R');
    await user.click(screen.getAllByRole('button', { name: '答え合わせ' })[0]!);

    expect(screen.getByText(prompt.modelAnswer)).toBeInTheDocument();
    // どの教材のどこで見た話かを必ず添える
    expect(screen.getByText(new RegExp(prompt.sourceWatch!))).toBeInTheDocument();
  });

  it('自己採点は保存されるが、合格準備度(科目別成績)には入らない', async () => {
    const user = userEvent.setup();
    renderLesson();

    const recallSection = screen
      .getByRole('heading', { name: '2. 見ないで思い出す' })
      .closest('section')!;
    // 1問目だけ「出てこなかった」にして、言い直しリストへ回るか見る
    await fillRecall(user, recallSection, 'おぼえたこと');
    await user.click(within(recallSection).getAllByRole('button', { name: '出てこなかった' })[0]!);
    await user.click(within(recallSection).getByRole('button', { name: 'ここまでを保存' }));

    await waitFor(async () => {
      const saved = (await repo.load()).lessonProgress[lesson.id];
      expect(saved?.recallSelfMarks?.[0]).toBe('miss');
    });
    // 自由記述の自己申告を科目別正答率へ混ぜない
    expect((await repo.load()).questionAttempts).toHaveLength(0);
  });
});

describe('手を動かす(アプリ内出題)', () => {
  it('今日見た内容から出て、選んだ直後に正誤と解説と出どころが出る', async () => {
    const user = userEvent.setup();
    renderLesson();

    const first = bank[0]!;
    expect(quizItem(0).querySelector('.quiz-stem')!.textContent).toContain(first.stem);

    await answerRight(user, 0, first);
    const item = within(quizItem(0));
    expect(item.getByText('正解！')).toBeInTheDocument();
    expect(item.getByText(first.explanation)).toBeInTheDocument();
    expect(item.getByText(new RegExp(first.sourceWatch))).toBeInTheDocument();
  });

  it('全問に答えるまで保存できない(途中の点数を成績へ入れない)', async () => {
    const user = userEvent.setup();
    renderLesson();

    const save = screen.getByRole('button', { name: /結果を残す/ });
    expect(save).toBeDisabled();

    await answerRight(user, 0, bank[0]!);
    await settle(user, 0);
    expect(screen.getByRole('button', { name: /結果を残す/ })).toBeDisabled();
  });

  it('途中の1問を閉じても、次回は同じ回答から再開できる', async () => {
    const user = userEvent.setup();
    const firstView = renderLesson();

    await answerRight(user, 0, bank[0]!);
    await settle(user, 0);
    await waitFor(async () => {
      const saved = (await repo.load()).lessonProgress[lesson.id];
      expect(saved?.quizDraft).toHaveLength(1);
      expect(saved?.quizDraft?.[0]?.sure).toBe(true);
    });

    firstView.unmount();
    renderLesson();
    await waitFor(() => {
      expect(
        within(quizItem(0)).getByText('✓ 記録した。この問題はしばらく出てこないよ'),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /結果を残す/ })).toBeDisabled();
  });

  it('解き終えると1問ずつ記録され、科目別成績と復習リストへ流れる', async () => {
    const user = userEvent.setup();
    renderLesson();

    // 1問目だけ誤答、残りは正解。誤答は復習キューへ入るはず
    for (const [i, q] of bank.entries()) {
      if (i === 0) await answerWrong(user, i, q);
      else await answerRight(user, i, q);
      await settle(user, i);
    }

    const save = await screen.findByRole('button', {
      name: new RegExp(`結果を残す（${bank.length - 1}/${bank.length}）`),
    });
    await user.click(save);

    await waitFor(async () => {
      const attempts = (await repo.load()).questionAttempts;
      expect(attempts).toHaveLength(bank.length);
    });

    const attempts = (await repo.load()).questionAttempts;
    // 採点対象として入る(累計問題数・科目別正答率に効く)
    expect(attempts.every((a) => a.scored)).toBe(true);
    expect(attempts.every((a) => a.source === IN_APP_SOURCE)).toBe(true);
    // どの問題かを辿れる。復習リストで問題文を出すのに使う
    expect(attempts.map((a) => a.questionRef).sort()).toEqual(bank.map((q) => q.id).sort());
    const wrong = attempts.filter((a) => !a.correct);
    expect(wrong).toHaveLength(1);
    expect(wrong[0]!.confidence).toBe(1);

    // 自己申告ではなく採点結果がそのまま進捗に入る
    const progress = (await repo.load()).lessonProgress[lesson.id];
    expect(progress?.practiceCorrect).toBe(bank.length - 1);
    expect(progress?.practiceTotal).toBe(bank.length);
  });

  it('同じレッスンをもう一度保存しても、記録が二重に積まれない', async () => {
    const user = userEvent.setup();
    renderLesson();

    for (const [i, q] of bank.entries()) {
      await answerRight(user, i, q);
      await settle(user, i);
    }
    await user.click(screen.getByRole('button', { name: /結果を残す/ }));
    await waitFor(async () => {
      expect((await repo.load()).questionAttempts).toHaveLength(bank.length);
    });

    const saved = await screen.findByRole('button', { name: '✓ 結果は保存済み' });
    await user.click(saved);
    await new Promise((r) => setTimeout(r, 50));
    expect((await repo.load()).questionAttempts).toHaveLength(bank.length);
  });
});

describe('選択肢の出し方', () => {
  it('正解が1つだけ強調され、色だけでなく記号でも分かる', async () => {
    const user = userEvent.setup();
    renderLesson();
    const q = bank[1]!;
    await answerWrong(user, 1, q);

    const item = within(quizItem(1));
    const buttons = item.getAllByRole('button', { name: /^(✓ )?(ア|イ|ウ|エ)\./ });
    const right = buttons.filter((b) => b.className.includes('quiz-choice--right'));
    const wrong = buttons.filter((b) => b.className.includes('quiz-choice--wrong'));
    expect(right).toHaveLength(1);
    expect(wrong).toHaveLength(1);
    expect(right[0]!.textContent).toContain(q.choices[q.answerIndex]!);
    // 色だけで示さない。✓ と文言の両方で分かる(§13)
    expect(right[0]!.textContent).toContain('✓');
    expect(item.getByText('おしい！ ✓が正解')).toBeInTheDocument();
    // 中身は欠けも重複もしない
    expect(
      buttons.map((b) => b.textContent!.replace(/^(✓ )?[アイウエ]\. /, '')).sort(),
    ).toEqual([...q.choices].sort());
  });

  /**
   * 【回帰】バンクは正解を先頭に書いてある。並べ替えないと
   * 「一番上を押すだけで全問正解」になる。実画面でも並びが動くことを確かめる。
   */
  it('画面上でも、正解が常に先頭に来るわけではない', () => {
    const positions = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      const { unmount } = renderLesson();
      for (const [qi, q] of bank.entries()) {
        const buttons = within(quizItem(qi)).getAllByRole('button', {
          name: /^(✓ )?(ア|イ|ウ|エ)\./,
        });
        positions.add(
          buttons.findIndex((b) => b.textContent!.includes(q.choices[q.answerIndex]!)),
        );
      }
      unmount();
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('誤答が0件の必須レッスン', () => {
  it('成績が良い人を進行不能にせず、リベンジなしでクリアできる', async () => {
    const reviewLesson = curriculum.lessons.find((l) => l.id === 'p3-w7-l2')!;
    const user = userEvent.setup();
    render(
      <VaultProvider>
        <LessonPage lesson={reviewLesson} initialMode="standard" onClose={() => {}} />
      </VaultProvider>,
    );

    const clear = await screen.findByRole('button', { name: 'リベンジなしでクリア！' });
    expect(clear).toBeEnabled();
    await user.click(clear);

    await waitFor(async () => {
      const saved = (await repo.load()).lessonProgress[reviewLesson.id];
      expect(saved?.practiceSubmittedAt).toBeTruthy();
      expect(saved?.practiceCorrect).toBe(0);
      expect(saved?.practiceTotal).toBe(0);
      expect(saved?.practiceNote).toBe('リベンジ対象なし');
    });
  });
});

describe('リベンジ問題(学科タブ)', () => {
  it('アプリ内で落とした問題は、その場で解き直せる。自己申告ボタンは出さない', async () => {
    const { AcademicPage } = await import('../src/features/curriculum/AcademicPage');
    const target = bank[0]!;
    await repo.recordQuiz(lesson.id, [
      { topicId: target.topicId, correct: false, confidence: 1, questionRef: target.id },
    ]);

    const user = userEvent.setup();
    render(
      <VaultProvider>
        <AcademicPage onOpenLesson={() => {}} />
      </VaultProvider>,
    );

    // 問題IDではなく問題文が出る
    await screen.findByText(new RegExp(target.stem.slice(0, 12)));
    expect(screen.queryByRole('button', { name: '✓ クリア！' })).not.toBeInTheDocument();

    const choices = screen.getAllByRole('button', { name: /^(✓ )?(ア|イ|ウ|エ)\./ });
    await user.click(
      choices.find((b) => b.textContent!.includes(target.choices[target.answerIndex]!))!,
    );

    // 全体実行では IndexedDB の書き込み待ちで既定5秒に間に合わないことがあった。
    // 単体では通るのに全スイートで落ちる=テスト側の待ち不足なので、待ち時間だけ延ばす。
    await screen.findByText(/リベンジ成功！/, undefined, { timeout: 15000 });
    await waitFor(async () => {
      const row = (await repo.load()).questionAttempts[0]!;
      expect(row.reviewCount).toBe(1);
      expect(row.lastReviewCorrect).toBe(true);
    });
  });

  it('外部教材(過去問)の記録は問題文が無いので、従来どおり自己申告で進める', async () => {
    const { AcademicPage } = await import('../src/features/curriculum/AcademicPage');
    await repo.recordExam({
      kind: 'topic-quiz',
      label: '令和7年度上期 学科',
      timed: false,
      questions: [{ topicId: 'law', correct: false, confidence: 1 }],
    });

    render(
      <VaultProvider>
        <AcademicPage onOpenLesson={() => {}} />
      </VaultProvider>,
    );

    expect(await screen.findByRole('button', { name: '✓ クリア！' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^(✓ )?(ア|イ|ウ|エ)\./ })).toHaveLength(0);
  });
});
