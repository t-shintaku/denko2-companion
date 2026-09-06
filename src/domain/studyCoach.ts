import { addDays, diffDays } from './jst';
import { IN_APP_SOURCE } from './quiz';
import type { IsoDate, LessonProgress, QuestionAttempt, QuizQuestion, StudySession } from './types';

export function questionMemory(question: QuizQuestion, attempts: QuestionAttempt[], today: IsoDate) {
  const history = attempts.filter(a => a.scored && a.source === IN_APP_SOURCE && a.questionRef === question.id)
    .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
  const last = history.at(-1);
  const lastEvent = last?.reviewedAt ?? last?.attemptedAt;
  const correct = last?.reviewedAt ? last.lastReviewCorrect : last?.correct;
  const secure = correct === true && (last?.reviewedAt ? last.lastReviewCorrect === true : last?.confidence === 3);
  const events = history.flatMap(a => [{ at: a.attemptedAt, secure: a.correct && a.confidence === 3 },
    ...(a.reviewedAt ? [{ at: a.reviewedAt, secure: a.lastReviewCorrect === true }] : [])]).sort((a,b) => a.at.localeCompare(b.at));
  const lastMiss = events.findLastIndex(e => !e.secure);
  const days = new Set(events.slice(lastMiss + 1).filter(e => e.secure).map(e => e.at.slice(0,10)));
  const spaced = secure && days.size >= 2 && diffDays([...days].sort()[0]!, [...days].sort().at(-1)!) >= 3;
  const due = last ? last.nextReviewOn ? last.nextReviewOn <= today
    : !secure || (lastEvent ? diffDays(lastEvent.slice(0, 10), today) >= 7 : true) : false;
  return { seen: !!last, secure, spaced, due, lastDay: lastEvent?.slice(0, 10), nextReviewOn: last?.nextReviewOn };
}

/** Review only material already taught; never use a blind full-bank diagnostic for beginners. */
export function dailyPractice(bank: QuizQuestion[], attempts: QuestionAttempt[], progress: Record<string, LessonProgress>, today: IsoDate, limit = 5) {
  const eligible = bank.filter(q => progress[q.lessonId]?.inputViewedAt || attempts.some(a => a.source === IN_APP_SOURCE && a.questionRef === q.id));
  const ranked = eligible.map(question => ({ question, memory: questionMemory(question, attempts, today) }));
  const due = ranked.filter(q => q.memory.due).sort((a,b) => Number(a.memory.secure) - Number(b.memory.secure) || (a.memory.lastDay ?? '').localeCompare(b.memory.lastDay ?? ''));
  const fresh = ranked.filter(q => !q.memory.seen);
  const retained = ranked.filter(q => q.memory.seen && !q.memory.due && q.memory.lastDay !== today && (!q.memory.nextReviewOn || q.memory.nextReviewOn <= today))
    .sort((a,b) => (a.memory.lastDay ?? '').localeCompare(b.memory.lastDay ?? ''));
  const picked = [...due.slice(0, 3), ...fresh.slice(0, 2)];
  for (const candidate of [...due, ...fresh, ...retained]) {
    if (picked.length >= limit) break;
    if (!picked.some(p => p.question.id === candidate.question.id)) picked.push(candidate);
  }
  return picked.slice(0, limit);
}

export function learningDays(sessions: StudySession[], attempts: QuestionAttempt[], today: IsoDate) {
  const dates = new Set([...sessions.filter(s => s.durationMinutes > 0).map(s => s.jstDate), ...attempts.filter(a => a.scored).map(a => a.jstDate)]);
  return Array.from({ length: 7 }, (_, i) => { const date = addDays(today, i - 6); return { date, active: dates.has(date) }; });
}
