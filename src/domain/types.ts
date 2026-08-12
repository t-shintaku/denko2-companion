/**
 * ドメイン型。要件正本: projects/electrician-class-2-tool-requirements-final.md
 *
 * 設計の要点(要件書 §12 からの差分は README の「要件書との差分」に記載):
 * - 日付は JST の 'YYYY-MM-DD'、時刻を持つものは ISO8601+09:00 を明示的に分けた。
 *   申込は 2026-08-17 10:00 開始 / 09-03 17:00 締切なので、日付だけでは表現できない。
 * - 公式値(official)と本ツールの推定値(derived)を型で区別する(§13 信頼性)。
 * - カリキュラムは絶対日付を持たない。受験日と開始日から実行時に配置する(FR-005)。
 */

export const SCHEMA_VERSION = 3;

/**
 * 端末間同期のマージ基準。**全ユーザーデータが updatedAt を持つ**(v3)。
 *
 * 派生値(attemptedAt など)から更新時刻を推測する作りにはしない。
 * 推測式は「あとで編集できる欄が1つ増えた」瞬間に静かに壊れ、
 * 壊れたことが同期の取りこぼしとしてしか現れない。1本の明示欄で揃える。
 */
export type Synced = {
  updatedAt: IsoDateTime;
};

/**
 * カタログ由来の既定レコード(工具・材料)の updatedAt。
 * 実在の更新より必ず古い値にしておく。そうしないと、新しい端末が既定値を播いた瞬間に
 * 「購入済み」を上書きして消してしまう。
 */
export const SEED_UPDATED_AT = '1970-01-01T00:00:00+09:00';

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

/**
 * 作り手の種別。**誰の話を聞いているのかを画面に出すために持つ**。
 *
 * 'individual' は個人の解説者。試験の正解そのものではないが、素人には
 * いちばん噛み砕かれている。公式('public')・企業('company')と並べて出し、
 * 「分かりやすさは個人、最終確認は公式」という使い分けを画面で示す。
 */
export type CreatorKind = 'public' | 'company' | 'individual';

export type LearningResource = {
  id: string;
  provider: string;
  title: string;
  url: string;
  type: ResourceType;
  topicIds: TopicId[];
  role: ResourceRole;
  creatorKind?: CreatorKind;
  /** 誰が作っているか。個人の解説者を採る根拠を画面に出す(例: 元電気科講師) */
  creatorNote?: string;
  /** 動画の実尺(分)。expectedMinutes は「そのレッスンで見る分」なので別物 */
  runtimeMinutes?: number;
  expectedMinutes?: number;
  examYear?: number;
  lastVerified: IsoDate;
  /** lastVerified の意味。'requirements-doc' は「要件書に記載された日」であり到達性確認ではない */
  verification: 'requirements-doc' | 'fetched' | 'user-confirmed';
  replacementResourceId?: string;
  copyrightNote?: string;
  note?: string;
};

/**
 * 教材をどう使うか。**この順に並べて出す**。
 * 'first' 以外を先に開かせない。素人が迷子になるのは「同格の入口が3つある」ときなので、
 * 今日の1本を1つだけ決め打ちする。
 */
export type ResourceUse = 'first' | 'more' | 'stuck' | 'official';

/**
 * レッスンから教材への参照。**リンクだけを置かない**。
 *
 * 教材トップのURLだけ貼っていたとき、「飛んだ先の何を見ればいいか分からない」と
 * 差し戻された。サイトのトップは目次ですらなく、7科目・13問・一問一答が同時に並ぶ。
 * そこで参照ごとに、開く先(openUrl)・ページ内のどこ(where)・何を見る(watch)・
 * どこで止める(stop)を必須で持つ。書けない教材はレッスンに載せない。
 */
export type LessonResourceRef = {
  resourceId: string;
  /**
   * そのレッスンで実際に開くURL。resources.json の url より深い階層や
   * 動画の再生位置(?t=秒)を指すときに書く。無ければ resource.url を開く。
   */
  openUrl?: string;
  use: ResourceUse;
  /** 開いた先のどこへ行くか。「ページ左のメニューの『複線図』」など */
  where: string;
  /** そこで何を見る・読むか */
  watch: string;
  /** どこで止めるか。これが無いと延々見て一日が終わる */
  stop: string;
  /** このレッスンで使う分の目安(分)。教材全体の尺ではない */
  minutes?: number;
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
  /**
   * 候補問題のレッスンが対象にする番号(kind === 'candidate' のとき)。
   * これがあるので、レッスンを終える操作がそのまま技能の記録になる。
   * 分かれていると「カリキュラムは完了、技能は0/13」が起こる。
   * 番号が決まっていない回(2周目・ランダム)は undefined にして、記録時に選ばせる。
   */
  candidateNo?: number;
  instruction: string;
  /** 外部教材へ誘導する場合の参照先 */
  resourceIds?: string[];
  /** その教材の**どこで**解く／作るのか。リンクだけ置くと開いた先で迷う */
  where?: string;
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
  /**
   * 段階ごとの実時間(分)。**時間が動かない作業をここで固定する**。
   *
   * 120分の模試や40分の候補問題は、レッスン全体の見積を比率で割ると
   * 「18分」「12分」と表示されてしまう。作業が短くなったのではなく数字だけが縮む。
   * ここに書いた段階は比率配分を使わず、そのままの分数を出す。
   */
  stepMinutes?: { input?: number; recall?: number; practice?: number; takeaway?: number };
  /** 教材への道案内。id だけの配列ではない(LessonResourceRef のコメントを参照) */
  resources: LessonResourceRef[];
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
  /**
   * どの段階の時間か('input' | 'recall' | 'practice' | 'takeaway')。
   * **段階ごとに記録する**ので、途中でやめた日の時間も残る。
   * 完了時に1件だけ記録していたときは、「今日は見るだけでよい」と案内しながら
   * その日の時間がどこにも残らず、基礎180分が永久に進まない経路があった。
   */
  step?: 'input' | 'recall' | 'practice' | 'takeaway';
  topicId?: TopicId;
  candidateNo?: number;
  result?: SessionResult;
  nextFix?: string;
  /** 基礎学習180分の集計対象か。無採点5問など体験系は false */
  countsAsBasics: boolean;
  updatedAt: IsoDateTime;
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
  /** どの受験セッションの1問か */
  examId?: string;
  /** 最後に解き直した日時 */
  reviewedAt?: IsoDateTime;
  /**
   * 解き直した回数。**1回押しただけで永久に消さない**ための欄。
   * 忘れる前提で翌日・3日後・7日後・14日後と間隔を空けて戻す(FR-009)。
   */
  reviewCount?: number;
  /** 次に戻す日。この日を過ぎるまで復習キューに出さない */
  nextReviewOn?: IsoDate;
  /** 直近の解き直しで解けたか。false なら間隔を翌日へ戻す */
  lastReviewCorrect?: boolean;
  updatedAt: IsoDateTime;
};

export type ExamKind = 'diagnostic-20' | 'topic-quiz' | 'mock-50';

/** 小テスト・模試の1セッション(FR-010)。1問ごとの記録は QuestionAttempt 側 */
export type MockExam = {
  id: string;
  takenAt: IsoDateTime;
  jstDate: IsoDate;
  kind: ExamKind;
  /** 出典。年度・期・試験区分がわかる文字列 */
  label: string;
  totalQuestions: number;
  correctCount: number;
  /** かかった時間 */
  minutes?: number;
  /** 本番同様(50問120分)として実施したか。学科ゲートの「120分模試2回以上」に効く */
  timed: boolean;
  note?: string;
  updatedAt: IsoDateTime;
};

export type UnknownTerm = {
  id: string;
  term: string;
  createdAt: IsoDateTime;
  /** どこで拾ったか。'ungraded-five' など */
  origin: string;
  resolvedAt?: IsoDateTime;
  explanation?: string;
  updatedAt: IsoDateTime;
};

/**
 * 技能の記録。1題まるごと作った記録('candidate')と、
 * 反復欠陥の工程だけを繰り返した部分練習('drill')を型で分ける。
 *
 * 分けないと困ること: 部分練習を候補問題の1回として数えると、
 * 「13問すべて施工」「直近3作品が35分以内」が部分練習で通ってしまう。
 * 逆に部分練習を記録できないと、反復欠陥に対策した事実がどこにも残らない。
 */
export type SkillAttemptKind = 'candidate' | 'drill';

export type SkillAttempt = {
  id: string;
  attemptedAt: IsoDateTime;
  /** 既定は 'candidate'(旧データは全部これ) */
  kind?: SkillAttemptKind;
  /** drill のときは対象外なので 0 を入れる */
  candidateNo: number;
  /** どのレッスンの記録か。カリキュラムの候補問題タスクから作られたときに入る */
  lessonId?: string;
  diagramMinutes?: number;
  workMinutes: number;
  completed: boolean;
  defectFree: boolean;
  defectCodes: string[];
  /**
   * この練習で対策した欠陥コード(drill 用)。
   * ここに入れた欠陥は「対策済み」として反復欠陥から降りる。再発したらまた上がる。
   */
  clearedDefectCodes?: string[];
  photoIds: string[];
  nextFix?: string;
  updatedAt: IsoDateTime;
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
  updatedAt: IsoDateTime;
};

// ---------------------------------------------------------------------------
// バックアップ
// ---------------------------------------------------------------------------

/**
 * 端末間同期の設定(FR-019拡張)。**バックアップJSONには含めない**。
 * トークンが書き出しファイルに混ざると、Driveへ置いた瞬間に事故になる。
 */
export type SyncConfig = {
  id: 'main';
  provider: 'github';
  owner: string;
  repo: string;
  branch: string;
  path: string;
  /** GitHub のトークン。この端末のブラウザから出さない */
  token: string;
  /** どの端末が最後に書いたかを画面に出すための名前 */
  deviceName: string;
  lastSyncedAt?: IsoDateTime;
  /** 直前に読んだリモートの sha。これが合わなければ他端末が先に書いている */
  remoteSha?: string;
  /** 最後に送った内容の指紋。同じなら送らない(空コミットを積まない) */
  lastPushedDigest?: string;
};

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

export type SyncStatus = {
  phase: SyncPhase;
  lastSyncedAt?: IsoDateTime;
  /** 画面に出す人間向けの一行 */
  message?: string;
  /** 直近の同期で取り込んだ件数 */
  pulled?: number;
  /** 直近の同期で送った件数 */
  pushed?: number;
};

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
    mockExams: MockExam[];
    unknownTerms: UnknownTerm[];
    skillAttempts: SkillAttempt[];
    budgetItems: BudgetItem[];
  };
};
