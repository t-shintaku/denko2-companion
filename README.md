# 電工二種 合格伴走盤 (denko2-companion)

第二種電気工事士 **2026年度下期** に、電気知識ゼロから独学で合格し、**免状を受領する**までを伴走する
ローカルファーストPWA。

- 要件の正本: `G:\マイドライブ\AI Context Hub\projects\electrician-class-2-tool-requirements-final.md`
- 実装状況の正本: `G:\マイドライブ\AI Context Hub\projects\electrician-class-2-tool-implementation.md`
- 旧要件定義・修正書・追加要件は検討履歴。実装要件には使わない。

## 動かす

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev:lan      # スマホから同一LANで見るとき
npm test             # Vitest(78件)
npm run build        # dist/ を生成(PWA の sw.js 込み)
npm run preview
```

Node 24 / npm 11 で確認。

## なぜ Google Drive の外にあるのか

保管庫(`G:\マイドライブ\AI Context Hub`)の中に置くと **`npm install` が完走しない**。
実際に `EPERM: operation not permitted, rmdir` → `EBADF: bad file descriptor` で失敗した。
`node_modules` だけをジャンクションで逃がす手も試したが、
Google Drive のボリュームは NTFS ジャンクションを作れない(`Local NTFS volumes are required`)。

よって要件書 §14 の逃げ道どおり **別リポジトリ・Drive外** に置いている。
保管庫には要件書と実装メモ(と将来の週次Markdown)だけを残す。

**バックアップは Drive 任せにできない。** GitHub へ push するか、
`dist/` とソースを定期的にコピーすること。学習データ自体は端末の IndexedDB にあり、
アプリの「設定 → JSONへ書き出す」で Drive へ保存できる(こちらが本命)。

## スマホで使うには配信先が要る(未決)

主端末はスマートフォンで、オフライン動作とホーム画面追加が要件にある。
PWA のインストールには **HTTPS 配信** が必要で、PC の dev サーバー(`http://192.168.x.x:5173`)では
Service Worker が登録されない。Sprint 1 の成果物は「ビルドすれば動く」ところまでで、
**配信先の決定は残タスク**。

- 候補: GitHub Pages(`BASE_PATH=/denko2-companion/ npm run build`)/ Cloudflare Pages / Netlify
- 学習データは端末内のみ。配信はアプリシェルの静的配信だけで、記録は外へ出ない。

## 構成

```
src/
  domain/     純関数。副作用なし。テストはここへ厚くかける
    types.ts        ドメイン型と schemaVersion
    jst.ts          Asia/Tokyo 固定の日付処理(端末TZに依存しない)
    schedule.ts     カリキュラム配置エンジン(FR-005)
    adminTasks.ts   事務期限の解決と緊急度(FR-002)
    lessons.ts      4段階の完了判定(FR-007)
    onboarding.ts   完全未経験者のゲート(FR-003)
    quests.ts       今日のクエスト / 次の10分(FR-004・§10)
    backup.ts       JSONバックアップの検証と移行(FR-019)
  db/         Dexie(IndexedDB)。副作用はここだけ
  data/       バンドルするマスタJSON(試験日程・事務・教材・カリキュラム・7科目)
  features/   画面
  state/      VaultContext(DB → 派生状態)
tests/        Vitest + React Testing Library
```

## 要件書との差分(意図的に変えたところ)

| 箇所 | 要件書 | 実装 | 理由 |
|---|---|---|---|
| 事務期限 | §10 は「7日以内の未完了事務期限」だけを見る | `opensAt`(受付開始)と期限超過を追加 | 申込開始 08-17 10:00 は締切(09-03)まで17日あり「7日以内」で拾えない。Sprint 1 の最優先目的が拾えなくなる |
| 日付型 | `applicationStart: string`(日付) | ISO8601+09:00(時刻つき) | 申込は 10:00 開始 / 17:00 締切。日付だけだと丸1日ずれる |
| カリキュラム | §7 に絶対日付 | JSONに日付を持たず、開始日と受験日から実行時に配置 | CBT日が実際の予約枠で動く。テストで日付の非混入を検証している |
| 20問診断 | §6 は「20問診断」をアプリ機能として書く | 外部(公式過去問)で解いて結果を登録する形 | 過去問の本文・図を収録しない(§4.3)。アプリ内出題は FR-010 の P1 |
| 日付ライブラリ | date-fns 等 | 依存を足さず `domain/jst.ts` に自作 | Drive外へ移す前提でも依存は少ないほうがよい。Intl だけで JST 固定は書ける |
| CSS | Tailwind または CSS Modules | 素の CSS + カスタムプロパティ | 依存とビルド設定を減らす。ダークモードは `prefers-color-scheme` |
| 技能ゲートの時間 | FR-011「直近3回中央値」/ FR-013「直近3回35分以内」 | 表示は中央値、ゲート判定は最大値(Sprint 3で実装) | 34/35/36分は中央値35で通ってしまうが、AT-006 は不通過を要求する。指標と判定条件を分ける |

## Sprint 1 でやっていないこと

Sprint 2 以降。画面には「Sprint 2で実装」と明示していて、空欄を成果に見せていない。

- 7科目の正答率・復習キュー・小テスト・模試・CBT風UI(Sprint 2)
- 候補13問の状態管理・欠陥記録・写真・工具予算(Sprint 3)
- XPレベル8段階・週次レビュー・Hub Markdown出力・試験当日・免状(Sprint 4)
- Playwright による E2E とオフライン実機確認(Sprint 4)

## 安全について

- 練習は試験用の非通電材料のみ。通電した自宅設備を練習対象にしない。
- 免状を受け取るまで直結式工事はできない。**免状前に照明が切れたら、待たずに電気工事店へ依頼する。**
- 合格 ≠ 完了。免状受領で最終到達。
