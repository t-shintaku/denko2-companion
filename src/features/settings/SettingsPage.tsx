import { useRef, useState } from 'react';
import { examCycle, resources } from '../../data';
import { repo } from '../../db/repo';
import { APP_VERSION, backupFileName, validateBackup } from '../../domain/backup';
import { buildIcs, icsFileName } from '../../domain/ics';
import { formatJstDateTime, nowJstIso } from '../../domain/jst';
import { SCHEMA_VERSION } from '../../domain/types';
import { AdminTaskList } from '../milestones/AdminTaskList';
import { useVault } from '../../state/VaultContext';
import type { UserSettings } from '../../domain/types';

export function SettingsPage() {
  const { settings, adminTasks, onboarding, reload } = useVault();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>('');
  const [issues, setIssues] = useState<string[]>([]);
  const [wipeArmed, setWipeArmed] = useState(false);

  if (!settings) return null;

  const patch = async (p: Partial<UserSettings>) => {
    await repo.saveSettings({ ...settings, ...p });
    await reload();
  };

  const download = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doExport = async () => {
    const backup = await repo.exportBackup();
    download(JSON.stringify(backup, null, 2), backupFileName(), 'application/json');
    setMessage(`書き出した(schemaVersion ${SCHEMA_VERSION})。`);
  };

  const doIcsExport = () => {
    const ics = buildIcs(adminTasks);
    download(ics, icsFileName(), 'text/calendar;charset=utf-8');
    setMessage('期限をカレンダーへ書き出した。ファイルを開いてカレンダーへ取り込む。');
  };

  const doImport = async (file: File) => {
    setIssues([]);
    const text = await file.text();
    const result = validateBackup(text);
    if (!result.ok) {
      // 壊れたJSONでは既存データに一切触らない(AT-009)
      setIssues(result.issues.map((i) => `${i.path}: ${i.message}`));
      setMessage('読み込めなかった。既存のデータはそのまま残している。');
      return;
    }
    await repo.importBackup(result.backup);
    await reload();
    setMessage(
      result.migratedFrom !== undefined
        ? `復元した(schemaVersion ${result.migratedFrom} → ${SCHEMA_VERSION} へ移行)。`
        : '復元した。',
    );
  };

  return (
    <main className="app">
      <h1>設定</h1>

      <h2>受験日・方式</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="s-mode">学科の方式</label>
          <select
            id="s-mode"
            value={settings.academicMode}
            onChange={(e) => {
              const mode = e.target.value as UserSettings['academicMode'];
              void patch(
                mode === 'paper'
                  ? { academicMode: mode, academicDate: examCycle.writtenExamDate }
                  : { academicMode: mode },
              );
            }}
          >
            <option value="cbt">CBT</option>
            <option value="paper">筆記(全国一斉)</option>
            <option value="undecided">未定</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-academic">学科の受験日</label>
          <input
            id="s-academic"
            type="date"
            value={settings.academicDate ?? ''}
            disabled={settings.academicMode === 'paper'}
            onChange={(e) => patch({ academicDate: e.target.value || undefined })}
          />
          {settings.academicMode === 'paper' && (
            <p className="muted">
              筆記方式は {examCycle.writtenExamDate} の全国一斉。日付は変更できない。
            </p>
          )}
        </div>
        {settings.academicMode === 'cbt' && (
          <>
            <div className="field">
              <label htmlFor="s-venue">CBT会場</label>
              <input
                id="s-venue"
                value={settings.academicVenue ?? ''}
                onChange={(e) => patch({ academicVenue: e.target.value })}
              />
            </div>
            <p className="notice">
              <strong>CBT会場の予約期間: {formatJstDateTime(examCycle.cbtReservationStart)} 〜{' '}
              {formatJstDateTime(examCycle.cbtReservationDeadline)}</strong>
              <br />
              受験申込みとは別手続きで、申込み時には予約できない。この期間内に予約が完了しないと
              CBT方式・筆記方式ともに受験できない。予約変更は試験日の3日前まで。
            </p>
            <label className="row">
              <input
                type="checkbox"
                style={{ width: 'auto', minHeight: 'auto' }}
                checked={settings.academicReserved}
                onChange={(e) => patch({ academicReserved: e.target.checked })}
              />
              <span>会場予約は済んでいる</span>
            </label>
          </>
        )}
        <div className="field">
          <label htmlFor="s-skill">技能の受験日(仮)</label>
          <select
            id="s-skill"
            value={settings.skillDate ?? ''}
            onChange={(e) => patch({ skillDate: e.target.value || undefined })}
          >
            <option value="">未定</option>
            {examCycle.skillExamDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <p className="muted">
            技能試験日は試験地によって決まる。ここは計画用の仮置きで、受験票で確定させる。
          </p>
        </div>
        <p className="notice">
          出典:{' '}
          <a href={examCycle.sourcePdfUrl ?? examCycle.sourceUrl} target="_blank" rel="noreferrer">
            令和8年度下期 受験案内
          </a>
          (本文を読んで確認・{examCycle.lastVerified})。
          申込 {formatJstDateTime(examCycle.applicationStart)} 〜{' '}
          {formatJstDateTime(examCycle.applicationDeadline)}、
          入金期限 {formatJstDateTime(examCycle.paymentDeadline)}。
          {examCycle.verificationNote}
        </p>
      </div>

      <h2>学習できる時間</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="s-weekday">平日(分/日)</label>
          <input
            id="s-weekday"
            type="number"
            min={0}
            max={480}
            value={settings.weekdayMinutes}
            onChange={(e) => patch({ weekdayMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="s-weekend">休日(分/日)</label>
          <input
            id="s-weekend"
            type="number"
            min={0}
            max={600}
            value={settings.weekendMinutes}
            onChange={(e) => patch({ weekendMinutes: Number(e.target.value) })}
          />
        </div>
      </div>

      <h2>進み方</h2>
      <div className="card">
        <label className="row">
          <input
            type="checkbox"
            style={{ width: 'auto', minHeight: 'auto' }}
            checked={settings.beginnerMode}
            onChange={(e) => patch({ beginnerMode: e.target.checked })}
          />
          <span>完全未経験者モード</span>
        </label>
        <p className="muted">
          OFFにすると段階の縛りが外れ、すべてのレッスンが並ぶ。初回はONのままを勧める。
        </p>
        {onboarding.diagnosticManualUnlockOffered && (
          <>
            <p className="muted">
              基礎 {onboarding.basicsMinutes} 分。既に内容が理解できているなら、
              {onboarding.basicsRequiredMinutes}分を待たずに20問診断へ進める。
            </p>
            <button
              className="btn-sm"
              onClick={() => patch({ diagnosticUnlockedManually: true })}
            >
              20問診断を今すぐ解禁する
            </button>
          </>
        )}
      </div>

      <h2>手続きの期限</h2>
      <div className="card">
        <p className="muted">
          このアプリは開かなければ何も言わない。期限だけはスマホのカレンダーへ移しておく。
          7日前と前日に通知が出る。
        </p>
        <button className="btn-primary btn-block" onClick={doIcsExport}>
          期限をカレンダーへ書き出す(.ics)
        </button>
      </div>
      <AdminTaskList tasks={adminTasks} />

      <h2>教材カタログ</h2>
      <div className="card">
        <p className="muted">
          教材は学習開始時に増やさない。同じ概念で3回詰まったときだけ、補助を1つ足す。
        </p>
        <ul className="plain stack">
          {resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.title}
              </a>
              <div className="muted">
                {r.provider} ・{r.role === 'official-check' ? '公式' : r.role === 'primary' ? '主教材' : '補助'}
                {r.examYear ? ` ・${r.examYear}年度対応` : ''} ・確認日 {r.lastVerified}
                {r.verification === 'requirements-doc' && '(要件書記載。到達性は未検証)'}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <h2>バックアップ</h2>
      <div className="card">
        <p className="muted">
          データはこの端末の中だけにある。アカウントもサーバーもない。端末を初期化すると消える。
          月に一度は書き出してGoogle Driveへ置く。
        </p>
        <div className="stack">
          <button className="btn-primary btn-block" onClick={doExport}>
            JSONへ書き出す
          </button>
          <button className="btn-block" onClick={() => fileRef.current?.click()}>
            JSONから復元する
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {message && <p className="notice">{message}</p>}
        {issues.length > 0 && (
          <ul className="plain muted">
            {issues.map((i) => (
              <li key={i}>・{i}</li>
            ))}
          </ul>
        )}
      </div>

      <h2>全部消す</h2>
      <div className="card">
        <p className="muted">
          消す前に必ず書き出す。取り消せない。
        </p>
        {!wipeArmed ? (
          <button className="btn-danger btn-block" onClick={() => setWipeArmed(true)}>
            すべてのデータを削除する
          </button>
        ) : (
          <div className="stack">
            <p className="notice notice--safety">
              本当に削除する? 学習記録・設定・不明語がすべて消える。先に「JSONへ書き出す」を実行した?
            </p>
            <button
              className="btn-danger btn-block"
              onClick={async () => {
                await repo.wipe();
                await reload();
                setWipeArmed(false);
                setMessage('削除した。');
              }}
            >
              はい、削除する(2段階目)
            </button>
            <button className="btn-block" onClick={() => setWipeArmed(false)}>
              やめる
            </button>
          </div>
        )}
      </div>

      <h2>安全と資格の境界</h2>
      <div className="card">
        <ul className="plain stack">
          <li>通電した自宅設備を練習対象にしない。試験用・非通電材料だけで練習する。</li>
          <li>
            天井・壁から出ている電源線へ器具を直接つなぐ直結式工事には、免状が要る。
            既設の引掛シーリング／引掛ローゼットへ取り付けるだけなら一般に無資格でも可能。
          </li>
          <li>
            <strong>合格 ≠ 完了。</strong>住民票のある都道府県へ申請し、免状を受け取って初めて最終到達。
          </li>
          <li>
            免状が出る前に照明が切れたら、待たずに電気工事店へ依頼する。
          </li>
          <li>
            異常な発熱・焼損・水濡れ・古い設備・不明な設備、そして自信が持てないときは専門業者へ。
          </li>
          <li>本ツールは開業・請負の支援を対象としない。</li>
        </ul>
      </div>

      <p className="muted">
        アプリ {APP_VERSION} / schemaVersion {SCHEMA_VERSION} / 設定更新 {formatJstDateTime(settings.updatedAt || nowJstIso())}
      </p>
    </main>
  );
}
