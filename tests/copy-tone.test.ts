import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const uiFiles = [
  'src/features/dashboard/HomePage.tsx',
  'src/features/onboarding/SetupWizard.tsx',
  'src/features/curriculum/LessonPage.tsx',
  'src/features/curriculum/AcademicPage.tsx',
  'src/features/practical/PracticalPage.tsx',
  'src/features/review/RecordsPage.tsx',
  'src/features/settings/SettingsPage.tsx',
  'src/features/settings/SyncPanel.tsx',
  'src/domain/quests.ts',
  'src/data/curriculum-2026-h2.json',
  'src/data/resources.json',
  'src/features/academic/ExamSheet.tsx',
];

const copy = uiFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

describe('UIの言葉は業務システム調へ戻さない', () => {
  it.each([
    '休んでよい',
    '区切ってよい',
    '空欄でよい',
    '見たので次へ',
    '完了。XP',
    '見ながら書くと意味がない',
    '対策したとして記録する',
    '止めてよい',
    '解けなくてよい',
    '参照ありでよい',
    '途中でやめてよい',
    '一旦終えてよい',
    '結果を保存する',
  ])('「%s」を画面文言に使わない', (stiffPhrase) => {
    expect(copy).not.toContain(stiffPhrase);
  });

  it('挑戦と達成が伝わる言葉を残す', () => {
    expect(copy).toContain('クエストクリア！');
    expect(copy).toContain('アンロック！');
    expect(copy).toContain('ストップOK！');
    expect(copy).toContain('リベンジ');
  });
});
