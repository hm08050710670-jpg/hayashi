/**
 * esbuild だけで本番用のファイルを dist/ に出力する補助スクリプト。
 * 通常は `npm run build`（Vite）を使う。Vite を使えない環境向けに、同じソースから同じ構成の dist を作る。
 *   node scripts/build.mjs            → dist/（PWA として配信する一式）
 *   node scripts/build.mjs --pages    → docs/（GitHub Pages で公開する一式。内容は dist/ と同じ）
 *   node scripts/build.mjs --single   → dist-single/page.html（1ファイルにまとめた試用ページ）
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const single = process.argv.includes('--single');
const pages = process.argv.includes('--pages');
const outDir = path.join(root, single ? 'dist-single' : pages ? 'docs' : 'dist');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { app: 'src/main.tsx' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  outdir: path.join(outDir, 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
  write: !single,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.PROD': single ? 'false' : 'true',
    'import.meta.env.DEV': 'false',
    'import.meta.env.VITE_TRIAL': single ? '"1"' : 'undefined',
  },
});

const template = await readFile(path.join(root, 'index.html'), 'utf8');

if (single) {
  // 1ファイル版：ページの中身（タイトル・スタイル・スクリプト）だけを出力する。
  const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
  const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;
  const page = [
    '<title>GOLF ESCAPE AI</title>',
    `<style>${css}</style>`,
    '<div id="root"></div>',
    `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`,
    '',
  ].join('\n');
  await writeFile(path.join(outDir, 'page.html'), page);
  console.log(`dist-single/page.html ${(page.length / 1024).toFixed(1)} kB`);
} else {
  const outputs = Object.keys(result.metafile.outputs).map((p) => path.basename(p));
  const js = outputs.find((p) => p.endsWith('.js'));
  const css = outputs.find((p) => p.endsWith('.css'));
  const html = template
    .replace(/(href|src)="\/(?!\/)/g, '$1="./')
    .replace(
      /\s*<script type="module" src="\.\/src\/main\.tsx"><\/script>/,
      `\n    <script type="module" src="./assets/${js}"></script>`,
    )
    .replace('</title>', `</title>\n    <link rel="stylesheet" href="./assets/${css}" />`);
  if (!html.includes(js) || !html.includes(css)) throw new Error('index.html の書き換えに失敗しました');
  await writeFile(path.join(outDir, 'index.html'), html);
  await cp(path.join(root, 'public'), outDir, { recursive: true });
  // GitHub Pages が Jekyll の変換をかけず、ファイルをそのまま配信するようにする。
  if (pages) await writeFile(path.join(outDir, '.nojekyll'), '');
  for (const [file, info] of Object.entries(result.metafile.outputs)) {
    console.log(`${file} ${(info.bytes / 1024).toFixed(1)} kB`);
  }
}
