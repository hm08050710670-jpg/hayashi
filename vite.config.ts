import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base を相対パスにして、サブディレクトリ配下でもそのまま配信できるようにする。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
});
