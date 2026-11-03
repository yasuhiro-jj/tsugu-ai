# 設定ダッシュボード 実装メモ（2026-11-03 オーナー決定・architect 設計）

利用者が業種・会社の概要・面談する人・面談テーマの補足・決算の数字を記入すると、その会社に合わせて面談・診断・学習・90日計画・資料・AI参謀が動く。初期値は架空の「食事処 つぐみ」で、何も変えなければ今のデモと同じ文字列・同じ動きになること（一致テストで守る）。

## データ
- 表 `company_settings`：demo_id（主キー）, settings（JSON 文字列）, version, rev, updated_at, updated_by_role。行が無い・JSON が壊れているときはつぐみの初期値。
- 業種の型はコード（`lib/industry-presets.ts`、画面からも読める）：`{ label, themeHints, defaultWants, upsideEnabled }`。飲食店＝今の THEMES の hint と DEFAULT_WANTS。製造業・小売・その他は下書き（オーナー確認待ち）。
- 初期値 `TSUGUMI_SETTINGS` は今の DEMO_PROFILES・COMPANY_CONTEXT・THEMES・PREVIOUS_PERIOD/CURRENT_PERIOD から組み立てる（元の定数は残す）。companyName「食事処 つぐみ（架空）」、industryNote「和食の食事処」。

## 型（`lib/settings-types.ts`、server-only を付けない）
- `Industry` = "restaurant" | "manufacturing" | "retail" | "other"
- `Relation` = "身内" | "従業員" | "第三者"、`Level` = "Lv1" | "Lv2" | "Lv3" | "Lv4"
- `PeriodInput` = 今の PeriodData から label を除いたもの（万円の整数）
- `CompanySettings` = { industry, company: { name, industryNote, overview }, people: { predecessorName, successorName, relation, predecessorLevel, successorLevel }, themeHints: Record<ThemeKey, string>, financials: { previous: PeriodInput, current: PeriodInput } }
- `SettingsView` = { settings, isDefault, rev, updatedAt: string | null, willInvalidate: { diagnosis, actionPlan, report, myAdvisorChat } }（相手の AI参謀の会話の有無は返さない）

## 検証（サーバー。画面も同じ上限を表示）
- 会社名 1〜40字、業種の補足 60字、概要 300字、名前 1〜20字、テーマの補足 各80字。
- 1行の項目は改行・制御文字・`{{`・`<`・`>`・バッククォート3つを拒否。概要は改行可。
- 数字は万円の整数。売上 1〜1,000,000、当期純利益 −1,000,000〜1,000,000、それ以外 0〜1,000,000。
- 業種・関係・Lv は選択肢のみ。

## API（handleJsonApi、セッション必須、先代・後継者どちらでも可）
- GET `/api/settings` → `{ ok, ...SettingsView }`
- PUT `/api/settings` 本文 `{ settings, rev }` → `{ ok, ...SettingsView, invalidated }`。中身が同じなら何もしない。入力誤りは 400 `{ ok:false, error, fieldErrors: Record<"financials.current.sales" など, string> }`、rev が古ければ 409。
- POST `/api/settings/reset` 本文 `{ rev }` → つぐみの初期値を書き、PUT と同じ形。
- 書き換え回数は plan_edit_usage と同じ1日の上限で数える。

## 設定を変えたとき（SEC-101・102 と同じ考え方）
- 正規化した JSON が前と同じなら何もしない。
- 変わったら1つの batch で：設定の UPSERT（rev 条件つき）＋ invalidateDiagnosisStatements（診断・90日計画・資料・診断を使った学習プラン）＋ advisor_chats を両役割とも削除＋（後継者の Lv が変わったら）learning.level を更新。
- 面談の記録（theme_records）は残す（オーナー判断で変更可）。
- 診断・計画・資料・AI参謀を作る前に設定の rev を読み、保存時に同じ rev か照合。違えば 409「設定が変わったため作り直してください」。
- DELETE /api/demo と保存期間の削除に company_settings を足す。

## 業種による出し分け
- 伸びる余地：飲食店以外は `getUpsideSummary(settings)` が null → 比較画面・AI参謀・資料に出さない（資料は現状維持案だけ）。飲食店で数字を変えたときは「ランチ・宴会の前提はつぐみの例です」と添える。
- 講座：隠さない。飲食店以外は「飲食店向けの例です」、設定が初期値でないときは「講座の数字は架空の『つぐみ』の例です」と表示。講座の質問は記事どおりつぐみの概要を渡し、知識レベルだけ設定から取る。

## 呼び出し側
- 面談（interview/service.ts）：プロフィール・概要・テーマ一覧（`{{theme_list}}`）を設定から。初期値でない利用者の文は「」で囲む。
- 診断・資料・AI参謀・比較画面：決算は設定から。数字の注記と資料名も数字から作り、利用者入力のときは資料名「設定に入力した決算の数字（利用者入力）」、期の名前は「前期」「当期」。
- 学習プラン：後継者の名前・初回の wants・level を設定から。
- `components/server-data.ts` に `getFinancialSummary(demoId)`・`getUpsideSummary(demoId)`。

## 画面（/settings、上部メニューに「設定」、トップに「会社の設定を変える（任意）」）
- 上から：業種 → 会社の概要 → 面談する人 → テーマの補足 → 決算（前期・当期の2列）→ 保存。
- 業種を変えたとき、テーマの補足が型のままなら入れ替え、手を入れていれば確認。
- 保存の前に消えるものがあれば「診断・90日計画・資料・AI参謀の会話が消えます。面談の記録は残ります」と確認。
- 「つぐみの例に戻す」（同じ確認のあと reset）。
- 注記：「ここに書いた内容は二人の両方に見え、AI にも渡ります。非公開にしたいことや、実在の会社・個人・実際の決算は書かないでください（公開デモ）」。

## 今回作らないもの
業種ごとの講座・試算・行動例、年度の入力、決算書の取り込み、複数会社、設定の履歴、管理者権限、指示文の「お店」という言い方の全面修正。
