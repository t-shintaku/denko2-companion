/**
 * 長く使ったあとの画面の動きを、実際にクリックして確かめる。
 * ドメインが直っていても、押す場所が無ければ本人にとっては直っていない。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { LessonPage } from '../src/features/curriculum/LessonPage';
import { VaultProvider } from '../src/state/VaultContext';
import { curriculum, getLesson } from '../src/data';
import { repo, defaultSettings } from '../src/db/repo';
import { addDays, todayJst } from '../src/domain/jst';
import { candidateStates } from '../src/domain/practical';

/** 技能フェーズのレッスンは学科日以降にしか出ないので、画面を直接開いて確かめる */
function LessonHarness({ lessonId }: { lessonId: string }) {
  return <LessonPage lesson={getLesson(lessonId)!} initialMode="standard" onClose={() => {}} />;
}

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
    await user.click(await screen.findByRole('button', { name: '練習できた！' }));

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

    await user.click(screen.getByRole('button', { name: '✓ クリア！' }));
    await waitFor(() => expect(screen.queryByText(/第3問/)).not.toBeInTheDocument());

    // 消えたのではなく、翌日に戻る予定として保存されている
    const snapshot = await repo.load();
    const saved = snapshot.questionAttempts[0]!;
    expect(saved.reviewCount).toBe(1);
    expect(saved.nextReviewOn).toBe(addDays(todayJst(), 1));
  });
});

describe('候補問題のレッスンが、そのまま技能の記録になる', () => {
  it('【回帰】カリキュラムを完了したのに技能0/13、が起きない', async () => {
    const user = userEvent.setup();
    const lesson = curriculum.lessons.find((l) => l.id === 'p5-c01')!;
    expect(lesson.practice.candidateNo).toBe(1);

    render(
      <VaultProvider>
        <LessonHarness lessonId={lesson.id} />
      </VaultProvider>,
    );

    await screen.findByRole('heading', { name: lesson.title });

    // 見る → 閉じて答える
    await user.click(screen.getByRole('button', { name: '見終わった！ 次へ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '✓ 見終わった' })).toBeDisabled());
    const recallSection = screen.getByRole('heading', { name: '2. 見ないで思い出す' }).closest('section')!;
    await user.type(within(recallSection).getAllByRole('textbox')[0]!, '差込コネクタ');
    await user.click(within(recallSection).getByRole('button', { name: /保存/ }));
    await waitFor(() =>
      expect(within(recallSection).getByRole('button', { name: /保存済み/ })).toBeInTheDocument(),
    );

    // 解く／作る = 技能の記録
    const practiceSection = screen.getByRole('heading', { name: '3. 手を動かす' }).closest('section')!;
    await user.type(within(practiceSection).getByLabelText('複線図(分)'), '10');
    await user.type(within(practiceSection).getByLabelText('施工(分)'), '38');
    await user.type(within(practiceSection).getByLabelText('今日やったこと'), '輪作りで手間取った');
    await user.click(within(practiceSection).getByRole('button', { name: /結果を残す/ }));

    await waitFor(async () => {
      const attempts = (await repo.load()).skillAttempts;
      expect(attempts).toHaveLength(1);
    });

    const attempt = (await repo.load()).skillAttempts[0]!;
    expect(attempt.candidateNo).toBe(1);
    expect(attempt.workMinutes).toBe(38);
    expect(attempt.diagramMinutes).toBe(10);
    expect(attempt.defectFree).toBe(true);
    expect(attempt.lessonId).toBe('p5-c01');

    // 技能ゲートの「13問すべてを施工」に効く
    const states = candidateStates((await repo.load()).skillAttempts);
    expect(states.find((s) => s.candidateNo === 1)?.status).toBe('defect-free');
    // 時間は複線図込みの48分として残る
    expect(states.find((s) => s.candidateNo === 1)?.medianMinutes).toBe(48);
  });

  it('施工時間を入れないと、候補問題の「解く／作る」は保存できない', async () => {
    const lesson = curriculum.lessons.find((l) => l.id === 'p5-c02')!;
    render(
      <VaultProvider>
        <LessonHarness lessonId={lesson.id} />
      </VaultProvider>,
    );
    await screen.findByRole('heading', { name: lesson.title });
    const practiceSection = screen.getByRole('heading', { name: '3. 手を動かす' }).closest('section')!;
    expect(within(practiceSection).getByRole('button', { name: /結果を残す/ })).toBeDisabled();
    expect(screen.getByText(/施工時間を入れたら保存できる/)).toBeInTheDocument();
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
