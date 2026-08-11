/**
 * 長く使ったあとの画面の動きを、実際にクリックして確かめる。
 * ドメインが直っていても、押す場所が無ければ本人にとっては直っていない。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { VaultProvider } from '../src/state/VaultContext';
import { repo, defaultSettings } from '../src/db/repo';
import { addDays, todayJst } from '../src/domain/jst';

// この一式は偽の時計を使わない。Dexie のトランザクションが偽タイマー下で
// 途中終了してしまい、検証したい画面の動きに行き着く前に落ちるため。
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

describe('技能: 反復欠陥から抜け出せる', () => {
  it('同じ欠陥を2回出しても、部分練習を記録すればゲートが再び開く', async () => {
    const user = userEvent.setup();
    for (const candidateNo of [1, 2]) {
      await repo.addSkillAttempt({
        candidateNo,
        workMinutes: 30,
        diagramMinutes: 5,
        completed: true,
        defectFree: false,
        defectCodes: ['core-cut'],
        photoIds: [],
      });
    }

    renderApp();
    await user.click(await screen.findByRole('button', { name: '技能' }));

    // 未対策の反復欠陥として上がっている
    expect(await screen.findByText(/未対策 1種類/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /の部分練習を記録/ }));
    await user.click(await screen.findByRole('button', { name: '対策したとして記録する' }));

    // 降りて、ゲートの条件が通る
    await waitFor(() => expect(screen.getByText('対策済み')).toBeInTheDocument());
    expect(screen.queryByText(/未対策/)).not.toBeInTheDocument();
  });

  it('複線図込みの合計時間が記録画面に出る', async () => {
    const user = userEvent.setup();
    await repo.addSkillAttempt({
      candidateNo: 3,
      workMinutes: 30,
      diagramMinutes: 10,
      completed: true,
      defectFree: true,
      defectCodes: [],
      photoIds: [],
    });

    renderApp();
    await user.click(await screen.findByRole('button', { name: '技能' }));
    // 30分ではなく40分として出る
    expect(await screen.findByText(/中央値40分/)).toBeInTheDocument();
  });
});

describe('学科: 復習は1回押して終わりにならない', () => {
  it('「○ 解けた」を押すと今日は消え、翌日また出る', async () => {
    const user = userEvent.setup();
    await repo.recordExam({
      kind: 'topic-quiz',
      label: '令和7年度上期',
      timed: false,
      questions: [
        { topicId: 'law', correct: false, confidence: 2, questionRef: '令和7年度上期 第3問' },
      ],
    });

    renderApp();
    await user.click(await screen.findByRole('button', { name: '学科' }));
    expect(await screen.findByText(/第3問/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '○ 解けた' }));
    await waitFor(() => expect(screen.queryByText(/第3問/)).not.toBeInTheDocument());

    // 消えたのではなく、翌日に戻る予定として保存されている
    const snapshot = await repo.load();
    const saved = snapshot.questionAttempts[0]!;
    expect(saved.reviewCount).toBe(1);
    expect(saved.nextReviewOn).toBe(addDays(todayJst(), 1));
  });
});

describe('ホーム: 今週やった日数が出る', () => {
  it('学習セッションがあると日数が表示される', async () => {
    await repo.addSession({ durationMinutes: 30, kind: 'theory', countsAsBasics: true });
    renderApp();
    expect(await screen.findByText('今週やった日')).toBeInTheDocument();
    expect(await screen.findByText(/1 \/ 7 日/)).toBeInTheDocument();
  });
});
