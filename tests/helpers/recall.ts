/**
 * 「見ないで思い出す」を通すヘルパー。
 *
 * 全問に書いて、全問で答え合わせ(○△×)まで進まないと保存できない。
 * 模範解答を一度も見ずにステップを終えられた頃の緩さへ戻さないための約束なので、
 * テスト側でも同じ手順を踏む。
 */
import { within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

export async function fillRecall(
  user: ReturnType<typeof userEvent.setup>,
  section: HTMLElement,
  text = '思い出した',
) {
  const scope = within(section);
  for (const box of scope.getAllByRole('textbox')) {
    await user.clear(box);
    await user.type(box, text);
  }
  for (const button of scope.getAllByRole('button', { name: '答え合わせ' })) {
    await user.click(button);
  }
  for (const button of scope.getAllByRole('button', { name: '言えた！' })) {
    await user.click(button);
  }
}
