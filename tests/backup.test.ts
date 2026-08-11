import { beforeEach, describe, expect, it } from 'vitest';
import { Denko2Db } from '../src/db/db';
import { Repo, defaultSettings } from '../src/db/repo';
import { buildBackup, validateBackup } from '../src/domain/backup';
import { SCHEMA_VERSION } from '../src/domain/types';
import type { BackupFile } from '../src/domain/types';

let db: Denko2Db;
let repo: Repo;

beforeEach(async () => {
  db = new Denko2Db(`test-${Math.random()}`);
  repo = new Repo(db);
  await db.open();
});

describe('AT-009 データ管理', () => {
  it('書き出し→復元で件数と状態が一致する', async () => {
    await repo.saveSettings(defaultSettings('2026-h2'));
    await repo.saveLessonProgress({
      lessonId: 'p0-l1',
      xpAwarded: 10,
      updatedAt: '2026-08-11T20:00:00+09:00',
      completedAt: '2026-08-11T20:00:00+09:00',
      takeaway: '接地',
    });
    await repo.addSession({
      durationMinutes: 25,
      kind: 'theory',
      lessonId: 'p0-l1',
      countsAsBasics: true,
    });
    await repo.setAdminTaskDone('mypage', true);
    await repo.addUnknownTerms(['ケーブル', 'スリーブ'], 'ungraded-five');

    const exported = await repo.exportBackup();
    const text = JSON.stringify(exported);

    await repo.wipe();
    expect((await repo.load()).settings).toBeUndefined();

    const result = validateBackup(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await repo.importBackup(result.backup);

    const restored = await repo.load();
    expect(restored.settings?.examCycleId).toBe('2026-h2');
    expect(Object.keys(restored.lessonProgress)).toHaveLength(1);
    expect(restored.lessonProgress['p0-l1']?.takeaway).toBe('接地');
    expect(restored.studySessions).toHaveLength(1);
    expect(restored.adminTaskStates.mypage?.doneAt).toBeTruthy();
    expect(restored.unknownTerms).toHaveLength(2);
  });

  it('不明語は最大3つまでしか保存しない', async () => {
    await repo.addUnknownTerms(['a', 'b', 'c', 'd', 'e'], 'ungraded-five');
    expect((await repo.load()).unknownTerms).toHaveLength(3);
  });

  it('壊れたJSONでは既存データを消さない', async () => {
    await repo.saveSettings(defaultSettings('2026-h2'));
    await repo.saveLessonProgress({ lessonId: 'p0-l1', xpAwarded: 0, updatedAt: '' });

    for (const bad of ['{壊れている', '[]', '"文字列"', '{"kind":"other-app","data":{}}']) {
      const result = validateBackup(bad);
      expect(result.ok).toBe(false);
    }

    // 検証に落ちた場合 importBackup は呼ばれない → データはそのまま
    const after = await repo.load();
    expect(after.settings).toBeDefined();
    expect(Object.keys(after.lessonProgress)).toHaveLength(1);
  });

  it('startDate が壊れたバックアップを弾く', () => {
    const backup = buildBackup({
      settings: [{ ...defaultSettings('2026-h2'), startDate: '2026/08/11' }],
      lessonProgress: [],
      adminTaskStates: [],
      studySessions: [],
      questionAttempts: [],
      mockExams: [],
      unknownTerms: [],
      skillAttempts: [],
      budgetItems: [],
    });
    const result = validateBackup(JSON.stringify(backup));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('data.settings[0].startDate');
  });

  it('新しい schemaVersion のファイルは読み込まず、理由を返す', () => {
    const backup = { ...buildBackup(emptyData()), schemaVersion: SCHEMA_VERSION + 1 };
    const result = validateBackup(JSON.stringify(backup));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain('アプリを更新');
  });

  it('旧 schemaVersion(v0)を移行して読み込める', () => {
    const legacy: BackupFile = {
      kind: 'denko2-companion-backup',
      schemaVersion: 0,
      exportedAt: '2026-08-01T10:00:00+09:00',
      appVersion: '0.0.1',
      data: {
        ...emptyData(),
        settings: [defaultSettings('2026-h2')],
        studySessions: [
          {
            id: 's1',
            startedAt: '2026-08-01T10:00:00+09:00',
            jstDate: '2026-08-01',
            durationMinutes: 30,
            kind: 'theory',
            // v0 には countsAsBasics が無い
          } as never,
        ],
      },
    };
    const result = validateBackup(JSON.stringify(legacy));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(0);
    expect(result.backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.backup.data.studySessions[0]?.countsAsBasics).toBe(true);
  });

  it('同期前(v2)の書き出しを読むと、全行に updatedAt が埋まる', () => {
    // 埋め忘れると、その行は同期のたびに「最古」として扱われ、
    // 他端末の古い版に負け続ける
    const v2 = {
      kind: 'denko2-companion-backup',
      schemaVersion: 2,
      exportedAt: '2026-08-11T10:00:00+09:00',
      appVersion: '0.1.0',
      data: {
        ...emptyData(),
        studySessions: [
          {
            id: 's1',
            startedAt: '2026-08-11T20:00:00+09:00',
            jstDate: '2026-08-11',
            durationMinutes: 25,
            kind: 'theory',
            countsAsBasics: true,
          } as never,
        ],
        questionAttempts: [
          {
            id: 'q1',
            attemptedAt: '2026-08-11T21:00:00+09:00',
            jstDate: '2026-08-11',
            source: 'x',
            questionRef: '1',
            topicId: 'basic-theory',
            correct: true,
            confidence: 3,
            scored: true,
          } as never,
        ],
      },
    };

    const result = validateBackup(JSON.stringify(v2));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(2);
    expect(result.backup.data.studySessions[0]?.updatedAt).toBe('2026-08-11T20:00:00+09:00');
    expect(result.backup.data.questionAttempts[0]?.updatedAt).toBe('2026-08-11T21:00:00+09:00');
  });

  it('将来テーブルが増えても、欠けているテーブルは空として扱う', () => {
    const partial = {
      kind: 'denko2-companion-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-08-11T10:00:00+09:00',
      appVersion: '0.1.0',
      data: { settings: [], lessonProgress: [] },
    };
    const result = validateBackup(JSON.stringify(partial));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.data.budgetItems).toEqual([]);
  });
});

function emptyData(): BackupFile['data'] {
  return {
    settings: [],
    lessonProgress: [],
    adminTaskStates: [],
    studySessions: [],
    questionAttempts: [],
    mockExams: [],
    unknownTerms: [],
    skillAttempts: [],
    budgetItems: [],
  };
}
