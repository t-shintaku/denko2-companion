/**
 * 「まず見る」と「見ないで思い出す」「手を動かす」が同じ中身を指していることを機械的に守る。
 *
 * 差し戻しの経緯: 見た教材で扱っていない話が思い出す欄に並び、
 * 解く問題は外部サイトの自己申告だった。見た直後に答えられない問いは
 * 思い出す練習ではなく別の勉強を要求している。ここが緩むと元に戻る。
 */
import { describe, expect, it } from 'vitest';
import { curriculum, questionFiles, questions, syllabus, topics } from '../src/data';

const lessons = curriculum.lessons;
const lessonById = new Map(lessons.map((l) => [l.id, l]));
const lessonOrder = new Map(lessons.map((l, i) => [l.id, i]));
const questionById = new Map(questions.map((q) => [q.id, q]));
const syllabusIds = new Set(syllabus.map((s) => s.id));
const topicIdSet = new Set(topics.map((t) => t.id));

/** 条件付きで開く教材(stuck)は、見ていない前提で出題してはいけない */
const teachingRefs = (lessonId: string) =>
  (lessonById.get(lessonId)?.resources ?? []).filter((r) => r.use !== 'stuck');

describe('見ないで思い出す ↔ まず見る', () => {
  it('すべての問いに模範解答と自己採点のキーワードがある', () => {
    for (const l of lessons) {
      expect(l.recallPrompts.length, `${l.id} に思い出す問いがない`).toBeGreaterThan(0);
      for (const p of l.recallPrompts) {
        expect(p.prompt.trim(), `${p.id} の問い`).toBeTruthy();
        // 模範解答が書けない問い = 教材から答えを取り出せていない問い。載せない
        expect(p.modelAnswer?.trim(), `${p.id} に模範解答がない`).toBeTruthy();
        expect(p.acceptKeywords?.length, `${p.id} に自己採点のキーワードがない`).toBeGreaterThan(0);
      }
    }
  });

  it('教材があるレッスンでは、問いが必ずそのレッスンで開く教材を指す', () => {
    for (const l of lessons) {
      const allowed = new Set(teachingRefs(l.id).map((r) => r.resourceId));
      if (allowed.size === 0) continue; // 直前期の教材なしレッスン
      for (const p of l.recallPrompts) {
        expect(p.sourceResourceId, `${p.id} に出どころがない`).toBeTruthy();
        expect(
          allowed.has(p.sourceResourceId!),
          `${p.id} が ${p.sourceResourceId} を指しているが、${l.id} では開かない(または「詰まったときだけ」の教材)`,
        ).toBe(true);
        expect(p.sourceWatch?.trim(), `${p.id} に見た場所がない`).toBeTruthy();
      }
    }
  });

  it('教材が1つも無いレッスンだけが、出どころなしの問いを持てる', () => {
    const withoutSource = lessons.filter((l) =>
      l.recallPrompts.some((p) => !p.sourceResourceId),
    );
    for (const l of withoutSource) {
      expect(teachingRefs(l.id).length, `${l.id} は教材があるのに出どころ無しの問いがある`).toBe(0);
    }
  });

  it('模範解答に絶対日付を焼き込んでいない(受験日から再計算できる)', () => {
    const text = lessons.flatMap((l) => l.recallPrompts.map((p) => p.modelAnswer)).join('\n');
    expect(/\d{4}-\d{2}-\d{2}/.test(text)).toBe(false);
  });
});

describe('手を動かす ↔ まず見る', () => {
  it('出題する問題はすべてバンクに存在する', () => {
    for (const l of lessons) {
      for (const id of l.practice.questionIds ?? []) {
        expect(questionById.has(id), `${l.id} が存在しない問題 ${id} を出している`).toBe(true);
      }
    }
  });

  it('同じレッスンで同じ問題を二度出していない', () => {
    for (const l of lessons) {
      const ids = l.practice.questionIds ?? [];
      expect(new Set(ids).size, `${l.id} に重複した出題がある`).toBe(ids.length);
    }
  });

  it('問題は、その問題を作ったレッスンで実際に開く教材から出ている', () => {
    for (const q of questions) {
      const lesson = lessonById.get(q.lessonId);
      expect(lesson, `${q.id} の lessonId ${q.lessonId} が存在しない`).toBeDefined();
      const allowed = new Set(teachingRefs(q.lessonId).map((r) => r.resourceId));
      expect(
        allowed.has(q.sourceResourceId),
        `${q.id} が ${q.sourceResourceId} を出どころにしているが、${q.lessonId} では開かない`,
      ).toBe(true);
      expect(q.sourceWatch.trim(), `${q.id} に見た場所がない`).toBeTruthy();
    }
  });

  /**
   * 週末チェックは前の週の問題を混ぜる。**まだ見ていない内容は出さない**。
   * ここが緩むと「見てから答えられる」という前提が崩れる。
   */
  it('出題する問題は、そのレッスンか、それより前のレッスンで見た内容だけ', () => {
    for (const l of lessons) {
      const here = lessonOrder.get(l.id)!;
      for (const id of l.practice.questionIds ?? []) {
        const q = questionById.get(id)!;
        expect(
          lessonOrder.get(q.lessonId)!,
          `${l.id} が、後のレッスン ${q.lessonId} で見る内容(${id})を出している`,
        ).toBeLessThanOrEqual(here);
      }
    }
  });

  it('アプリ内出題のレッスンは、問題数と目安時間が実際の出題とそろっている', () => {
    const inApp = lessons.filter((l) => l.practice.kind === 'in-app-questions');
    expect(inApp.length).toBeGreaterThan(15);
    for (const l of inApp) {
      expect(l.practice.scored, `${l.id} が無採点になっている`).toBe(true);
      const fixed = l.practice.questionIds;
      if (fixed) {
        expect(l.practice.targetCount, `${l.id} の問題数`).toBe(fixed.length);
      } else {
        // 固定の番号を持たないレッスンは、記録から選ぶ指定が必ずある
        expect(l.practice.questionPool, `${l.id} に出題の指定がない`).toBeTruthy();
        expect(l.practice.targetCount, `${l.id} の問題数`).toBeGreaterThan(0);
      }
      // 解く時間は比率配分で縮めない
      expect(l.stepMinutes?.practice, `${l.id} に解く時間の明示がない`).toBeGreaterThan(0);
      expect(l.estimatedMinutes.minimum).toBeGreaterThanOrEqual(l.stepMinutes!.practice!);
    }
  });
});

describe('自作問題バンク', () => {
  it('IDが重複していない', () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
  });

  it('ファイル名と中身の科目が一致している', () => {
    for (const file of questionFiles) {
      for (const q of file.questions) {
        expect(q.topicId, `${q.id} が ${file.topicId}.json に入っている`).toBe(file.topicId);
      }
    }
  });

  it('4択で、正解が1つあり、選択肢が重複していない', () => {
    for (const q of questions) {
      expect(q.choices.length, `${q.id} の選択肢`).toBe(4);
      expect(new Set(q.choices).size, `${q.id} に同じ選択肢がある`).toBe(4);
      expect(q.answerIndex, `${q.id} の正解番号`).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex, `${q.id} の正解番号`).toBeLessThan(4);
      expect(q.stem.trim(), `${q.id} の問題文`).toBeTruthy();
      // 間違えた直後に読む解説。無いと「なぜ違うのか」が残らない
      expect(q.explanation.trim(), `${q.id} の解説`).toBeTruthy();
    }
  });

  it('過去問の転載ではなく自作であることを型で保証している(著作権)', () => {
    for (const q of questions) {
      expect(q.origin, `${q.id}`).toBe('original');
    }
  });

  it('すべての問題が、実在する科目と出題項目に紐づいている', () => {
    for (const q of questions) {
      expect(topicIdSet.has(q.topicId), `${q.id} の科目 ${q.topicId}`).toBe(true);
      expect(q.syllabusIds.length, `${q.id} に出題項目がない`).toBeGreaterThan(0);
      for (const s of q.syllabusIds) {
        expect(syllabusIds.has(s), `${q.id} の出題項目 ${s} が存在しない`).toBe(true);
      }
    }
  });

  /**
   * 科目別ゲートは「各科目 直近20問で60%以上」。
   * バンクが20問に満たない科目があると、そこはアプリ内だけでは永久にゲートが開かない。
   */
  it('どの科目も、科目別ゲートの判定に足る20問以上ある', () => {
    for (const t of topics) {
      const n = questions.filter((q) => q.topicId === t.id).length;
      expect(n, `${t.shortName} が ${n} 問しかない`).toBeGreaterThanOrEqual(20);
    }
  });

  it('配線図が、本番の配点(50問中20問)に見合う最大の科目になっている', () => {
    const counts = topics.map((t) => ({
      id: t.id,
      n: questions.filter((q) => q.topicId === t.id).length,
    }));
    const top = [...counts].sort((a, b) => b.n - a.n)[0]!;
    expect(top.id).toBe('wiring-diagram');
  });
});

describe('出題範囲のカバレッジ', () => {
  it('出題項目のIDが重複していない', () => {
    expect(new Set(syllabus.map((s) => s.id)).size).toBe(syllabus.length);
  });

  it('重みの合計が学科の50問と一致する', () => {
    const total = syllabus.reduce((n, s) => n + s.weight, 0);
    expect(Math.round(total)).toBe(50);
  });

  it('科目ごとの重みが、公式の出題数の目安と一致する', () => {
    for (const t of topics) {
      const w = syllabus
        .filter((s) => s.topicId === t.id)
        .reduce((n, s) => n + s.weight, 0);
      expect(Math.round(w), `${t.shortName} の重み`).toBe(t.approxQuestions);
    }
  });

  /**
   * ここが本体。**「ツール通りにやれば合格ラインに乗る」の中身**。
   * 教える場所か確かめる問題のどちらかが欠けた項目は、
   * 「動画は見たが確認していない」穴として本番まで残る。
   */
  it('すべての出題項目に、教えるレッスンと確かめる問題がある', () => {
    const taughtBy = new Map<string, string[]>();
    for (const l of lessons) {
      for (const id of l.practice.questionIds ?? []) {
        for (const s of questionById.get(id)!.syllabusIds) {
          taughtBy.set(s, [...(taughtBy.get(s) ?? []), l.id]);
        }
      }
    }
    const testedBy = new Set(questions.flatMap((q) => q.syllabusIds));

    for (const item of syllabus) {
      expect(testedBy.has(item.id), `出題項目「${item.name}」を確かめる問題がない`).toBe(true);
      expect(
        (taughtBy.get(item.id) ?? []).length,
        `出題項目「${item.name}」を出すレッスンがない`,
      ).toBeGreaterThan(0);
    }
  });

  it('技能にも直結する項目が、学科側でも確かめられている', () => {
    const alsoSkill = syllabus.filter((s) => s.alsoSkill);
    expect(alsoSkill.length).toBeGreaterThanOrEqual(8);
    const tested = new Set(questions.flatMap((q) => q.syllabusIds));
    for (const s of alsoSkill) {
      expect(tested.has(s.id), `${s.name}`).toBe(true);
    }
  });
});
