import { useState } from 'react';
import { examCycle } from '../../data';
import { defaultSettings, repo } from '../../db/repo';
import { formatJstDateTime, nowJstIso, todayJst } from '../../domain/jst';
import type { SkillLevel, UserSettings } from '../../domain/types';

/**
 * FR-001 初回設定。2026年度下期を初期値、完全未経験者モードを初期 ON。
 * ここで受験日が未定でも先へ進める。日程が決まっていないことを理由に学習を止めない。
 */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [draft, setDraft] = useState<UserSettings>(() => defaultSettings(examCycle.id));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    await repo.saveSettings({
      ...draft,
      startDate: todayJst(),
      setupCompletedAt: nowJstIso(),
    });
    await onDone();
    setSaving(false);
  };

  return (
    <main className="app">
      <h1>電工二種 合格伴走盤</h1>
      <p className="muted">
        まず5つだけ。あとから設定タブでいつでも変えられる。
      </p>

      <div className="card">
        <h2>対象の試験</h2>
        <p>
          <strong>{examCycle.name}</strong>
        </p>
        <ul className="plain muted">
          <li>申込: {formatJstDateTime(examCycle.applicationStart)} 〜 {formatJstDateTime(examCycle.applicationDeadline)}</li>
          <li>学科CBT: {examCycle.cbtWindowStart} 〜 {examCycle.cbtWindowEnd}</li>
          <li>学科筆記: {examCycle.writtenExamDate}</li>
          <li>技能: {examCycle.skillExamDates.join(' または ')}</li>
        </ul>
        <p className="notice">
          この日程は要件定義書に記載された値(確認日 {examCycle.lastVerified})。
          申込前に<a href={examCycle.sourceUrl} target="_blank" rel="noreferrer">公式ページ</a>で必ず自分の目で確認する。
        </p>
      </div>

      <div className="card">
        <h2>学科の受け方</h2>
        <div className="field">
          <label htmlFor="mode">方式</label>
          <select
            id="mode"
            value={draft.academicMode}
            onChange={(e) => set('academicMode', e.target.value as UserSettings['academicMode'])}
          >
            <option value="cbt">CBT(パソコンで受ける)</option>
            <option value="paper">筆記({examCycle.writtenExamDate})</option>
            <option value="undecided">まだ決めていない</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="academicDate">学科の受験日(未定なら空欄でよい)</label>
          <input
            id="academicDate"
            type="date"
            value={draft.academicDate ?? ''}
            min={examCycle.cbtWindowStart}
            max={examCycle.cbtWindowEnd}
            onChange={(e) => set('academicDate', e.target.value || undefined)}
          />
          <p className="muted">目安は 2026-10-24〜11-01。実際の予約枠に合わせて後で直す。</p>
        </div>
        <div className="field">
          <label htmlFor="skillDate">技能の受験日</label>
          <select
            id="skillDate"
            value={draft.skillDate ?? ''}
            onChange={(e) => set('skillDate', e.target.value || undefined)}
          >
            <option value="">未定</option>
            {examCycle.skillExamDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2>使える時間</h2>
        <div className="field">
          <label htmlFor="weekday">平日1日あたり(分)</label>
          <input
            id="weekday"
            type="number"
            min={0}
            max={480}
            value={draft.weekdayMinutes}
            onChange={(e) => set('weekdayMinutes', Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="weekend">休日1日あたり(分)</label>
          <input
            id="weekend"
            type="number"
            min={0}
            max={600}
            value={draft.weekendMinutes}
            onChange={(e) => set('weekendMinutes', Number(e.target.value))}
          />
        </div>
        <p className="muted">
          初期値は平日35分・休日150分(週およそ5〜6時間)。多く入れるほど計画が前倒しになる。
        </p>
      </div>

      <div className="card">
        <h2>いまの状態</h2>
        {(
          [
            ['knowledgeLevel', '電気の知識'],
            ['handworkLevel', '手を動かす作業'],
            ['toolLevel', '工具の所有'],
          ] as [keyof UserSettings, string][]
        ).map(([key, label]) => (
          <div className="field" key={key}>
            <label htmlFor={String(key)}>{label}</label>
            <select
              id={String(key)}
              value={String(draft[key])}
              onChange={(e) => set(key, Number(e.target.value) as SkillLevel as never)}
            >
              <option value="0">0 まったくない</option>
              <option value="1">1 少しある</option>
              <option value="2">2 ある程度ある</option>
              <option value="3">3 十分ある</option>
            </select>
          </div>
        ))}
        <div className="field">
          <label htmlFor="motivation">なぜ取るのか(あとで見返す)</label>
          <textarea
            id="motivation"
            value={draft.motivation}
            placeholder="例: 自宅の直結式の照明を、自分で合法かつ安全に交換できるようになる"
            onChange={(e) => set('motivation', e.target.value)}
          />
        </div>
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 'auto' }}
            checked={draft.beginnerMode}
            onChange={(e) => set('beginnerMode', e.target.checked)}
          />
          <span>完全未経験者モード(推奨: ON)</span>
        </label>
        <p className="muted">
          ONの間は、いきなり採点付きの診断を出さない。全体像 → 超基礎 → 器具・工具 → 採点なし5問 →
          基礎180分 → 20問診断の順で進む。
        </p>
      </div>

      <div className="notice notice--safety">
        <strong>安全について。</strong>
        免状を受け取るまで、天井・壁から出ている電源線への直結工事はできない。
        練習は必ず試験用の非通電材料で行う。自宅の通電した設備を練習台にしない。
        照明が切れて困ったときは、資格取得を待たずに電気工事店へ依頼する。
      </div>

      <button className="btn-primary btn-block" onClick={save} disabled={saving}>
        {saving ? '保存中…' : 'はじめる'}
      </button>
    </main>
  );
}
