import { curriculum, getResource } from '../../data';
import { isLessonComplete, modeForBudget } from '../../domain/lessons';
import { useVault } from '../../state/VaultContext';
import type { LessonMode } from '../../domain/types';

const CANDIDATE_COUNT = 13;

/**
 * Sprint 1 の技能タブは「触れる導線」と「安全の境界」まで。
 * 候補13問の状態管理・欠陥記録・写真・工具予算は Sprint 3(FR-011 / FR-012)。
 * ここで中途半端に記録欄だけ作ると、欠陥カテゴリの型が固まる前にデータが溜まる。
 */
export function PracticalPage({
  onOpenLesson,
}: {
  onOpenLesson: (id: string, mode: LessonMode) => void;
}) {
  const { snapshot } = useVault();
  const skillLessons = curriculum.lessons.filter(
    (l) => l.skillTouch || l.phaseId === 'phase-5' || l.phaseId === 'phase-6',
  );
  const candidates = getResource('official-candidates');
  const defect = getResource('official-defect');

  return (
    <main className="app">
      <h1>技能</h1>

      <div className="notice notice--safety">
        <strong>練習は必ず試験用の非通電材料で行う。</strong>
        <br />
        自宅の通電した設備・壁や天井から出ている電線を練習対象にしない。作った作品に電源をつながない。
        技能試験で電動工具は使用不可(電動機能をOFFにしても不可)。
      </div>

      <div className="notice notice--safety">
        <strong>免状を受け取るまで直結工事はできない。</strong>
        <br />
        既設の引掛シーリング／引掛ローゼットへ器具を取り付けるだけなら一般に無資格でも可能だが、
        天井・壁から出ている電源線へ直接つなぐ工事には免状が要る。
        <br />
        <strong>免状が出る前に照明が切れたら、待たずに電気工事店へ依頼する。</strong>
        暗い部屋で無理をしない。異常発熱・焦げ・水濡れ・古い設備・不明な設備も同じく業者へ。
      </div>

      <h2>候補問題 No.1〜13</h2>
      <div className="card">
        <p className="muted">
          2026年度は公表された候補問題13問から出題。試験時間40分、合格基準は作品に欠陥がないこと。
        </p>
        <div className="row">
          {Array.from({ length: CANDIDATE_COUNT }, (_, i) => (
            <span className="badge" key={i}>
              No.{i + 1} 未着手
            </span>
          ))}
        </div>
        <p className="muted">
          施工記録・欠陥・写真・時間の管理は Sprint 3。いまは「13問あること」を把握するだけでよい。
        </p>
        <div className="row">
          {candidates && (
            <a className="btn btn-sm" href={candidates.url} target="_blank" rel="noreferrer">
              候補問題PDF(公式)
            </a>
          )}
          {defect && (
            <a className="btn btn-sm" href={defect.url} target="_blank" rel="noreferrer">
              欠陥判断基準(公式)
            </a>
          )}
        </div>
      </div>

      <h2>学科前にも触れておく技能</h2>
      <p className="muted">
        学科が終わってから技能をゼロから始めると6週間しかない。週1回でよいので手を動かしておく。
      </p>
      {skillLessons.map((lesson) => (
        <div className="card" key={lesson.id}>
          <div className="row row--between">
            <strong>{lesson.title}</strong>
            <span
              className={
                isLessonComplete(lesson, snapshot.lessonProgress[lesson.id])
                  ? 'badge badge--ok'
                  : 'badge'
              }
            >
              {isLessonComplete(lesson, snapshot.lessonProgress[lesson.id]) ? '完了' : '未完了'}
            </span>
          </div>
          <p className="muted">{lesson.objective}</p>
          <button className="btn-sm" onClick={() => onOpenLesson(lesson.id, modeForBudget(30))}>
            開く
          </button>
        </div>
      ))}
    </main>
  );
}
