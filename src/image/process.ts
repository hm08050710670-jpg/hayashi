import type { Photo } from '../types';

const MAX_SIDE = 1600;

/** 暗さ・ブレの警告のしきい値。実際の林の写真では未検証の仮の値。 */
export const QUALITY_THRESHOLDS = {
  darkBelow: 55,
  blurBelow: 40,
};

/** 明るさと輪郭の強さを、縮小した画像から求める。 */
export function measureQuality(source: HTMLCanvasElement): { brightness: number; sharpness: number } {
  const w = 160;
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { brightness: 128, sharpness: 999 };
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = v;
    sum += v;
  }
  // ラプラシアンの分散。輪郭がはっきりしているほど大きくなる。
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n += 1;
    }
  }
  const mean = n ? lapSum / n : 0;
  return { brightness: sum / (w * h), sharpness: n ? lapSq / n - mean * mean : 999 };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.9);
  });
}

export async function canvasToPhoto(canvas: HTMLCanvasElement, source: Photo['source']): Promise<Photo> {
  if (canvas.width === 0 || canvas.height === 0) throw new Error('empty canvas');
  const blob = await canvasToBlob(canvas);
  return {
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
    source,
    ...measureQuality(canvas),
  };
}

/** 端末内の画像ファイルを読み込み、向きを正しくしたうえで縮小する。 */
export async function fileToPhoto(file: File): Promise<Photo> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
      img.src = srcUrl;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('image has no size');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // 現在の主要ブラウザーは、撮影時の向き（EXIF）を反映して描画する。
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToPhoto(canvas, 'file');
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}
