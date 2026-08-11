import { describe, expect, it } from 'vitest';
import { adminTaskTemplates, curriculum, resources, topics } from '../src/data';

const lessonIds = new Set(curriculum.lessons.map((l) => l.id));
const resourceIds = new Set(resources.map((r) => r.id));
const phaseIds = new Set(curriculum.phases.map((p) => p.id));
const topicIds = new Set(topics.map((t) => t.id));

describe('カリキュラムJSONの整合', () => {
  it('IDが重複していない', () => {
    expect(lessonIds.size).toBe(curriculum.lessons.length);
    expect(resourceIds.size).toBe(resources.length);
    expect(phaseIds.size).toBe(curriculum.phases.length);
  });

  it('存在しないフェーズ・前提・教材・科目を参照していない', () => {
    for (const l of curriculum.lessons) {
      expect(phaseIds.has(l.phaseId), `${l.id} phase`).toBe(true);
      for (const pre of l.prerequisites) expect(lessonIds.has(pre), `${l.id} pre ${pre}`).toBe(true);
      for (const r of l.resources) expect(resourceIds.has(r), `${l.id} res ${r}`).toBe(true);
      for (const r of l.practice.resourceIds ?? [])
        expect(resourceIds.has(r), `${l.id} practice res ${r}`).toBe(true);
      for (const t of l.officialTopicIds) expect(topicIds.has(t), `${l.id} topic ${t}`).toBe(true);
    }
  });

  it('前提レッスンが自分より後ろに来ていない(循環・前後逆転がない)', () => {
    const index = new Map(curriculum.lessons.map((l, i) => [l.id, i]));
    for (const l of curriculum.lessons) {
      for (const pre of l.prerequisites) {
        expect(index.get(pre)!, `${l.id} は ${pre} より前にある`).toBeLessThan(index.get(l.id)!);
      }
    }
  });

  it('カリキュラムに絶対日付が焼き込まれていない(受験日から再計算できる)', () => {
    const json = JSON.stringify(curriculum);
    expect(/\d{4}-\d{2}-\d{2}/.test(json)).toBe(false);
  });

  it('7科目は公式の7つ', () => {
    expect(topics.map((t) => t.officialNo)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(topics.map((t) => t.name)).toEqual([
      '電気に関する基礎理論',
      '配電理論及び配線設計',
      '電気機器、配線器具、材料及び工具',
      '電気工事の施工方法',
      '一般用電気工作物等の検査方法',
      '配線図',
      '保安に関する法令',
    ]);
  });

  it('公式資料と民間解説を型で区別している', () => {
    const official = resources.filter((r) => r.role === 'official-check');
    expect(official.length).toBeGreaterThan(5);
    expect(official.every((r) => r.url.startsWith('https://'))).toBe(true);
    // 検証状態を偽らない。到達性を確認していないものは requirements-doc のまま
    expect(resources.every((r) => ['requirements-doc', 'fetched', 'user-confirmed'].includes(r.verification))).toBe(true);
  });

  it('過去問は収録せず、公式ページへ誘導する(著作権)', () => {
    const qa = resources.find((r) => r.id === 'official-qa');
    expect(qa?.copyrightNote).toContain('収録せず');
    // 採点ありの演習はすべて外部教材で解いて結果だけ登録する形(Sprint 1時点)
    const inApp = curriculum.lessons.filter((l) => l.practice.kind === 'in-app-questions');
    expect(inApp).toHaveLength(0);
  });

  it('学科前にも技能に触れるレッスンがある(FR-005)', () => {
    const preAcademicSkillTouch = curriculum.lessons.filter(
      (l) => l.skillTouch && l.phaseId !== 'phase-5' && l.phaseId !== 'phase-6',
    );
    expect(preAcademicSkillTouch.length).toBeGreaterThanOrEqual(4);
  });

  it('手を動かすレッスンには非通電の注意書きが付いている(AT-010)', () => {
    const hands = curriculum.lessons.filter(
      (l) => l.practice.kind === 'basic-skill' || l.practice.kind === 'candidate',
    );
    expect(hands.length).toBeGreaterThan(0);
    for (const l of hands) {
      expect(l.safetyNote, `${l.id} に安全注記がない`).toBeTruthy();
      expect(l.safetyNote).toMatch(/非通電/);
    }
  });

  it('通電した自宅設備での作業を促す文言がない(AT-010)', () => {
    const json = JSON.stringify(curriculum) + JSON.stringify(adminTaskTemplates);
    // 「触らない」「開けない」等の否定形は許すが、作業を促す表現は出さない
    expect(json).not.toMatch(/自宅の照明を(交換|取り付け|外し)/);
    expect(json).not.toMatch(/ブレーカーを落として.*(配線|結線|接続)する/);
  });

  it('候補問題13問すべてに触れる設計になっている(丸ごと間引かない)', () => {
    const phase5 = curriculum.lessons.filter((l) => l.phaseId === 'phase-5');
    const text = phase5.map((l) => `${l.title} ${l.practice.instruction}`).join(' ');
    for (const range of ['No.1〜4', 'No.5〜8', 'No.9〜13']) {
      expect(text).toContain(range);
    }
    expect(phase5.every((l) => l.required)).toBe(true);
  });
});

describe('事務タスクJSONの整合', () => {
  it('FR-002 の11項目がすべてある', () => {
    expect(adminTaskTemplates).toHaveLength(11);
    const ids = adminTaskTemplates.map((t) => t.id);
    expect(ids).toEqual([
      'mypage',
      'application',
      'payment',
      'cbt-reservation',
      'ticket',
      'academic-exam',
      'tools',
      'skill-exam',
      'result',
      'license-apply',
      'license-receive',
    ]);
  });

  it('公式手続きの期限を推定で置いているものには、必ず要確認フラグが立っている', () => {
    // 'tools'(工具を揃える)だけは公式の締切ではなく本ツールが置いた準備目標なので対象外
    const officialProcedures = ['cbt-reservation', 'ticket', 'result', 'license-apply', 'license-receive'];
    for (const t of adminTaskTemplates) {
      if (officialProcedures.includes(t.id)) {
        expect(t.dueSource, `${t.id}`).toBe('derived');
        expect(t.needsUserConfirm, `${t.id}`).toBe(true);
      }
    }
    expect(adminTaskTemplates.find((t) => t.id === 'tools')?.needsUserConfirm).toBe(false);
  });

  it('公式値として扱うのは申込締切と試験日だけ', () => {
    const official = adminTaskTemplates.filter((t) => t.dueSource === 'official').map((t) => t.id);
    expect(official).toEqual(['application', 'academic-exam', 'skill-exam']);
  });
});
