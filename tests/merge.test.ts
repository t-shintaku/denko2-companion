import { describe, expect, it } from 'vitest';
import {
  canonical,
  digest,
  emptyData,
  mergeAll,
  mergeLessonProgress,
  mergeSettings,
  mergeTable,
  pickWinner,
  totalIncoming,
  totalOutgoing,
} from '../src/domain/merge';
import { defaultSettings } from '../src/db/repo';
import { SEED_UPDATED_AT } from '../src/domain/types';
import type { BudgetItem, LessonProgress, QuestionAttempt, StudySession, UserSettings } from '../src/domain/types';

function session(id: string, updatedAt: string, durationMinutes = 25): StudySession {
  return {
    id,
    startedAt: updatedAt,
    jstDate: updatedAt.slice(0, 10),
    durationMinutes,
    kind: 'theory',
    countsAsBasics: true,
    updatedAt,
  };
}

function attempt(id: string, correct: boolean, updatedAt: string): QuestionAttempt {
  return {
    id,
    attemptedAt: updatedAt,
    jstDate: updatedAt.slice(0, 10),
    source: 'test',
    questionRef: id,
    topicId: 'basic-theory',
    correct,
    confidence: 3,
    scored: true,
    updatedAt,
  };
}

function data(patch: Partial<ReturnType<typeof emptyData>>) {
  return { ...emptyData(), ...patch };
}

describe('合体の不変条件', () => {
  it('片方にしかない記録は、どちらも消えずに残る', () => {
    const local = [session('a', '2026-09-01T10:00:00+09:00')];
    const remote = [session('b', '2026-09-02T10:00:00+09:00')];

    const merged = mergeTable(local, remote, 'id');

    expect(merged.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(merged.count.incoming).toBe(1); // b を取り込んだ
    expect(merged.count.outgoing).toBe(1); // a を送る必要がある
  });

  it('【中核】リモートが空でも、この端末の記録を消さない', () => {
    // 初回同期でこれを間違えると、先に使っていた端末の記録が全部消える
    const local = [session('a', '2026-09-01T10:00:00+09:00')];

    const merged = mergeTable(local, [], 'id');

    expect(merged.rows).toHaveLength(1);
    expect(merged.count.incoming).toBe(0);
    expect(merged.count.outgoing).toBe(1);
  });

  it('【中核】ある端末で全削除しても、他端末の記録は復元される', () => {
    // 「片方に無い = 消された」と解釈しない、という規則の裏返し
    const wiped: StudySession[] = [];
    const remote = [session('a', '2026-09-01T10:00:00+09:00'), session('b', '2026-09-02T10:00:00+09:00')];

    const merged = mergeTable(wiped, remote, 'id');

    expect(merged.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('同じ id は updatedAt が新しい方が勝つ', () => {
    const old = attempt('q1', false, '2026-09-01T10:00:00+09:00');
    const fresh = { ...attempt('q1', true, '2026-09-05T10:00:00+09:00'), reviewedAt: '2026-09-05T10:00:00+09:00' };

    expect(pickWinner(old, fresh)).toBe(fresh);
    expect(pickWinner(fresh, old)).toBe(fresh);
  });

  it('【回帰】+09:00 と Z が混ざっても時刻で比較する(辞書順だと逆転する)', () => {
    // Dexie の移行は toISOString()(Z)、通常の書き込みは nowJstIso()(+09:00)。
    // 文字列比較にすると '2026-09-01T21:00:00Z' > '2026-09-02T05:00:00+09:00' となり、
    // 同じ瞬間なのに片方が常に勝つ。ここを文字列比較へ戻さないための固定。
    const zulu = session('a', '2026-09-01T21:00:00Z'); // = 09-02 06:00 JST
    const jst = session('a', '2026-09-02T05:00:00+09:00'); // = 09-01 20:00 UTC。こちらが古い

    expect('2026-09-01T21:00:00Z' > '2026-09-02T05:00:00+09:00').toBe(false); // 辞書順は逆
    expect(pickWinner(zulu, jst)).toBe(zulu); // 実時刻では zulu が新しい
  });

  it('同時刻でも決着し、合体の向きを変えても同じ結果になる(収束)', () => {
    const a = session('x', '2026-09-01T10:00:00+09:00', 25);
    const b = session('x', '2026-09-01T10:00:00+09:00', 40);

    const ab = mergeTable([a], [b], 'id');
    const ba = mergeTable([b], [a], 'id');

    expect(canonical(ab.rows[0]!)).toBe(canonical(ba.rows[0]!));
  });

  it('3端末をどの順で合体しても同じ状態へ落ちる(収束)', () => {
    const phone = data({ studySessions: [session('p', '2026-09-01T10:00:00+09:00')] });
    const pc = data({ studySessions: [session('c', '2026-09-02T10:00:00+09:00')] });
    const tablet = data({ studySessions: [session('t', '2026-09-03T10:00:00+09:00')] });

    const order1 = mergeAll(mergeAll(phone, pc).data, tablet).data;
    const order2 = mergeAll(mergeAll(tablet, phone).data, pc).data;
    const order3 = mergeAll(mergeAll(pc, tablet).data, phone).data;

    expect(digest(order1)).toBe(digest(order2));
    expect(digest(order2)).toBe(digest(order3));
    expect(order1.studySessions.map((s) => s.id)).toEqual(['c', 'p', 't']);
  });

  it('updatedAt が壊れている行も捨てない。最古として扱うだけ', () => {
    const broken = { ...session('a', 'こわれている') };
    const good = session('a', '2026-09-01T10:00:00+09:00');

    expect(pickWinner(broken, good)).toBe(good);
    expect(mergeTable([broken], [], 'id').rows).toHaveLength(1);
  });
});

describe('レッスン進捗の合体(段階ごと)', () => {
  const base = (patch: Partial<LessonProgress> = {}): LessonProgress => ({
    lessonId: 'p1-w1-l1',
    xpAwarded: 0,
    updatedAt: '2026-08-01T10:00:00+09:00',
    ...patch,
  });

  it('【中核】PCで「閉じて答える」・スマホで「解く」を進めても、どちらも消えない', () => {
    // 行ごと勝ち抜きだと updatedAt の新しい側で丸ごと上書きされ、
    // 片方の回答が消える。消えるのは本人が実際にやった学習そのもの
    const pc = base({
      inputViewedAt: '2026-08-01T10:00:00+09:00',
      recallSubmittedAt: '2026-08-01T10:05:00+09:00',
      recallAnswers: ['接地', '絶縁'],
      updatedAt: '2026-08-01T10:05:00+09:00',
    });
    const phone = base({
      inputViewedAt: '2026-08-01T10:00:00+09:00',
      practiceSubmittedAt: '2026-08-02T09:00:00+09:00',
      practiceNote: '5問中4問',
      practiceCorrect: 4,
      practiceTotal: 5,
      updatedAt: '2026-08-02T09:00:00+09:00',
    });

    const merged = mergeLessonProgress(pc, phone);

    expect(merged.recallSubmittedAt).toBe('2026-08-01T10:05:00+09:00');
    expect(merged.recallAnswers).toEqual(['接地', '絶縁']);
    expect(merged.practiceSubmittedAt).toBe('2026-08-02T09:00:00+09:00');
    expect(merged.practiceCorrect).toBe(4);
    expect(merged.practiceTotal).toBe(5);
    expect(merged.inputViewedAt).toBe('2026-08-01T10:00:00+09:00');
  });

  it('合体の向きを変えても同じ結果になる(収束)', () => {
    const pc = base({
      recallSubmittedAt: '2026-08-01T10:05:00+09:00',
      recallAnswers: ['a'],
      updatedAt: '2026-08-01T10:05:00+09:00',
    });
    const phone = base({
      practiceSubmittedAt: '2026-08-02T09:00:00+09:00',
      practiceNote: 'b',
      updatedAt: '2026-08-02T09:00:00+09:00',
    });

    expect(canonical(mergeLessonProgress(pc, phone))).toBe(canonical(mergeLessonProgress(phone, pc)));
  });

  it('同じ段階を両方でやったら、新しい回答を残す', () => {
    const older = base({
      recallSubmittedAt: '2026-08-01T10:00:00+09:00',
      recallAnswers: ['古い'],
      updatedAt: '2026-08-01T10:00:00+09:00',
    });
    const newer = base({
      recallSubmittedAt: '2026-08-03T10:00:00+09:00',
      recallAnswers: ['新しい'],
      updatedAt: '2026-08-03T10:00:00+09:00',
    });

    expect(mergeLessonProgress(older, newer).recallAnswers).toEqual(['新しい']);
    expect(mergeLessonProgress(newer, older).recallAnswers).toEqual(['新しい']);
  });

  it('一度完了した事実は取り消されない。XPも下がらない', () => {
    const done = base({
      inputViewedAt: '2026-08-01T10:00:00+09:00',
      recallSubmittedAt: '2026-08-01T10:01:00+09:00',
      practiceSubmittedAt: '2026-08-01T10:02:00+09:00',
      takeawaySavedAt: '2026-08-01T10:03:00+09:00',
      completedAt: '2026-08-01T10:03:00+09:00',
      xpAwarded: 10,
      updatedAt: '2026-08-01T10:03:00+09:00',
    });
    const stale = base({ inputViewedAt: '2026-08-05T10:00:00+09:00', updatedAt: '2026-08-05T10:00:00+09:00' });

    const merged = mergeLessonProgress(done, stale);

    expect(merged.completedAt).toBe('2026-08-01T10:03:00+09:00');
    expect(merged.xpAwarded).toBe(10);
    expect(merged.takeawaySavedAt).toBe('2026-08-01T10:03:00+09:00');
  });

  it('テーブル合体でも段階ごとの規則が使われる', () => {
    const pc = base({ recallSubmittedAt: '2026-08-01T10:05:00+09:00', updatedAt: '2026-08-01T10:05:00+09:00' });
    const phone = base({ practiceSubmittedAt: '2026-08-02T09:00:00+09:00', updatedAt: '2026-08-02T09:00:00+09:00' });

    const merged = mergeAll(data({ lessonProgress: [pc] }), data({ lessonProgress: [phone] }));

    expect(merged.data.lessonProgress[0]?.recallSubmittedAt).toBe('2026-08-01T10:05:00+09:00');
    expect(merged.data.lessonProgress[0]?.practiceSubmittedAt).toBe('2026-08-02T09:00:00+09:00');
  });
});

describe('カタログ既定値(工具・材料)', () => {
  it('【中核】新しい端末が播いた既定値は、他端末の「購入済み」に勝てない', () => {
    // seedBudgetItems が現在時刻を入れると、技能タブを初めて開いた端末が
    // 他端末の購入記録を既定値へ戻してしまう
    const seeded: BudgetItem = {
      id: 'tool-1',
      category: 'tool',
      label: 'ペンチ',
      status: 'planned',
      required: true,
      updatedAt: SEED_UPDATED_AT,
    };
    const bought: BudgetItem = { ...seeded, status: 'purchased', actualYen: 1800, updatedAt: '2026-09-01T10:00:00+09:00' };

    expect(pickWinner(seeded, bought)).toBe(bought);
    expect(mergeTable([seeded], [bought], 'id').rows[0]!.status).toBe('purchased');
  });
});

describe('設定の合体', () => {
  const base = defaultSettings('2026-h2', new Date('2026-08-12T10:00:00+09:00'));

  it('新しい方を採る', () => {
    const older: UserSettings = { ...base, weekdayMinutes: 35, updatedAt: '2026-09-01T10:00:00+09:00' };
    const newer: UserSettings = { ...base, weekdayMinutes: 60, updatedAt: '2026-09-05T10:00:00+09:00' };

    expect(mergeSettings(older, newer).settings?.weekdayMinutes).toBe(60);
    expect(mergeSettings(newer, older).settings?.weekdayMinutes).toBe(60);
  });

  it('【中核】一度終えた段階は、古い設定が飛んできても取り消されない', () => {
    // ここを素直な「新しい方で丸ごと上書き」にすると、
    // スマホで終えた無採点5問がPCの古い設定で未完了へ戻り、オンボーディングをやり直させる
    const done: UserSettings = {
      ...base,
      ungradedFiveCompletedAt: '2026-08-20T10:00:00+09:00',
      diagnosticCompletedAt: '2026-08-25T10:00:00+09:00',
      updatedAt: '2026-08-25T10:00:00+09:00',
    };
    const staleButNewer: UserSettings = { ...base, weekdayMinutes: 50, updatedAt: '2026-09-01T10:00:00+09:00' };

    const merged = mergeSettings(done, staleButNewer).settings;

    expect(merged?.weekdayMinutes).toBe(50); // 新しい欄は採る
    expect(merged?.ungradedFiveCompletedAt).toBe('2026-08-20T10:00:00+09:00'); // 進んだ事実は残す
    expect(merged?.diagnosticCompletedAt).toBe('2026-08-25T10:00:00+09:00');
  });

  it('受験日が端末ごとに違ったら、黙って上書きせず食い違いとして返す', () => {
    const phone: UserSettings = { ...base, academicDate: '2026-10-03', updatedAt: '2026-09-01T10:00:00+09:00' };
    const pc: UserSettings = { ...base, academicDate: '2026-10-25', updatedAt: '2026-09-02T10:00:00+09:00' };

    const { settings, conflicts } = mergeSettings(phone, pc);

    expect(settings?.academicDate).toBe('2026-10-25');
    expect(conflicts.map((c) => c.field)).toContain('academicDate');
  });

  it('片方に設定が無ければ、ある方をそのまま使う', () => {
    expect(mergeSettings(undefined, base).settings).toBe(base);
    expect(mergeSettings(base, undefined).settings).toBe(base);
    expect(mergeSettings(undefined, undefined).settings).toBeUndefined();
  });
});

describe('指紋(digest)', () => {
  it('同じ内容なら同じ、1件違えば変わる', () => {
    const a = data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00')] });
    const b = data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00')] });
    const c = data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00'), session('b', '2026-09-02T10:00:00+09:00')] });

    expect(digest(a)).toBe(digest(b));
    expect(digest(a)).not.toBe(digest(c));
  });

  it('並び順が違うだけなら同じ指紋(無駄なコミットを積まない)', () => {
    const s1 = session('a', '2026-09-01T10:00:00+09:00');
    const s2 = session('b', '2026-09-02T10:00:00+09:00');

    expect(digest(data({ studySessions: [s1, s2] }))).toBe(digest(data({ studySessions: [s2, s1] })));
  });
});

describe('件数の集計', () => {
  it('取り込み・送信の件数を数える', () => {
    const local = data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00')] });
    const remote = data({ studySessions: [session('b', '2026-09-02T10:00:00+09:00')] });

    const merged = mergeAll(local, remote);

    expect(totalIncoming(merged.counts)).toBe(1);
    expect(totalOutgoing(merged.counts)).toBe(1);
    expect(merged.needsPull).toBe(true);
    expect(merged.needsPush).toBe(true);
  });

  it('同じ内容どうしなら、取り込みも送信も発生しない', () => {
    const same = data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00')] });

    const merged = mergeAll(same, data({ studySessions: [session('a', '2026-09-01T10:00:00+09:00')] }));

    expect(merged.needsPull).toBe(false);
    expect(merged.needsPush).toBe(false);
  });
});
