import type { FrameMeta } from './types';

const FULL_FRAME_DIAGONAL_MM = 43.2666;

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** 画角の仮定（35mm判換算の焦点距離）から、ピクセル単位の焦点距離を求める。 */
export function focalPx(frame: FrameMeta, focalEq: number): number {
  return (focalEq / FULL_FRAME_DIAGONAL_MM) * Math.hypot(frame.width, frame.height);
}

/** 写真の横位置（0〜1）を、写真中心を0とした左右の角度（度、右が正）に変換する。 */
export function xToDeg(xNorm: number, frame: FrameMeta, focalEq: number): number {
  return toDeg(Math.atan(((xNorm - 0.5) * frame.width) / focalPx(frame, focalEq)));
}

/** 左右の角度（度）を写真の横位置（0〜1）に戻す。 */
export function degToX(deg: number, frame: FrameMeta, focalEq: number): number {
  return 0.5 + (focalPx(frame, focalEq) * Math.tan(toRad(deg))) / frame.width;
}

/** 写真の横方向の画角（度）。 */
export function hfovDeg(frame: FrameMeta, focalEq: number): number {
  return 2 * toDeg(Math.atan(frame.width / 2 / focalPx(frame, focalEq)));
}

/** 標準正規分布の累積分布関数。誤差は 1.5e-7 以下（Abramowitz & Stegun 7.1.26）。 */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
