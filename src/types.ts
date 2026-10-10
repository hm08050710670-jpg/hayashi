import type { FrameMeta } from './model/types';

/** 解析に使う静止画。画像は端末内だけで扱い、外部には送信しない。 */
export interface Photo extends FrameMeta {
  /** 表示用のURL（端末内の一時URL） */
  url: string;
  source: 'camera' | 'file';
  /** 平均の明るさ（0〜255） */
  brightness: number;
  /** 輪郭の強さの指標。小さいほどブレ・ピンぼけの可能性が高い */
  sharpness: number;
}

export type Safety = 'clear' | 'blocked';
