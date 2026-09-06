import { useRef, useState } from 'react';
import { repo } from '../../db/repo';
import { getLesson, resources, topicName } from '../../data';
import { presentQuestion, toAttemptInput } from '../../domain/quiz';
import { useVault } from '../../state/VaultContext';
import type { QuizQuestion } from '../../domain/types';

export function PracticeSprint({ questions, onClose }: { questions: QuizQuestion[]; onClose: () => void }) {
  const { reload } = useVault();
  const [cards] = useState(() => questions.map(q => presentQuestion(q)));
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number>();
  const [feedback, setFeedback] = useState<boolean>();
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const started = useRef(Date.now());
  const card = cards[index];
  if (!card) return <main className="app"><p>復習の準備ができたら、ここに5問が届きます。</p><button onClick={onClose}>今日へ戻る</button></main>;
  const resource = resources.find(r => r.id === card.question.sourceResourceId);
  const answer = async (sure: boolean) => {
    if (choice === undefined || lock.current || feedback !== undefined) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = { question: card.question, answer: { questionId: card.question.id, choiceIndex: choice, sure }, correct: choice === card.answerIndex };
      await repo.recordQuiz('daily-practice', [toAttemptInput(result)]);
      setFeedback(result.correct); setCorrect(n => n + Number(result.correct));
      await reload();
    } catch { setError('保存できませんでした。もう一度答えを確定してください。'); }
    finally { lock.current = false; setBusy(false); }
  };
  const finish = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      await repo.addSession({ durationMinutes: Math.round((Date.now() - started.current) / 6000) / 10,
        kind: 'review', countsAsBasics: false });
      await reload(); setDone(true);
    } catch { setError('学習時間を保存できませんでした。回答は保存済みです。'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <main className="app sprint">
    <button className="btn-sm" onClick={onClose}>← 今日へ（確定した回答は保存済み）</button>
    {done ? <section className="coach-celebration">
      <div className="coach-orb" aria-hidden="true">⚡</div><p className="coach-kicker">SESSION COMPLETE</p>
      <h1>{correct === cards.length ? '思い出せた。その調子！' : 'できることを、ひとつ増やした。'}</h1>
      <p className="coach-score">{correct}<small> / {cards.length}問</small></p>
      <p>間違いや迷いは次の復習へ。今日の正解も、日を空けてもう一度確かめます。</p>
      <button className="btn-primary btn-block" onClick={onClose}>今日の続きへ</button>
    </section> : <>
      <p className="coach-kicker">RECALL LAB ・ {index + 1} / {cards.length}</p>
      <progress className="coach-progress" value={index + Number(feedback !== undefined)} max={cards.length} aria-label="復習の進み具合" />
      <h1>今日の5問</h1><span className="badge">{topicName(card.question.topicId)}</span>
      <section className="card sprint-question"><h2>{card.question.stem}</h2>
        <div className="stack">{card.choices.map((c, i) => <button key={i} className={`quiz-choice btn-block ${choice === i ? 'sprint-selected' : ''} ${feedback !== undefined && i === card.answerIndex ? 'quiz-choice--right' : ''}`}
          aria-pressed={choice === i} disabled={feedback !== undefined || busy} onClick={() => setChoice(i)}>{c}</button>)}</div>
        {feedback === undefined ? <><p className="muted">選んだ答えに、どのくらい自信がある？</p><div className="row">
          <button disabled={choice === undefined || busy} onClick={() => void answer(false)}>迷ったけど、これ</button>
          <button className="btn-primary" disabled={choice === undefined || busy} onClick={() => void answer(true)}>理由も分かる</button>
        </div></> : <div className="quiz-feedback" role="status"><h3>{feedback ? '正解！' : 'ここで覚え直せば大丈夫。'}</h3>
          <p>{card.question.explanation}</p><p className="muted">{getLesson(card.question.lessonId)?.title}</p>
          {resource && <a href={resource.url} target="_blank" rel="noreferrer">教材で確かめる ↗</a>}
          <button className="btn-primary btn-block" disabled={busy} onClick={() => {
            if (index + 1 === cards.length) void finish();
            else { setIndex(index + 1); setChoice(undefined); setFeedback(undefined); }
          }}>{index + 1 === cards.length ? '今回の成長を見る' : '次の1問へ'}</button></div>}
      </section>
    </>}{error && <p role="alert">{error}</p>}
  </main>;
}
