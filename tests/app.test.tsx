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
    // クエストの見出しは「レッスン名 — 段階名」。1本まるごとではなく次の1段階を出す
    expect(await screen.findByText(/資格と試験の地図 — 見る/)).toBeInTheDocument();
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
    // 段階ごとに保存が走る。保存中はボタンが無効なので、次の段階へ進む前に待つ
    await waitFor(() =>
      expect(within(recallSection).getByRole('button', { name: /保存済み/ })).toBeInTheDocument(),
    );

    const practiceSection = screen.getByRole('heading', { name: '3. 解く／作る' }).closest('section')!;
    await user.type(within(practiceSection).getByLabelText('やったことのメモ'), '受験日を入れた');
    await user.click(within(practiceSection).getByRole('button', { name: /保存/ }));
    // 段階ごとに保存(と時間の記録)が走るので、次の段階へ進む前に反映を待つ
    await waitFor(() =>
      expect(within(practiceSection).getByRole('button', { name: /保存済み/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/完了。XP/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('次に直す1点'), '免状申請の窓口を調べる');
    const finish = screen.getByRole('button', { name: /保存してレッスンを閉じる/ });
    await waitFor(() => expect(finish).toBeEnabled());
    await user.click(finish);

    expect(await screen.findByText(/完了。XP \+10/)).toBeInTheDocument();
  });

  it('【回帰】筆記方式を選ぶと学科日が公式日へ固定され、変更できない', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();

    const modeSelect = await screen.findByLabelText('方式');
    // CBTのあいだは自由入力できる
    const dateInput = screen.getByLabelText(/学科の受験日/) as HTMLInputElement;
    expect(dateInput.disabled).toBe(false);

    await user.selectOptions(modeSelect, 'paper');

    const fixed = screen.getByLabelText(/学科の受験日/) as HTMLInputElement;
    expect(fixed.value).toBe('2026-10-25');
    expect(fixed.disabled).toBe(true);
    expect(screen.getByText(/全国一斉。日付は選べない/)).toBeInTheDocument();
  });

  it('技能日は試験地で決まると明示する', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'はじめる' });
    expect(screen.getByText(/試験地によって決まる/)).toBeInTheDocument();
  });

  it('レッスン完了時に、見積ではなく実績時間を入力させる', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));

    await user.click(await screen.findByRole('button', { name: '見たので次へ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ 見た' })).toBeDisabled());
    const recallSection = screen.getByRole('heading', { name: '2. 閉じて答える' }).closest('section')!;
    await user.type(within(recallSection).getAllByRole('textbox')[0]!, 'a');
    await user.click(within(recallSection).getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(within(recallSection).getByRole('button', { name: /保存済み/ })).toBeInTheDocument(),
    );
    const practiceSection = screen.getByRole('heading', { name: '3. 解く／作る' }).closest('section')!;
    await user.type(within(practiceSection).getByLabelText('やったことのメモ'), 'b');
    await user.click(within(practiceSection).getByRole('button', { name: /保存/ }));
    // 段階が進むと入力欄は空へ戻る。戻ってから入れないと、入れた値が消える
    await waitFor(() =>
      expect(within(practiceSection).getByRole('button', { name: /保存済み/ })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByLabelText(/この段階にかかった時間/)).toHaveValue(null));

    // 時間の入力欄は段階ごとに出る。空欄なら実測値、入れればその値を記録する
    const minutes = (await screen.findByLabelText(/この段階にかかった時間/)) as HTMLInputElement;
    await user.clear(minutes);
    await user.type(minutes, '7');
    // オリエンテーションは基礎180分に算入しないと明示する
    expect(screen.getByText(/基礎学習180分には算入しない/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('次に直す1点'), 'c');
    const finish = screen.getByRole('button', { name: /保存してレッスンを閉じる/ });
    await waitFor(() => expect(finish).toBeEnabled());
    await user.click(finish);

    // 見積(30分版)ではなく、入れた実績が残る
    await waitFor(async () => {
      const sessions = (await repo.load()).studySessions;
      const takeaway = sessions.find((s) => s.step === 'takeaway');
      expect(takeaway?.durationMinutes).toBe(7);
    });
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

  it('【回帰】50問模試は問題数の合計が50でないと保存ボタンが押せない', async () => {
    // 画面から水増しできるかを実際に確かめる。ドメインで throw する前に、
    // まず押させないのが正しい(押せて例外、では原因が分からない)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: '学科' }));
    await user.click(await screen.findByRole('button', { name: /50問模試/ }));

    await user.type(await screen.findByLabelText(/出典/), '令和7年度上期');

    const save = await screen.findByRole('button', { name: '結果を保存する' });
    expect(save).toBeDisabled();
    expect(await screen.findByText(/50問ちょうどにする/)).toBeInTheDocument();

    // 1科目に80問入れても(=120点になる入力)保存させない
    const totals = screen.getAllByLabelText(/問題数/);
    await user.type(totals[0]!, '80');
    expect(await screen.findByRole('button', { name: '結果を保存する' })).toBeDisabled();
  });

  it('設定タブに端末間の同期があり、既定では未接続で外へ出ない', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderApp();
    await user.click(await screen.findByRole('button', { name: 'はじめる' }));
    await user.click(await screen.findByRole('button', { name: '設定' }));

    expect(await screen.findByText('端末間の同期')).toBeInTheDocument();
    expect(await screen.findByText(/未接続/)).toBeInTheDocument();
    expect(await screen.findByLabelText('GitHub のトークン')).toBeInTheDocument();
    // つなぐまでは通信しない(既定でローカルのまま)
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
