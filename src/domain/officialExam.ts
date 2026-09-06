import catalog from '../data/official-exams.json';
import { diffDays } from './jst';
import type { IsoDate, MockExam, QuestionAttempt, TopicId } from './types';

export type ExamChoice = 'イ' | 'ロ' | 'ハ' | 'ニ';
export const EXAM_CHOICES: ExamChoice[] = ['イ', 'ロ', 'ハ', 'ニ'];
export const officialPapers = catalog;
export type OfficialPaper = (typeof officialPapers)[number];
export function externalPaperId(url: string): string | undefined {
  if (!/^https:\/\/www\.shiken\.or\.jp\/construction\/upload\/[A-Za-z0-9_.-]+\.pdf$/.test(url)) return undefined;
  return officialPapers.find(p => p.questionUrl === url)?.id ?? `external:${url}`;
}
export const officialRef = (paperId: string, number: number) => `official:${paperId}:${number}`;
/** Mix weak questions and unseen material, then rotate the least recently answered. */
export function officialPractice(paperId: string, attempts: QuestionAttempt[], focus?: number) {
  const latest = new Map<number, QuestionAttempt>();
  for (const a of attempts.filter(a => a.scored && a.questionRef.startsWith(`official:${paperId}:`))
    .sort((a,b) => a.attemptedAt.localeCompare(b.attemptedAt))) {
    latest.set(Number(a.questionRef.split(':')[2]), a);
  }
  const all = Array.from({ length: 50 }, (_,i) => i+1);
  const oldest = [...latest.keys()].sort((a,b) => latest.get(a)!.attemptedAt.localeCompare(latest.get(b)!.attemptedAt));
  const weak = oldest.filter(n => { const a=latest.get(n)!; return a.reviewedAt ? !a.lastReviewCorrect : !a.correct || a.confidence < 3; });
  const fresh = all.filter(n => !latest.has(n));
  return [...new Set([...(focus && all.includes(focus) ? [focus] : []), ...weak.slice(0,3), ...fresh.slice(0,2), ...weak, ...fresh, ...oldest])].slice(0,5);
}
export function parseOfficialRef(ref: string) {
  const match = /^official:(\d{8}):(\d+)$/.exec(ref);
  if (!match) return undefined;
  const paper = officialPapers.find(p => p.id === match[1]);
  const number = Number(match[2]);
  return paper && number >= 1 && number <= 50 ? { paper, number } : undefined;
}

/** Classification is editorial; answer keys and page images are official. */
export function officialTopic(paperId: string, number: number): TopicId {
  if (number >= 31) return 'wiring-diagram';
  if (number >= 28) return 'law';
  if (number >= 24) return 'inspection';
  if (number >= 19) return 'construction-method';
  if (number >= 11) return 'equipment-tools';
  if (number >= (paperId === '20251026' ? 7 : 6)) return 'distribution-design';
  return 'basic-theory';
}

/** No rounded-up scores, retries, tutorials, or stale results can establish readiness. */
export function examReadiness(exams: MockExam[], today: IsoDate) {
  const firstByPaper = new Map<string, MockExam>();
  for (const e of [...exams].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id))) {
    if (!e.officialPaperId || !(officialPapers.some(p => p.id === e.officialPaperId) ||
      (e.officialPaperId.startsWith('external:') && externalPaperId(e.officialPaperId.slice(9))))) continue;
    if (firstByPaper.has(e.officialPaperId)) continue;
    firstByPaper.set(e.officialPaperId, e);
  }
  const qualifying = [...firstByPaper.values()].filter(e =>
    e.kind === 'mock-50' && e.status !== 'in-progress' && e.totalQuestions === 50 && (e.grading === 'official-key' || e.grading === 'self-reported') &&
    e.firstAttempt === true && e.unaided === true && e.timed &&
    typeof e.minutes === 'number' && e.minutes > 0 && e.minutes <= 120 &&
    Number.isInteger(e.correctCount) && e.correctCount >= 0 && e.correctCount <= 50 &&
    diffDays(e.jstDate, today) >= 0 && diffDays(e.jstDate, today) <= 45,
  ).slice(-3);
  const average = qualifying.length === 3 ? qualifying.reduce((s, e) => s + e.correctCount * 2, 0) / 3 : undefined;
  const lowest = qualifying.length ? Math.min(...qualifying.map(e => e.correctCount * 2)) : undefined;
  const selfReported = qualifying.filter(e => e.grading === 'self-reported').length;
  return { qualifying, average, lowest, selfReported,
    passed: average !== undefined && average >= 80 && lowest !== undefined && lowest >= 70,
    evidence: average === undefined ? `初見・自力・120分以内 ${qualifying.length}/3回（直近45日）`
      : `初見3回 平均${average.toFixed(1)}点 / 最低${lowest}点（目標80 / 70）${selfReported ? `・うち自己採点${selfReported}回` : ''}`,
  };
}

export type ExamDraft = {
  id: string; paperId: string; numbers: number[]; mode: 'practice' | 'mock';
  startedAt: number; firstAttempt: boolean; unaided: boolean;
  answers: Record<number, ExamChoice>; unsure: Record<number, boolean>; index: number;
  finishedAt?: number;
};
export function validDraft(value: unknown): value is ExamDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as ExamDraft;
  return typeof d.id === 'string' && officialPapers.some(p => p.id === d.paperId) &&
    (d.mode === 'mock' || d.mode === 'practice') && Number.isFinite(d.startedAt) && d.startedAt > 0 &&
    (d.finishedAt === undefined || (Number.isFinite(d.finishedAt) && d.finishedAt >= d.startedAt)) &&
    Array.isArray(d.numbers) && d.numbers.length > 0 && d.numbers.length <= 50 &&
    d.numbers.every(n => Number.isInteger(n) && n >= 1 && n <= 50) &&
    new Set(d.numbers).size === d.numbers.length &&
    (d.mode !== 'mock' || d.numbers.length === 50) &&
    Number.isInteger(d.index) && d.index >= 0 && d.index < d.numbers.length &&
    typeof d.firstAttempt === 'boolean' && typeof d.unaided === 'boolean' &&
    !!d.answers && typeof d.answers === 'object' && !Array.isArray(d.answers) &&
    Object.entries(d.answers).every(([n,a]) => d.numbers.includes(Number(n)) && EXAM_CHOICES.includes(a)) &&
    !!d.unsure && typeof d.unsure === 'object' && !Array.isArray(d.unsure) &&
    Object.values(d.unsure).every(v => typeof v === 'boolean');
}

export function gradeOfficial(d: ExamDraft) {
  if (!validDraft(d)) throw new Error('解答データを読み取れません。');
  const paper = officialPapers.find(p => p.id === d.paperId)!;
  return d.numbers.map(number => ({ number, correct: d.answers[number] === paper.answers[number - 1],
    topicId: officialTopic(paper.id, number), confidence: (d.unsure[number] ? 1 : 3) as 1 | 3,
    questionRef: officialRef(paper.id, number), answer: paper.answers[number - 1]! }));
}
