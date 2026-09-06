import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { questions, topicIds } from '../src/data';
import { dailyPractice, learningDays } from '../src/domain/studyCoach';
import { applyReview, reviewQueue, topicStats } from '../src/domain/academic';
import { examReadiness, externalPaperId, gradeOfficial, officialPapers, officialPractice, officialRef, validDraft, type ExamDraft } from '../src/domain/officialExam';
import { Repo } from '../src/db/repo';
import { Denko2Db } from '../src/db/db';
import { emptyData, mergeAll } from '../src/domain/merge';
import { validateBackup } from '../src/domain/backup';
import type { MockExam, QuestionAttempt } from '../src/domain/types';

const date = '2026-09-06';
const exam = (i: number, correct = 40): MockExam => ({ id: `exam-${i}`, takenAt: `2026-09-0${i+1}T12:00:00+09:00`,
  updatedAt: `2026-09-0${i+1}T12:00:00+09:00`, jstDate: `2026-09-0${i+1}`, label: '公式', kind: 'mock-50',
  totalQuestions: 50, correctCount: correct, timed: true, minutes: 100, officialPaperId: officialPapers[i]!.id,
  grading: 'official-key', firstAttempt: true, unaided: true, status: 'completed' });
const draft = (id = 'run'): ExamDraft => ({ id, paperId: officialPapers[0]!.id, numbers: Array.from({ length: 50 }, (_,i) => i+1),
  mode: 'mock', startedAt: Date.parse('2026-09-06T10:00:00+09:00'), firstAttempt: true, unaided: true, answers: {}, unsure: {}, index: 0 });

describe('公式の得点と証拠', () => {
  it('5回250問の正答・問題画像・図面がすべて実在する', () => {
    expect(officialPapers).toHaveLength(5);
    for (const p of officialPapers) {
      expect(p.answers).toHaveLength(50); expect(p.questionPages).toHaveLength(50);
      for (let n=1;n<=50;n++) { expect('イロハニ').toContain(p.answers[n-1]); expect(existsSync(`public/exams/${p.id}/q-${n}.webp`)).toBe(true); }
      expect(existsSync(`public/exams/${p.id}/page-15.webp`)).toBe(true);
      for (const n of p.reflow) for (const part of ['stem','0','1','2','3']) expect(existsSync(`public/exams/${p.id}/q-${n}-${part}.webp`)).toBe(true);
    }
  });
  it('未回答を誤答として50問で採点し、図面の科目を手入力させない', () => {
    const d = draft(); d.answers[31] = officialPapers[0]!.answers[30] as 'イ';
    const result = gradeOfficial(d);
    expect(result.filter(r => r.correct)).toHaveLength(1); expect(result[30]!.topicId).toBe('wiring-diagram');
  });
  it('異なる初見3回の平均80・最低70を要求する', () => {
    expect(examReadiness([exam(0),exam(1),exam(2)],date).passed).toBe(true);
    expect(examReadiness([exam(0,50),exam(1,50),exam(2,20)],date).passed).toBe(false);
  });
  it.each(['firstAttempt','unaided','timed'] as const)('%sを満たさない回を数えない', key => {
    expect(examReadiness([exam(0),exam(1),{...exam(2),[key]:false}],date).passed).toBe(false);
  });
  it('120分超過・46日前・重複・途中・自己申告だけの旧模試を除く', () => {
    for (const e of [{...exam(2),minutes:120.001},{...exam(2),jstDate:'2026-07-22'},
      {...exam(2),officialPaperId:exam(0).officialPaperId},{...exam(2),status:'in-progress' as const}, {...exam(2),grading:undefined}]) {
      expect(examReadiness([exam(0),exam(1),e],date).passed).toBe(false);
    }
  });
  it('最初に練習した同じ回を後から初見と申告しても通さない', () => {
    const practiced = {...exam(2),takenAt:'2026-08-01T12:00:00+09:00', firstAttempt:false};
    expect(examReadiness([exam(0),exam(1),practiced,exam(2)],date).passed).toBe(false);
  });
  it('別年度の公式PDFの自己採点には出典と区別を残す', () => {
    const id = externalPaperId('https://www.shiken.or.jp/construction/upload/20231029_co_second_q01.pdf');
    expect(id).toBeTruthy(); expect(externalPaperId('https://example.com/fake.pdf')).toBeUndefined();
    const r = examReadiness([exam(0),exam(1),{...exam(2),officialPaperId:id,grading:'self-reported'}],date);
    expect(r.passed).toBe(true); expect(r.evidence).toContain('自己採点1回');
  });
  it('壊れた途中回答を採点に使わない', () => {
    expect(validDraft({...draft(),answers:[]})).toBe(false);
    expect(validDraft({...draft(),numbers:[1,1]})).toBe(false);
    expect(validDraft({...draft(),answers:{1:'A'}})).toBe(false);
  });
  it('同秒の同期でも採点完了が開始状態へ戻らない', () => {
    const completed=exam(0), started={...completed,status:'in-progress' as const,correctCount:0};
    const a={...emptyData(),mockExams:[completed]}, b={...emptyData(),mockExams:[started]};
    expect(mergeAll(a,b).data.mockExams[0]!.status).toBe('completed');
    expect(mergeAll(b,a).data.mockExams[0]!.status).toBe('completed');
  });
});

describe('復習が実際に回る', () => {
  it('公式練習は最新の誤答と未見を混ぜ、全問履修後も先頭5問に固定しない', () => {
    const paper=officialPapers[0]!.id;
    const a=(n:number,correct=true,at='2026-09-05T10:00:00+09:00') => ({ questionRef:officialRef(paper,n),scored:true,correct,confidence:3,attemptedAt:at } as QuestionAttempt);
    expect(officialPractice(paper,[a(1,false),a(1,true),a(2,false)])).toEqual([2,3,4,5,6]);
    const history=Array.from({length:50},(_,i)=>a(i+1));
    history.push(...[1,2,3,4,5].map(n=>a(n,true,'2026-09-06T10:00:00+09:00')));
    expect(officialPractice(paper,history)).toEqual([6,7,8,9,10]);
    expect(officialPractice(paper,history,40)[0]).toBe(40);
  });
  const db = new Denko2Db('coach-tests'); const repo = new Repo(db);
  beforeEach(async () => repo.wipe());
  it('未学習の問題を突然出さない', () => { expect(dailyPractice(questions,[],{},date)).toEqual([]); });
  it('確信した正解も翌日に戻り、同日連打で間隔が伸びず、同じ問題は1件', async () => {
    const q=questions[0]!;
    const item={questionRef:q.id,topicId:q.topicId,correct:true,confidence:3 as const};
    for(let i=0;i<6;i++) await repo.recordQuiz('daily',[item],new Date(`2026-09-06T12:0${i}:00+09:00`));
    const a=(await repo.load()).questionAttempts;
    expect(reviewQueue(a,topicStats(a,topicIds),30,'2026-09-06')).toHaveLength(0);
    expect(reviewQueue(a,topicStats(a,topicIds),30,'2026-09-07')).toHaveLength(1);
    expect(a.every(x => x.nextReviewOn==='2026-09-07')).toBe(true);
    expect(a.every(x => (x.reviewCount??0)===0)).toBe(true);
  });
  it('翌日の実際の解き直しで初めて段階が進む', () => {
    const a={reviewedAt:'2026-09-05T10:00:00+09:00',reviewCount:1,nextReviewOn:'2026-09-06'} as QuestionAttempt;
    expect(applyReview(a,true,'2026-09-06T10:00:00+09:00',date).nextReviewOn).toBe('2026-09-09');
  });
  it('公式の開始・完了と再保存は無損失・重複なしで、次回は初見でなくなる', async () => {
    const d=draft(); expect(await repo.beginOfficial(d)).toBe(true);
    d.finishedAt=d.startedAt+600000; await repo.finishOfficial(d); await repo.finishOfficial(d);
    const s=await repo.load(); expect(s.mockExams).toHaveLength(1); expect(s.questionAttempts).toHaveLength(50); expect(s.studySessions).toHaveLength(1);
    const backup=await repo.exportBackup(new Date('2026-09-06T14:00:00+09:00'));
    expect(validateBackup(JSON.stringify(backup),new Date('2026-09-06T14:00:00+09:00')).ok).toBe(true);
    expect(await repo.beginOfficial(draft('second'))).toBe(false);
  });
  it('ゼロ分の空セッションを学習日数にしない', () => { expect(learningDays([],[],date).filter(d=>d.active)).toHaveLength(0); });
});
