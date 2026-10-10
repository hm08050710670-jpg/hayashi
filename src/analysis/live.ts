/**
 * リアルタイム解析の安定化。画面に依存しない純粋な処理にしてあり、単体テストできる。
 *
 * 1フレームごとの判定はノイズで揺れるので、そのまま表示すると数値がちらつく。そこで、
 *  - 直近の数フレームすべてで「見通せる」と判定された列だけを、見通せるとみなす
 *    （1回でも障害物と判定された列は、すぐ障害物に戻す。揺れは「通れない」側に倒す）
 *  - カメラが動いている間は判定をやり直し、数値を出さない
 *  - 推定確率は、前回の値とならして表示する
 */
import { levelOf } from '../model/routes';
import type { Route } from '../model/types';
import {
  OPENING_PARAMS,
  blockedSpans,
  type BlockedSpan,
  type OpeningDetection,
  type OpeningParams,
} from './openingDetector';

export const LIVE_PARAMS = {
  /** 結果を表示するまでに、続けて同じ向きを解析する回数 */
  confirmFrames: 3,
  /** カメラが動いたとみなす、帯の明るさの変化の大きさ（0〜255） */
  motionLimit: 10,
  /** この時間（ms）を超えて更新がない結果は、最新として表示しない */
  staleMs: 1500,
  /** 推定確率の更新の速さ（1 に近いほど最新の値にすぐ追従する） */
  probabilitySmoothing: 0.5,
  /** 前回と同じルートとみなす、狙う方向の差の上限（度） */
  matchDeg: 2.5,
};

export type LiveParams = typeof LIVE_PARAMS;

export type LiveStatus =
  | 'confirming' // 障害物を確認中（まだ回数が足りない）
  | 'moving' // カメラが動いている
  | 'too_dark'
  | 'no_backdrop' // 奥の明るい背景が見えていない
  | 'low_contrast' // 明暗の差が小さい
  | 'bad_frame'
  | 'ok';

export interface LiveStep {
  status: LiveStatus;
  /** 障害物または未確認の範囲。status が ok のときだけ意味を持つ */
  spans: BlockedSpan[];
  /** 前のフレームからの変化の大きさ（0〜255） */
  motion: number;
}

export class LiveAnalyzer {
  private history: Uint8Array[] = [];
  private lastProfile: Float32Array | null = null;

  constructor(
    private readonly params: LiveParams = LIVE_PARAMS,
    private readonly opening: OpeningParams = OPENING_PARAMS,
  ) {}

  /** 「再解析」用：これまでの判定を捨てて最初からやり直す。 */
  reset(): void {
    this.history = [];
    this.lastProfile = null;
  }

  push(detection: OpeningDetection): LiveStep {
    const prev = this.lastProfile;
    const profile = detection.profile;
    let motion = 0;
    if (prev && prev.length === profile.length && profile.length > 0) {
      for (let x = 0; x < profile.length; x++) motion += Math.abs(profile[x] - prev[x]);
      motion /= profile.length;
    }
    this.lastProfile = profile;

    if (detection.reason !== 'ok') {
      this.history = [];
      return { status: detection.reason, spans: [], motion };
    }
    if (motion > this.params.motionLimit) {
      // 動いた直後のフレームを新しい向きの1回目として数え直す。
      this.history = [detection.open];
      return { status: 'moving', spans: [], motion };
    }

    this.history.push(detection.open);
    if (this.history.length > this.params.confirmFrames) this.history.shift();
    if (this.history.length < this.params.confirmFrames) return { status: 'confirming', spans: [], motion };

    const width = detection.open.length;
    const stable = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let open = 1;
      for (const frame of this.history) {
        if (frame.length !== width || frame[x] === 0) {
          open = 0;
          break;
        }
      }
      stable[x] = open;
    }
    return { status: 'ok', spans: blockedSpans(stable, this.opening.minOpenRunPx), motion };
  }
}

/**
 * 推定確率を前回の値とならす。狙う方向が近いルートを同じルートとみなす。
 * ならしたあとの確率で、難易度と「最有力」を付け直す。
 */
export function smoothRoutes(previous: Route[], current: Route[], params: LiveParams = LIVE_PARAMS): Route[] {
  const smoothed = current.map((route) => {
    if (route.status !== 'ok' || route.probability === null) return { ...route };
    let match: Route | null = null;
    let bestDiff = params.matchDeg;
    for (const old of previous) {
      if (old.status !== 'ok' || old.probability === null) continue;
      const diff = Math.abs(old.aimDeg - route.aimDeg);
      if (diff <= bestDiff) {
        match = old;
        bestDiff = diff;
      }
    }
    if (!match || match.probability === null) return { ...route };
    const a = params.probabilitySmoothing;
    const probability = a * route.probability + (1 - a) * match.probability;
    return { ...route, probability, level: levelOf(probability) };
  });

  let best: Route | null = null;
  for (const route of smoothed) {
    route.isBest = false;
    if (route.status === 'ok' && route.probability !== null) {
      if (!best || route.probability > (best.probability as number)) best = route;
    }
  }
  if (best) best.isBest = true;
  return smoothed;
}
