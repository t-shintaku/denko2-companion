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

  // 筆記方式は全国一斉。日付は選べない。選ばせると計画も期限も狂う。
  const setMode = (mode: UserSettings['academicMode']) =>
    setDraft((d) => ({
      ...d,
      academicMode: mode,
      academicDate: mode === 'paper' ? examCycle.writtenExamDate : d.academicDate,
    }));
  const paperFixed = draft.academicMode === 'paper';

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
      <h1>DENKO QUESTへようこそ！</h1>
      <p className="muted">
        スタート前に5つだけ。あとでいつでも変えられるよ。
      </p>

      <div className="card">
        <h2>挑戦する試験</h2>
        <p>
          <strong>{examCycle.name}</strong>
        </p>
        <ul className="plain muted">
          <li>申込: {formatJstDateTime(examCycle.applicationStart)} 〜 {formatJstDateTime(examCycle.applicationDeadline)}</li>
          <li>入金期限: {formatJstDateTime(examCycle.paymentDeadline)}(申込締切の翌日。日が違う)</li>
          <li>
            CBT会場予約: {formatJstDateTime(examCycle.cbtReservationStart)} 〜{' '}
            {formatJstDateTime(examCycle.cbtReservationDeadline)}
          </li>
          <li>学科CBT: {examCycle.cbtWindowStart} 〜 {examCycle.cbtWindowEnd}</li>
          <li>学科筆記: {examCycle.writtenExamDate}(全国一斉)</li>
          <li>技能: {examCycle.skillExamDates.join(' または ')}(試験地による)</li>
          <li>受験手数料: {examCycle.examFeeInternetYen.toLocaleString()}円</li>
        </ul>
        <p className="notice">
          出典は<a href={examCycle.sourcePdfUrl ?? examCycle.sourceUrl} target="_blank" rel="noreferrer">令和8年度下期受験案内</a>
          (確認日 {examCycle.lastVerified})。{examCycle.feeNote}
          {' '}申込前に<a href={examCycle.sourceUrl} target="_blank" rel="noreferrer">公式ページ</a>もチェックしよう。
        </p>
      </div>

      <div className="card">
        <h2>学科の受け方</h2>
        <div className="field">
          <label htmlFor="mode">方式</label>
          <select
            id="mode"
            value={draft.academicMode}
            onChange={(e) => setMode(e.target.value as UserSettings['academicMode'])}
          >
            <option value="cbt">CBT(パソコンで受ける)</option>
            <option value="paper">筆記({examCycle.writtenExamDate} 全国一斉)</option>
            <option value="undecided">まだ決めていない</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="academicDate">学科の受験日{paperFixed ? '(筆記は全国一斉で固定)' : '(未定なら空欄でOK)'}</label>
          <input
            id="academicDate"
            type="date"
            value={draft.academicDate ?? ''}
            min={examCycle.cbtWindowStart}
            max={examCycle.cbtWindowEnd}
            disabled={paperFixed}
            onChange={(e) => set('academicDate', e.target.value || undefined)}
          />
          <p className="muted">
            {paperFixed
              ? `筆記は ${examCycle.writtenExamDate} の全国一斉。この日でセットしたよ。`
              : `CBTは ${examCycle.cbtWindowStart}〜${examCycle.cbtWindowEnd} から予約。いまは目安で入れて、予約後に更新しよう。`}
          </p>
        </div>
        <div className="field">
          <label htmlFor="skillDate">技能の受験日(仮)</label>
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
          <p className="muted">
            技能試験日は<strong>試験地によって決まる</strong>。
            いまは仮の日でOK。受験票が届いたら更新しよう。
          </p>
        </div>
      </div>

      <div className="card">
        <h2>勉強ペース</h2>
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
          初期値は平日35分・休日150分。無理のない数字でOK。あとで何度でも調整できる。
        </p>
      </div>

      <div className="card">
        <h2>いまのスタート地点</h2>
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
          <label htmlFor="motivation">合格したら、何をしたい？</label>
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
          <span>はじめてモード(おすすめ: ON)</span>
        </label>
        <p className="muted">
          ONなら、いきなり採点しない。全体像 → 超基礎 → 器具・工具 → お試し5問 →
          基礎180分 → 20問診断の順に案内するよ。
        </p>
      </div>

      <div className="notice notice--safety">
        <strong>ここだけは約束！</strong>
        免状を受け取るまで、天井・壁から出ている電源線への直結工事はできない。
        練習は必ず試験用の非通電材料で行う。自宅の通電した設備を練習台にしない。
        照明が切れて困ったときは、資格取得を待たずに電気工事店へ依頼する。
      </div>

      <button className="btn-primary btn-block" onClick={save} disabled={saving}>
        {saving ? '準備中…' : '冒険をはじめる'}
      </button>
    </main>
  );
}
