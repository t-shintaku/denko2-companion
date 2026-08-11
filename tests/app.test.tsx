import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { VaultProvider } from '../src/state/VaultContext';
import { repo } from '../src/db/repo';

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-11T20:00:00+09:00'));
  await repo.wipe();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderApp() {
  return render(
    <VaultProvider>
      <App />
    </VaultProvider>,
  );
}

describe('Sprint 1 の通し動作', () => {
  it('初回は設定ウィザードが出て、いきなり20問診断を出さない', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();

    expect(await screen.findByRole('button', { name: 'はじめる' })).toBeInTheDocument();
    // AT-002: 最初の画面から診断を始める導線が無い(順序の説明として文中に出るのは可)
    expect(screen.queryByRole('button', { name: /診断/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /20問診断/ })).not.toBeInTheDocument();
    // 安全の境界を最初に見せる(AT-010)
    expect(screen.getByText(/免状を受け取るまで/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'はじめる' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'ホーム' })).toBeInTheDocument());
    // 5タブ(FR/§11)
    for (const label of ['ホーム', '学科', '技能', '記録', '設定']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // 最初のクエストはオリエンテーション
    expect(await screen.findByText('資格と試験の地図')).toBeInTheDocument();
    expect(screen.getByText(/入口:試験と電気の地図/)).toBeInTheDocument();
    // ホームにも診断を始めるボタンは出ない
    expect(screen.queryByRole('button', { name: /診断/ })).not.toBeInTheDocument();
  });

  it('動画を見ただけでは完了せず、4段階そろって初めて完了になる', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: 'はじめる' })); // クエストを開く

    expect(await screen.findByRole('heading', { name: '資格と試験の地図' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '見たので次へ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ 見た' })).toBeDisabled());
    // まだ完了していない
    expect(screen.queryByText(/完了。XP/)).not.toBeInTheDocument();
    expect(screen.getByText(/残り:/)).toBeInTheDocument();

    const recallSection = screen.getByRole('heading', { name: '2. 閉じて答える' }).closest('section')!;
    const recallInputs = within(recallSection).getAllByRole('textbox');
    await user.type(recallInputs[0]!, '免状申請が残る');
    await user.click(within(recallSection).getByRole('button', { name: /保存/ }));

    const practiceSection = screen.getByRole('heading', { name: '3. 解く／作る' }).closest('section')!;
    await user.type(within(practiceSection).getByLabelText('やったことのメモ'), '受験日を入れた');
    await user.click(within(practiceSection).getByRole('button', { name: /保存/ }));
    expect(screen.queryByText(/完了。XP/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('次に直す1点'), '免状申請の窓口を調べる');
    await user.click(screen.getByRole('button', { name: /保存してレッスンを閉じる/ }));

    expect(await screen.findByText(/完了。XP \+10/)).toBeInTheDocument();
  });

  it('設定タブでバックアップを書き出せる', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();

    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: '設定' }));

    await user.click(await screen.findByRole('button', { name: 'JSONへ書き出す' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(await screen.findByText(/書き出した/)).toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it('全削除は2段階の確認を要求する', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: '設定' }));

    await user.click(await screen.findByRole('button', { name: 'すべてのデータを削除する' }));
    expect(screen.getByText(/先に「JSONへ書き出す」を実行した/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /はい、削除する/ })).toBeInTheDocument();
  });
});
