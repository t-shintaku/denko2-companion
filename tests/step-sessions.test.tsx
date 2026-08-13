/**
 * 【P0の回帰】途中でやめた日の学習時間が消えないこと。
 *
 * 画面は「今日は見るだけで終えてよい」と案内する。にもかかわらず、
 * 学習時間が4段階そろったときだけ保存されていた。前日までの時間はどこにも残らず、
 * 基礎レッスンを終えても基礎180分に届かず、20問診断が開かない経路があった。
 * 指示どおり学習すると進めなくなる、という一番やってはいけない壊れ方。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { VaultProvider } from '../src/state/VaultContext';
import { curriculum } from '../src/data';
import { defaultSettings, repo } from '../src/db/repo';
import { basicsMinutes } from '../src/domain/onboarding';
import { fillRecall } from './helpers/recall';

beforeEach(async () => {
  await repo.wipe();
  await repo.saveSettings({
    ...defaultSettings('2026-h2'),
    setupCompletedAt: '2026-08-11T20:00:00+09:00',
  });
});

function renderApp() {
  return render(
    <VaultProvider>
      <App />
    </VaultProvider>,
  );
}

const firstLesson = curriculum.lessons.find((l) => l.stage === 'orientation')!;

describe('段階ごとに学習時間が残る', () => {
  it('「見る」だけで閉じても、その時間が記録される', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: 'クエスト開始' }));
    await screen.findByRole('heading', { name: firstLesson.title });

    await user.type(screen.getByLabelText(/このステップにかかった時間/), '12');
    await user.click(screen.getByRole('button', { name: '見終わった！ 次へ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ 見終わった' })).toBeInTheDocument());

    // ここで閉じる。まだレッスンは完了していない
    const sessions = (await repo.load()).studySessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.durationMinutes).toBe(12);
    expect(sessions[0]?.step).toBe('input');
    expect(sessions[0]?.lessonId).toBe(firstLesson.id);

    const progress = (await repo.load()).lessonProgress[firstLesson.id];
    expect(progress?.completedAt).toBeUndefined();
    expect(progress?.xpAwarded).toBe(0); // 見ただけでXPは増えない(AT-003)
  });

  it('段階を4つ通すと、4件の時間が積み上がる(上書き保存では二重に増えない)', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'クエスト開始' }));
    await screen.findByRole('heading', { name: firstLesson.title });

    /**
     * 段階が切り替わると、画面は入力欄を空へ戻す(次の段階の実測を取り直すため)。
     * そのリセットが届く前に打つと、直後に消されて実測値(1分)が記録される。
     * ローカルでは間に合い CI では間に合わない、という落ち方をするので、
     * 空に戻ったことを確認してから打つ。
     */
    const enterMinutes = async (value: string) => {
      await waitFor(() =>
        expect(screen.getByLabelText(/このステップにかかった時間/)).toHaveValue(null),
      );
      const field = screen.getByLabelText(/このステップにかかった時間/);
      await user.clear(field);
      await user.type(field, value);
      expect(field).toHaveValue(Number(value));
    };

    await enterMinutes('10');
    await user.click(screen.getByRole('button', { name: '見終わった！ 次へ' }));

    await enterMinutes('5');
    const recallSection = screen
      .getByRole('heading', { name: '2. 見ないで思い出す' })
      .closest('section')!;
    await fillRecall(user, recallSection);
    await user.click(await screen.findByRole('button', { name: 'ここまでを保存' }));

    await enterMinutes('8');
    await user.type(screen.getByLabelText('今日やったこと'), '5問解いた');
    await user.click(await screen.findByRole('button', { name: '結果を残す' }));

    // 上書き保存しても時間は二重に増えない(「解く／作る」をもう一度保存する)
    const overwrite = await screen.findAllByRole('button', { name: /保存済み/ });
    await user.click(overwrite[overwrite.length - 1]!);

    await enterMinutes('3');
    await user.type(screen.getByLabelText('次の自分へのひとこと'), '接地を復習');
    await user.click(await screen.findByRole('button', { name: '保存してクリア！' }));

    await waitFor(async () => {
      const loaded = await repo.load();
      expect(loaded.lessonProgress[firstLesson.id]?.completedAt).toBeTruthy();
    });

    const sessions = (await repo.load()).studySessions;
    expect(sessions).toHaveLength(4);
    expect(sessions.map((s) => s.step).sort()).toEqual(
      ['input', 'practice', 'recall', 'takeaway'].sort(),
    );
    expect(sessions.reduce((n, s) => n + s.durationMinutes, 0)).toBe(26);
  });

  it('【回帰】基礎レッスンを段階ごとに分けて進めても、基礎180分に積み上がる', async () => {
    // 段階ごとに別々の日へ分けて記録する(実際の使い方)
    const basics = curriculum.lessons.filter((l) => l.stage === 'basics').slice(0, 4);
    expect(basics.length).toBeGreaterThan(0);

    for (const lesson of basics) {
      for (const step of ['input', 'recall', 'practice', 'takeaway'] as const) {
        await repo.addSession({
          durationMinutes: 12,
          kind: 'questions',
          lessonId: lesson.id,
          step,
          countsAsBasics: true,
        });
      }
    }

    const loaded = await repo.load();
    // 完了していない段階の時間も含めて積み上がる
    expect(basicsMinutes(loaded.studySessions)).toBe(basics.length * 4 * 12);
  });
});
