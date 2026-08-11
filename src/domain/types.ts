/**
 * ドメイン型。要件正本: projects/electrician-class-2-tool-requirements-final.md
 *
 * 設計の要点(要件書 §12 からの差分は README の「要件書との差分」に記載):
 * - 日付は JST の 'YYYY-MM-DD'、時刻を持つものは ISO8601+09:00 を明示的に分けた。
 *   申込は 2026-08-17 10:00 開始 / 09-03 17:00 締切なので、日付だけでは表現できない。
 * - 公式値(official)と本ツールの推定値(derived)を型で区別する(§13 信頼性)。
 * - カリキュラムは絶対日付を持たない。受験日と開始日から実行時に配置する(FR-005)。
 */

export const SCHEMA_VERSION = 1;

/** JST の暦日。'YYYY-MM-DD' */
export type IsoDate = string;
/** タイムゾーンオフセット付き ISO8601。'2026-08-17T10:00:00+09:00' */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// マスタ(バンドルJSON。ユーザーデータではない)
// ---------------------------------------------------------------------------

/** 学科の公式7科目(要件書 §3.2) */
export type TopicId =
  | 'basic-theory'
  | 'distribution-design'
  | 'equipment-tools'
  | 'construction-method'
  | 'inspection'
  | 'wiring-diagram'
  | 'law';

export type Topic = {
  id: TopicId;
  officialNo: number;
  name: string;
  shortName: string;
  /** 学科50問中のおおよその出題数(公式の科目別内訳ではなく運用上の目安) */
  approxQuestions: number;
};

/** 値の出どころ。UI で必ず区別して表示する(AT-001 / §13 信頼性) */
export type ValueSource = 'official' | 'derived' | 'user';

export type ExamCycle = {
  id: string;
  name: string;
  /** 申込開始。日付だけでなく時刻を持つ */
  applicationStart: IsoDateTime;
  applicationDeadline: IsoDateTime;
  /** 受験手数料の入金期限。申込締切(9/3)とは別の日(9/4)なので独立して持つ */
  paymentDeadline: IsoDateTime;
  /** CBT会場予約は受験日からの逆算ではなく、年度ごとの固定期間 */
  cbtReservationStart: IsoDateTime;
  cbtReservationDeadline: IsoDateTime;
  cbtWindowStart?: IsoDate;
  cbtWindowEnd?: IsoDate;
  writtenExamDate?: IsoDate;
  skillExamDates: IsoDate[];
  skillResultAnnouncement?: IsoDateTime;
  examFeeInternetYen: number;
  feeNote?: string;
  sourceUrl: string;
  sourcePdfUrl?: string;
  lastVerified: IsoDate;
  /** 値の検証方法。嘘をつかないための欄。'fetched' は一次資料の本文を実際に読んだもの */
  verification: 'requirements-doc' | 'fetched' | 'user-confirmed';
  verificationNote?: string;
};

export type AdminTaskCategory = 'application' | 'academic' | 'skill' | 'license';

/** 事務期限の基準点。実際の日付は選択した受験日から実行時に計算する */
export type AdminAnchor =
  | { kind: 'fixed' }
  | { kind: 'academic'; offsetDays: number }
  | { kind: 'skill'; offsetDays: number };

export type AdminTaskTemplate = {
  id: string;
  order: number;
  category: AdminTaskCategory;
  title: string;
  description: string;
  /** 受付開始。これを過ぎたら「今日からできる」として提示する(§10 の穴を埋める) */
  opensAt?: IsoDateTime;
  /** anchor.kind === 'fixed' のときだけ有効 */
  dueAt?: IsoDateTime;
  anchor: AdminAnchor;
  dueSource: ValueSource;
  /** true のとき UI に確認を促す注意書きを出す */
  needsUserConfirm: boolean;
  /** 何を確認すべきかの具体文。無ければ「受験日から逆算した推定値」の既定文を出す */
  confirmNote?: string;
  /** CBT を選んだときだけ必要 など */
  appliesTo?: 'cbt' | 'paper';
  required: boolean;
  officialUrl?: string;
};

export type ResourceType = 'official' | 'video' | 'article' | 'quiz' | 'pdf';
export type ResourceRole = 'primary' | 'supplement' | 'official-check';

export type LearningResource = {
  id: string;
  provider: string;
  title: string;
  url: string;
  type: ResourceType;
  topicIds: TopicId[];
  role: ResourceRole;
  expectedMinutes?: number;
  examYear?: number;
  lastVerified: IsoDate;
  /** lastVerified の意味。'requirements-doc' は「要件書に記載された日」であり到達性確認ではない */
  verification: 'requirements-doc' | 'fetched' | 'user-confirmed';
  replacementResourceId?: string;
  copyrightNote?: string;
  note?: string;
};

export type RecallPrompt = {
  id: string;
  /** 選択式 / 穴埋め / 1行 / 音声メモ(FR-007) */
  kind: 'choice' | 'cloze' | 'free-line' | 'voice-memo';
  prompt: string;
  choices?: string[];
  answerHint?: string;
};

export type PracticeKind =
  | 'external-questions' // 外部教材・公式過去問を解いて結果だけ登録(FR-010 P0)
  | 'in-app-questions' // アプリ内出題(Sprint 2 / FR-010 P1)
  | 'wiring-diagram' // 複線図を描く
  | 'basic-skill' // 技能の基本作業
  | 'candidate' // 候補問題1題
  | 'checklist'; // 事務・準備系の確認

export type PracticeSpec = {
  kind: PracticeKind;
  /** 小問3〜10問など。件数の目安 */
  targetCount?: number;
  instruction: string;
  /** 外部教材へ誘導する場合の参照先 */
  resourceIds?: string[];
  /** 採点対象か。無採点5問は false(FR-003 / AT-002) */
  scored: boolean;
};

/** §5.2 の完了条件。現状は全レッスン同一だが将来の緩和に備えて型で持つ */
export type CompletionRule = {
  requireInput: boolean;
  requireRecall: boolean;
  requirePractice: boolean;
  requireTakeaway: boolean;
};

export const DEFAULT_COMPLETION_RULE: CompletionRule = {
  requireInput: true,
  requireRecall: true,
  requirePractice: true,
  requireTakeaway: true,
};

/** フェーズの置き方。カリキュラムJSONに絶対日付を書かないための仕組み */
export type PhaseAnchor =
  /** 開始日から offsetDays 後に durationDays 日 */
  | { kind: 'start'; offsetDays: number; durationDays: number }
  /** 学科試験日の直前 durationDays 日を確保する(Phase 4) */
  | { kind: 'before-academic'; durationDays: number }
  /** 学科翌日〜技能直前の間を流す(Phase 5) */
  | { kind: 'after-academic' }
  /** 技能試験日の直前 durationDays 日 */
  | { kind: 'before-skill'; durationDays: number }
  /** 前のフェーズの後ろへ、weightWeeks の比率で流し込む(Phase 1〜3) */
  | { kind: 'flow'; weightWeeks: number };

export type CurriculumPhase = {
  id: string;
  order: number;
  title: string;
  goal: string;
  anchor: PhaseAnchor;
  /** 'academic' は学科日まで、'skill' は技能日までのセグメントに置く */
  segment: 'academic' | 'skill';
};

export type OnboardingStage =
  | 'orientation'
  | 'ungraded-five'
  | 'basics'
  | 'diagnostic'
  | 'regular';

export type CurriculumLesson = {
  id: string;
  phaseId: string;
  order: number;
  title: string;
  objective: string;
  prerequisites: string[];
  estimatedMinutes: { minimum: number; standard: number; deep: number };
  resources: string[];
  recallPrompts: RecallPrompt[];
  practice: PracticeSpec;
  completionRule?: Partial<CompletionRule>;
  officialTopicIds: TopicId[];
  /** true は再配置で絶対に削除しない(FR-005「必須範囲を黙って削除しない」) */
  required: boolean;
  /** このレッスンが属するオンボーディング段階。regular は通常カリキュラム */
  stage: OnboardingStage;
  /** 学科前の技能接触レッスン(FR-005) */
  skillTouch?: boolean;
  safetyNote?: string;
};

export type Curriculum = {
  schemaVersion: number;
  id: string;
  title: string;
  examCycleId: string;
  phases: CurriculumPhase[];
  lessons: CurriculumLesson[];
};

// ---------------------------------------------------------------------------
// ユーザーデータ(IndexedDB)
// ---------------------------------------------------------------------------

export type SkillLevel = 0 | 1 | 2 | 3;

export type UserSettings = {
  id: 'main';
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** カリキュラムの起点。初回設定を完了した日 */
  startDate: IsoDate;
  examCycleId: string;
  academicMode: 'cbt' | 'paper' | 'undecided';
  /** CBT/筆記の受験日。未定なら undefined */
  academicDate?: IsoDate;
  academicVenue?: string;
  academicReserved: boolean;
  skillDate?: IsoDate;
  weekdayMinutes: number;
  weekendMinutes: number;
  knowledgeLevel: SkillLevel;
  handworkLevel: SkillLevel;
  toolLevel: SkillLevel;
  motivation: string;
  /** 完全未経験者モード。初期 ON(FR-001) */
  beginnerMode: boolean;
  /** 「20問診断を今すぐ解禁」を本人が押したか(§6 Step 4 の手動前倒し) */
  diagnosticUnlockedManually: boolean;
  diagnosticCompletedAt?: IsoDateTime;
  ungradedFiveCompletedAt?: IsoDateTime;
  setupCompletedAt?: IsoDateTime;
  prefecture?: string;
};

export type LessonMode = 'minimum' | 'standard' | 'deep';

export type LessonProgress = {
  lessonId: string;
  mode?: LessonMode;
  inputViewedAt?: IsoDateTime;
  recallSubmittedAt?: IsoDateTime;
  recallAnswers?: string[];
  practiceSubmittedAt?: IsoDateTime;
  practiceNote?: string;
  practiceCorrect?: number;
  practiceTotal?: number;
  takeawaySavedAt?: IsoDateTime;
  takeaway?: string;
  completedAt?: IsoDateTime;
  /** 完了時にだけ付与。動画視聴のみは 0(FR-014 / AT-003) */
  xpAwarded: number;
  updatedAt: IsoDateTime;
};

export type AdminTaskState = {
  taskId: string;
  doneAt?: IsoDateTime;
  /** 本人が公式で確認して入れ直した期限。derived を上書きする */
  dueOverrideAt?: IsoDateTime;
  note?: string;
  updatedAt: IsoDateTime;
};

export type SessionKind =
  | 'theory'
  | 'questions'
  | 'wiring-diagram'
  | 'basic-skill'
  | 'candidate'
  | 'mock'
  | 'review';

export type SessionResult = {
  correct?: number;
  total?: number;
  score?: number;
  note?: string;
};

export type StudySession = {
  id: string;
  startedAt: IsoDateTime;
  /** JST の暦日。集計とカレンダー用に非正規化して持つ */
  jstDate: IsoDate;
  /**
   * 実績時間。画面の滞在時間を実測し、本人が確認・修正した値。
   * カリキュラムの見積(estimatedMinutes)を自動で入れてはいけない。
   * ここが見積のままだと、クリックだけで基礎180分ゲートが開く。
   */
  durationMinutes: number;
  /** そのレッスンの見積時間。実績との差を見るために別で持つ */
  estimatedMinutes?: number;
  /** 実測値(参考)。本人が修正した場合、durationMinutes とは一致しない */
  measuredMinutes?: number;
  kind: SessionKind;
  lessonId?: string;
  topicId?: TopicId;
  candidateNo?: number;
  result?: SessionResult;
  nextFix?: string;
  /** 基礎学習180分の集計対象か。無採点5問など体験系は false */
  countsAsBasics: boolean;
};

export type ErrorReason =
  | 'knowledge'
  | 'calculation'
  | 'reading'
  | 'symbol'
  | 'law'
  | 'time'
  | 'other';

export type QuestionAttempt = {
  id: string;
  attemptedAt: IsoDateTime;
  jstDate: IsoDate;
  source: string;
  questionRef: string;
  topicId: TopicId;
  correct: boolean;
  confidence: 1 | 2 | 3;
  seconds?: number;
  errorReason?: ErrorReason;
  /** false は準備度・正答率の集計から除外(無採点5問。AT-002) */
  scored: boolean;
};

export type UnknownTerm = {
  id: string;
  term: string;
  createdAt: IsoDateTime;
  /** どこで拾ったか。'ungraded-five' など */
  origin: string;
  resolvedAt?: IsoDateTime;
  explanation?: string;
};

export type SkillAttempt = {
  id: string;
  attemptedAt: IsoDateTime;
  candidateNo: number;
  diagramMinutes?: number;
  workMinutes: number;
  completed: boolean;
  defectFree: boolean;
  defectCodes: string[];
  photoIds: string[];
  nextFix?: string;
};

export type BudgetItem = {
  id: string;
  category: 'exam' | 'license' | 'tool' | 'material' | 'travel' | 'other';
  label: string;
  status: 'owned' | 'borrowable' | 'planned' | 'purchased' | 'unnecessary';
  expectedYen?: number;
  actualYen?: number;
  purchasedAt?: IsoDate;
  required: boolean;
};

// ---------------------------------------------------------------------------
// バックアップ
// ---------------------------------------------------------------------------

export type BackupFile = {
  kind: 'denko2-companion-backup';
  schemaVersion: number;
  exportedAt: IsoDateTime;
  appVersion: string;
  data: {
    settings: UserSettings[];
    lessonProgress: LessonProgress[];
    adminTaskStates: AdminTaskState[];
    studySessions: StudySession[];
    questionAttempts: QuestionAttempt[];
    unknownTerms: UnknownTerm[];
    skillAttempts: SkillAttempt[];
    budgetItems: BudgetItem[];
  };
};
