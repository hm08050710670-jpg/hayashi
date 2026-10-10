// ビルド時に置き換えられる値の型（Vite と scripts/build.mjs の両方で定義される）。
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  /** 1ファイルの試用ページとしてビルドしたときだけ設定される */
  readonly VITE_TRIAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.css';
