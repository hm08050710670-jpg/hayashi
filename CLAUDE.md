# CLAUDE.md — GOLF ESCAPE AI（林脱出ルート推定アプリ）

このファイルは、このリポジトリで作業する Claude（および人）向けの指針です。
依頼者はエンジニアではありません。説明は日本語で、専門用語は噛み砕いて書くこと。

## これは何か

- 林の中からスマホのカメラで前方を映すと、木の隙間（ルート、最大3本）と
  「スコア帯ごとの推定成功率（%）」を表示する PWA。
- 公開先: https://hm08050710670-jpg.github.io/hayashi/docs/
  （GitHub Pages の公開元はリポジトリのルート。ルートの `index.html` が `./docs/` へ転送する）
- 対象端末: iPhone Safari / Android Chrome を最優先。PC は動作確認用。
- 開発段階（指示書どおり）
  1. 静止画＋手動マーキング … 実装済み
  2. 静止画の自動検出 … 試験版を実装済み（AIではなく「見通せる方向」の検出）
  3. リアルタイム解析 … 試験版を実装済み（撮影画面を開くと自動で開始）
  4. 精度向上 … 未着手。実際の林での精度は **未検証**

## 技術構成

- React 19 + TypeScript + Vite の構成。ただし **このクラウド環境では npm registry に届かないため Vite は使えない**。
  ビルドは `scripts/build.mjs`（esbuild）で行う。`npm run build`（Vite）は未検証のまま。
- `node_modules` は `/opt/npm-tools/node_modules` へのシンボリックリンク（react / esbuild / tsx / typescript 入り）。
- 依存は react / react-dom のみ。新しいライブラリは原則追加しない（追加できない環境でもある）。

```
src/model/      確率モデル（params.ts の仮パラメータ、routes.ts の computeRoutes、describe.ts の文言）
src/analysis/   自動検出（openingDetector.ts）と、手ぶれ対策・結果の安定化（live.ts）
src/camera/     カメラ取得（useCamera.ts）とリアルタイム解析ループ（useLiveAnalysis.ts）
src/image/      画質判定・画像変換
src/screens/    画面（Notice → ScoreSelect → Capture(ライブ) → Mark → Confirm → Result、Settings）
src/components/ 重ね描き（FanLayer＝ばらつきの扇、RouteLayer、ObstacleLayer）、Chips など
src/styles.css  全スタイル（ダーク単一テーマ。--brand #eaff00 / --ok / --warn / --bad）
public/         manifest.webmanifest, sw.js, icons
scripts/        build.mjs（esbuild ビルド）, serve.mjs（ローカル配信）
docs/           Pages 用のビルド成果物（コミット対象。手で編集しない）
```

## よく使うコマンド

```bash
npm test                 # 単体テスト（tsx, node:test）model 18 + analysis 26
node scripts/build.mjs           # dist/ にビルド
node scripts/build.mjs --pages   # docs/ にビルド（公開用。.nojekyll も生成）
node scripts/build.mjs --single  # dist-single/page.html（お試し用アーティファクト）
node scripts/serve.mjs           # dist/ をローカル配信
```

型チェックは `tsconfig.json` で `tsc --noEmit`（テストファイルは除外）。

## 絶対に守ること（指示書の要件）

- 推定値には必ず「仮モデルによる推定・未検証」（`MODEL_LABEL`）を表示する。
- データ不足のときは「判定不能」を出す。ダミーの数値を本物のように見せない。
- 前方に人がいる状況では推奨を出さない。安全確認（起動ごとに1回）とゴルフ規則の注意は残す。
- 「画面に映っていない範囲の障害物は判定できません」の趣旨を消さない。
- 色だけで情報を伝えない（緑/黄/赤には必ず文字ラベル：比較的通しやすい／注意が必要／難しい）。
- 画面端にかかる隙間は、先を確認できていないので「◎」にしない。
- スマホのセーフエリア、画面高さ 700px 以下の端末を考慮する（`index.html` と `styles.css` の media query）。
- 未検証のものを「確認済み」「動作確認済み」と書かない。

## 確定している設計（変更指示がない限り維持）

- 撮影画面を開いたら安全確認のあと **自動でリアルタイム解析を開始**。
- 解析する帯は画像の縦 0.34〜0.62。帯の上下は破線で表示。
- 結果表示は「大きな %」＋「10球打って 約N球」のボール表示＋難易度／おすすめ度＋ばらつきの扇（FanLayer）。
- 手持ちの揺れ対策（live.ts）：フレーム位置合わせ → 5フレーム中4の多数決 → RouteTracker の指数平滑（τ=1200ms）、
  表示の不感帯 0.03、先頭入れ替えのヒステリシス +0.08、ルートIDは `track-<key>` で固定、文字は左から A/B/C。
  **数値が一瞬で変わる問題を直した結果なので、感度を上げる変更は慎重に。**
- 自動検出は保守的（通せない方向を「通せる」と出すほうが危険）。
  上側ゾーンとの色差で幹を除外し、帯の下側は使わない（地面・幹元の誤検出を防ぐため）。
- 設定: スコア帯、35mm換算の焦点距離（24/26/30/35、既定 26）、リアルタイム更新頻度（2/4/8）。保存キーは `storage.ts`。

## 作業の進め方

1. 修正は指定された箇所だけ。承認済みの見た目・文言・操作感は勝手に変えない。
   過去の決定と矛盾する依頼は、変更前に矛盾点を伝える。
2. パラメータ変更は `src/model/params.ts` / `OPENING_PARAMS` / `LIVE_PARAMS` にまとめ、散らさない。
3. 変更後は必ず：
   - `npm test`
   - `node scripts/build.mjs --pages` で `docs/` を更新
   - 可能なら Playwright（偽カメラ y4m 動画）でライブ解析・画面遷移の自動確認
     （スクリプトはリポジトリ外のスクラッチ領域にある。必要なら作り直す）
4. コミットは日本語の要約一行＋必要なら本文。`docs/` の更新も同じコミットに含める。
   push 先は `origin main`（https://github.com/hm08050710670-jpg/hayashi）。
5. 納品時の報告は「変更点」「確認したこと」「確認できていないこと」を分けて簡潔に。
   実機（iPhone/Android、実際の林）での確認はこの環境ではできないので、必ず未確認と明記する。

## 文章・UI の決まり

- UI 文言は自然な日本語。専門用語（アジマス、σ など）は画面に出さない。
- 「推定成功率」「10球打って 約N球」「斜線の範囲は『障害物または未確認』です」などの既存表現を踏襲する。
- 数字は大きく、補足は小さく。片手で操作できるよう主要ボタンは画面下寄せ、44px 以上。

## 既知の限界（ユーザーへの説明に使う）

- 自動検出は「明るく抜けている方向」を見ているだけで、木の種類や距離は分からない。屋内の結果に意味はない。
- 確率は仮の正規分布モデルで、実打データによる検証はしていない。
- 枝（高さのある障害）は距離とクラブの指定がないと「判定不能」。
