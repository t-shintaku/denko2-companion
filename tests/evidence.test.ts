/**
 * 「記録が証拠として信用できるか」を守るテスト。
 *
 * Codexの独立レビュー(2026-08-11)で見つかった2件の水増しに対する回帰テスト。
 * どちらも「テストは通るのに、記録の中身が実態より良くなる」種類の欠陥だった。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { curriculum } from '../src/data';
import { Denko2Db } from '../src/db/db';
import { Repo } from '../src/db/repo';
import {
  BASICS_REQUIRED_MINUTES,
  basicsMinutes,
  countsAsBasics,
  evaluateOnboarding,
} from '../src/domain/onboarding';
import { applyStep } from '../src/domain/lessons';
import type { LessonProgress, StudySession } from '../src/domain/types';

let db: Denko2Db;
let repo: Repo;

beforeEach(async () => {
  db = new Denko2Db(`evidence-${Math.random()}`);
  repo = new Repo(db);
  await db.open();
});

const orientation = curriculum.lessons.filter((l) => l.stage === 'orientation');
const ungraded = curriculum.lessons.find((l) => l.stage === 'ungraded-five')!;
const basicsLesson = curriculum.lessons.find((l) => l.stage === 'basics')!;

describe('基礎180分の算入範囲', () => {
  it('オリエンテーションと無採点5問は基礎学習に算入しない', () => {
    for (const l of orientation) expect(countsAsBasics(l), l.id).toBe(false);
    expect(countsAsBasics(ungraded)).toBe(false);
    expect(countsAsBasics(basicsLesson)).toBe(true);
  });

  it('【回帰】オリエンテーション全4本を終えても基礎は0分のまま', () => {
    // 以前は countsAsBasics: !isUngradedFive だったため、
    // オリエンテーション標準見積100分が先に埋まり、基礎は実質80分で診断が開いた
    const orientationMinutes = orientation.reduce(
      (n, l) => n + l.estimatedMinutes.standard,
      0,
    );
    expect(orientationMinutes).toBeGreaterThanOrEqual(80); // 水増しの原資が実在した

    const sessions: StudySession[] = orientation.map((l, i) => ({
      id: `s${i}`,
      startedAt: '2026-08-12T10:00:00+09:00',
      jstDate: '2026-08-12',
      durationMinutes: l.estimatedMinutes.standard,
      kind: 'theory',
      countsAsBasics: countsAsBasics(l),
    }));
    expect(basicsMinutes(sessions)).toBe(0);
  });

  it('オリエンテーション完了後、基礎180分ぶんを積んで初めて診断が開く', () => {
    const progress: Record<string, LessonProgress> = {};
    const now = new Date('2026-08-12T10:00:00+09:00');
    for (const l of [...orientation, ungraded]) {
      let p = applyStep(l, undefined, 'input', {}, now);
      p = applyStep(l, p, 'recall', { recallAnswers: ['a'] }, now);
      p = applyStep(l, p, 'practice', { practiceNote: 'x', practiceTotal: 5 }, now);
      progress[l.id] = applyStep(l, p, 'takeaway', { takeaway: 'y' }, now);
    }

    const orientationOnly: StudySession[] = [...orientation, ungraded].map((l, i) => ({
      id: `o${i}`,
      startedAt: '2026-08-12T10:00:00+09:00',
      jstDate: '2026-08-12',
      durationMinutes: l.estimatedMinutes.standard,
      kind: 'theory',
      countsAsBasics: countsAsBasics(l),
    }));

    const settings = {
      beginnerMode: true,
      diagnosticUnlockedManually: false,
      diagnosticCompletedAt: undefined,
      ungradedFiveCompletedAt: undefined,
    };

    const afterOrientation = evaluateOnboarding(curriculum, progress, orientationOnly, settings);
    expect(afterOrientation.basicsMinutes).toBe(0);
    expect(afterOrientation.diagnosticAvailable).toBe(false);

    const withBasics = evaluateOnboarding(
      curriculum,
      progress,
      [
        ...orientationOnly,
        {
          id: 'b1',
          startedAt: '2026-08-20T10:00:00+09:00',
          jstDate: '2026-08-20',
          durationMinutes: BASICS_REQUIRED_MINUTES,
          kind: 'theory',
          countsAsBasics: true,
        },
      ],
      settings,
    );
    expect(withBasics.basicsMinutes).toBe(BASICS_REQUIRED_MINUTES);
    expect(withBasics.diagnosticAvailable).toBe(true);
  });
});

describe('学習時間は実績を記録する', () => {
  it('見積と実績を別々に持ち、実績は呼び出し側が渡した値になる', async () => {
    const session = await repo.addSession({
      durationMinutes: 6, // 実測6分
      measuredMinutes: 6,
      estimatedMinutes: 30, // 30分版の見積
      kind: 'theory',
      lessonId: basicsLesson.id,
      countsAsBasics: true,
    });
    expect(session.durationMinutes).toBe(6);
    expect(session.estimatedMinutes).toBe(30);

    const loaded = await repo.load();
    // 集計に効くのは実績。見積ではない
    expect(basicsMinutes(loaded.studySessions)).toBe(6);
  });

  it('countsAsBasics は明示必須。既定でtrueにならない', async () => {
    const session = await repo.addSession({
      durationMinutes: 10,
      kind: 'theory',
      countsAsBasics: false,
    });
    expect(session.countsAsBasics).toBe(false);
    expect(basicsMinutes([session])).toBe(0);
  });

  it('【回帰】6分の操作で30分版を終えても、基礎は6分しか進まない', async () => {
    for (let i = 0; i < 5; i += 1) {
      await repo.addSession({
        durationMinutes: 6,
        measuredMinutes: 6,
        estimatedMinutes: 30,
        kind: 'theory',
        countsAsBasics: true,
      });
    }
    const loaded = await repo.load();
    // 見積を記録していたら 150分。実績なら 30分
    expect(basicsMinutes(loaded.studySessions)).toBe(30);
    expect(basicsMinutes(loaded.studySessions)).toBeLessThan(BASICS_REQUIRED_MINUTES);
  });
});
