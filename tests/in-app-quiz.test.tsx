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

beforeEach(async () => {
  await repo.wipe();
  await repo.saveSettings({
    ...defaultSettings('2026-h2'),
    setupCompletedAt: '2026-08-11T20:00:00+09:00',
  });
});

/** 「電圧・電流・抵抗・電力ということば」。まず見る=ガミデンキ #1 */
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

/** index 番目の問題に choice 番目で答える */
async function answer(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  choiceIndex: number,
) {
  const item = within(quizItem(index));
  await user.click(item.getAllByRole('button', { name: /^(ア|イ|ウ|エ)\./ })[choiceIndex]!);
}

/** 正誤の確定(バッチリ / あやふや / リベンジ登録) */
async function settle(user: ReturnType<typeof userEvent.setup>, index: number) {
  const item = within(quizItem(index));
  const sure = item.queryByRole('button', { name: 'バッチリだった' });
  if (sure) await user.click(sure);
  else await user.click(item.getByRole('button', { name: 'リベンジ登録して次へ' }));
}

describe('見ないで思い出す(答え合わせ)', () => {
  it('書くまで模範解答は出ない。書いたら出る', async () => {
    const user = userEvent.setup();
    renderLesson();

    const prompt = lesson.recallPrompts[0]!;
    expect(screen.queryByText(prompt.modelAnswer)).not.toBeInTheDocument();

    const check = screen.getAllByRole('button', { name: '答え合わせ' })[0]!;
    expect(check).toBeDisabled();

    await user.type(screen.getByLabelText(prompt.prompt), '圧力と量と流れにくさ');
    await user.click(screen.getAllByRole('button', { name: '答え合わせ' })[0]!);

    expect(screen.getByText(prompt.modelAnswer)).toBeInTheDocument();
    // どの教材のどこで見た話かを必ず添える
    expect(screen.getByText(new RegExp(prompt.sourceWatch!))).toBeInTheDocument();
  });

  it('自己採点は保存されるが、合格準備度(科目別成績)には入らない', async () => {
    const user = userEvent.setup();
    renderLesson();

    for (const p of lesson.recallPrompts) {
      await user.type(screen.getByLabelText(p.prompt), 'おぼえたこと');
    }
    for (const button of screen.getAllByRole('button', { name: '答え合わせ' })) {
      await user.click(button);
    }
    await user.click(screen.getAllByRole('button', { name: '出てこなかった' })[0]!);
    await user.click(screen.getByRole('button', { name: 'ここまでを保存' }));

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

    await answer(user, 0, first.answerIndex);
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

    await answer(user, 0, bank[0]!.answerIndex);
    await settle(user, 0);
    expect(screen.getByRole('button', { name: /結果を残す/ })).toBeDisabled();
  });

  it('解き終えると1問ずつ記録され、科目別成績と復習リストへ流れる', async () => {
    const user = userEvent.setup();
    renderLesson();

    // 1問目だけ誤答、残りは正解。誤答は復習キューへ入るはず
    for (const [i, q] of bank.entries()) {
      const wrongIndex = q.answerIndex === 0 ? 1 : 0;
      await answer(user, i, i === 0 ? wrongIndex : q.answerIndex);
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
      await answer(user, i, q.answerIndex);
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

describe('出題の出どころ', () => {
  it('選択肢は本文どおりの順で、正解が必ず1つだけ強調される', async () => {
    const user = userEvent.setup();
    renderLesson();
    const q = bank[1]!;
    const wrongIndex = q.answerIndex === 0 ? 1 : 0;
    await answer(user, 1, wrongIndex);

    const item = within(quizItem(1));
    const buttons = item.getAllByRole('button', { name: /^(ア|イ|ウ|エ)\./ });
    const right = buttons.filter((b) => b.className.includes('quiz-choice--right'));
    const wrong = buttons.filter((b) => b.className.includes('quiz-choice--wrong'));
    expect(right).toHaveLength(1);
    expect(wrong).toHaveLength(1);
    expect(right[0]!.textContent).toContain(q.choices[q.answerIndex]!);
    // 色だけで示さない。テキストでも正誤が分かる(§13)
    expect(item.getByText('おしい！ 正解は下')).toBeInTheDocument();
    // 選択肢は本文どおりの順で出す
    expect(buttons.map((b) => b.textContent!.replace(/^[アイウエ]\. /, ''))).toEqual(q.choices);
  });
});
