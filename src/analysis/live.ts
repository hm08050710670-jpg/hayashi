/**
 * リアルタイム解析の安定化。画面に依存しない純粋な処理にしてあり、単体テストできる。
 *
 * 手で持ったスマートフォンは常に少し揺れるので、1フレームごとの判定をそのまま表示すると、
 * 数値が出たり消えたり、ルートが入れ替わったりして読めない。そこで次の4つを行う。
 *
 *  1. 揺れの打ち消し：前のフレームから映像が横に何列ずれたかを求め、過去の判定を今の位置に合わせ直す。
 *     ゆっくり向きを変えたときも、同じ仕組みで表示が映像に追従する。
 *  2. 多数決：直近の数フレームのうち、ほぼすべてで「見通せる」と判定された列だけを見通せるとみなす
 *     （1フレームだけの誤判定では変わらない。障害物が続けて写れば、すぐ障害物に戻る）。
 *  3. ルートの追跡：同じ隙間は同じルートとして追い続け、確率・位置をなめらかに更新する。
 *     表示する数値は、一定以上変わったときだけ書き換える。
 *  4. 主役の固定：いちばん良いルートは、ほかのルートがはっきり上回ったときだけ入れ替える。
 *
 * 速く動かしたときや、映像が大きく変わったときは、これまでどおり判定をやり直して数値を出さない。
 */
import { degToX, xToDeg } from '../model/geometry';
import { levelOf } from '../model/routes';
import type { FrameMeta, Route } from '../model/types';
import {
  OPENING_PARAMS,
  blockedSpans,
  type BlockedSpan,
  type OpeningDetection,
  type OpeningParams,
} from './openingDetector';

export const LIVE_PARAMS = {
  /** 多数決に使うフレーム数 */
  windowFrames: 5,
  /** 結果を出し始めるのに必要なフレーム数 */
  minFrames: 3,
  /** 多数決で許す「見通せない」判定の数（フレームが windowFrames 分そろっているとき） */
  allowedMisses: 1,
  /** 揺れとして打ち消す横ずれの上限（映像の横幅に対する割合、1フレームあたり） */
  maxShiftRatio: 0.1,
  /** 横ずれを合わせても残る変化がこれを超えたら、カメラが大きく動いたとみなす（0〜255） */
  motionLimit: 12,
  /** この時間（ms）を超えて更新がない結果は、最新として表示しない */
  staleMs: 1500,
  /** 推定確率と位置をなめらかにする時間の目安（ms）。大きいほど落ち着くが、反応は遅くなる */
  smoothingMs: 1200,
  /** 表示中の数値を書き換える最小の差（確率）。これ未満の変化では数字を変えない */
  displayDeadband: 0.03,
  /** 同じルートとみなす、狙う方向の差の下限（度）。隙間が広いときは幅に応じて広げる */
  matchDeg: 2.5,
  /** 見失ったルートを表示し続けるフレーム数 */
  holdFrames: 3,
  /** 新しく見つかったルートを表示し始めるまでのフレーム数 */
  minAgeFrames: 2,
  /** これ未満の確率のルートは、ノイズが多いので表示しない */
  minProbability: 0.05,
  /** 主役のルートを入れ替えるのに必要な、確率の差 */
  leaderMargin: 0.08,
};

export type LiveParams = typeof LIVE_PARAMS;

export type LiveStatus =
  | 'confirming' // 障害物を確認中（まだ回数が足りない）
  | 'moving' // カメラが大きく動いている
  | 'too_dark'
  | 'no_backdrop' // 奥の明るい背景が見えていない
  | 'low_contrast' // 明暗の差が小さい
  | 'bad_frame'
  | 'ok';

export interface LiveStep {
  status: LiveStatus;
  /** 障害物または未確認の範囲。status が ok のときだけ意味を持つ */
  spans: BlockedSpan[];
  /** 横ずれを合わせたあとに残った変化の大きさ（0〜255） */
  motion: number;
  /** 前のフレームからの横ずれ（映像の横幅に対する割合。右へずれたら正） */
  shift: number;
}

/**
 * 前のフレームから、映像が横に何列ずれたかを求める。
 * 帯の明るさの並びをずらしながら重ね、最もよく一致するずれを選ぶ。
 */
export function estimateShift(
  previous: Float32Array,
  current: Float32Array,
  maxShift: number,
): { shift: number; residual: number } {
  const n = current.length;
  let best = 0;
  let bestCost = Infinity;
  let bestResidual = Infinity;
  for (let s = -maxShift; s <= maxShift; s++) {
    let sum = 0;
    let count = 0;
    for (let x = Math.max(0, s); x < Math.min(n, n + s); x++) {
      sum += Math.abs(current[x] - previous[x - s]);
      count += 1;
    }
    if (count === 0) continue;
    const residual = sum / count;
    // 模様の少ない映像ではどのずれでも同じように一致するので、ずれが小さいほうをわずかに優先する。
    const cost = residual + 0.03 * Math.abs(s);
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
      bestResidual = residual;
    }
  }
  return { shift: best, residual: bestResidual };
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
    const previous = this.lastProfile;
    const profile = detection.profile;
    const width = profile.length;
    this.lastProfile = profile;

    if (detection.reason !== 'ok') {
      // 判定できないフレームは、次のフレームとの比較にも使わない。
      this.history = [];
      this.lastProfile = null;
      return { status: detection.reason, spans: [], motion: 0, shift: 0 };
    }

    let shiftCols = 0;
    let motion = 0;
    if (previous && previous.length === width && width > 0) {
      const maxShift = Math.max(1, Math.round(width * this.params.maxShiftRatio));
      const estimate = estimateShift(previous, profile, maxShift);
      shiftCols = estimate.shift;
      motion = estimate.residual;
      // ずれが探せる範囲の端に張り付いた場合は、それ以上に速く動いている。
      if (motion > this.params.motionLimit || Math.abs(shiftCols) >= maxShift) {
        this.history = [detection.open];
        return { status: 'moving', spans: [], motion, shift: 0 };
      }
    }

    // 過去の判定を、今の映像の位置に合わせ直す。新しく映り込んだ列は、まだ確認できていない列として扱う。
    if (shiftCols !== 0) {
      this.history = this.history.map((frame) => {
        const moved = new Uint8Array(frame.length);
        for (let x = 0; x < frame.length; x++) {
          const from = x - shiftCols;
          if (from >= 0 && from < frame.length) moved[x] = frame[from];
        }
        return moved;
      });
    }

    this.history.push(detection.open);
    if (this.history.length > this.params.windowFrames) this.history.shift();
    const shift = width > 0 ? shiftCols / width : 0;
    if (this.history.length < this.params.minFrames) return { status: 'confirming', spans: [], motion, shift };

    // 多数決。フレームがそろうまでは、すべてで見通せた列だけを採用する。
    const frames = this.history.length;
    const need = frames >= this.params.windowFrames ? frames - this.params.allowedMisses : frames;
    const stable = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      let open = 0;
      for (const frame of this.history) if (frame.length === width && frame[x] === 1) open += 1;
      stable[x] = open >= need ? 1 : 0;
    }
    return { status: 'ok', spans: blockedSpans(stable, this.opening.minOpenRunPx), motion, shift };
  }
}

interface Track {
  key: number;
  /** なめらかにした値を入れた、表示用のルート */
  route: Route;
  /** なめらかにした確率（表示用に丸める前） */
  smooth: number;
  /** 画面に出している確率 */
  shown: number;
  /** 続けて見つかったフレーム数 */
  age: number;
  /** 続けて見失っているフレーム数 */
  misses: number;
}

export interface TrackedRoutes {
  /** 表示するルート（最大3件、左から順に A・B・C）。id は同じ隙間を追っている間は変わらない */
  routes: Route[];
  /** 主役として表示するルートの id。候補がなければ null */
  leaderId: string | null;
}

/**
 * ルートを時間方向に追跡して、確率と位置をなめらかにする。
 * 1フレームごとに計算し直したルートを渡すと、同じ隙間を同じルートとして扱い続ける。
 */
export class RouteTracker {
  private tracks: Track[] = [];
  private nextKey = 1;
  private leaderKey: number | null = null;

  constructor(private readonly params: LiveParams = LIVE_PARAMS) {}

  reset(): void {
    this.tracks = [];
    this.leaderKey = null;
  }

  /**
   * @param current いまのフレームから計算したルート
   * @param shift   前のフレームからの横ずれ（映像の横幅に対する割合）
   * @param dtMs    前回からの経過時間（ms）
   */
  update(
    current: Route[],
    shift: number,
    dtMs: number,
    frame: FrameMeta,
    focalEq: number,
    maxRoutes = 3,
  ): TrackedRoutes {
    const p = this.params;
    const alpha = 1 - Math.exp(-Math.max(1, dtMs) / p.smoothingMs);
    // 映像がずれた分だけ、覚えている位置も動かす（角度 → 画面上の位置 → ずらす → 角度）。
    const moved = (deg: number) => xToDeg(degToX(deg, frame, focalEq) + shift, frame, focalEq);
    for (const t of this.tracks) {
      t.route = {
        ...t.route,
        aimDeg: moved(t.route.aimDeg),
        clearLeftDeg: moved(t.route.clearLeftDeg),
        clearRightDeg: moved(t.route.clearRightDeg),
      };
    }

    const candidates = current.filter((r) => r.status === 'ok' && r.probability !== null);
    const taken = new Set<Route>();
    for (const t of this.tracks) {
      let match: Route | null = null;
      let bestDiff = Infinity;
      for (const c of candidates) {
        if (taken.has(c)) continue;
        const diff = Math.abs(c.aimDeg - t.route.aimDeg);
        const tolerance = Math.max(p.matchDeg, 0.5 * Math.min(c.widthDeg, t.route.widthDeg));
        if (diff <= tolerance && diff < bestDiff) {
          match = c;
          bestDiff = diff;
        }
      }
      if (!match) {
        t.misses += 1;
        continue;
      }
      taken.add(match);
      const mix = (from: number, to: number) => from + alpha * (to - from);
      t.smooth = mix(t.smooth, match.probability as number);
      if (Math.abs(t.smooth - t.shown) >= p.displayDeadband) t.shown = t.smooth;
      t.route = {
        ...match,
        aimDeg: mix(t.route.aimDeg, match.aimDeg),
        clearLeftDeg: mix(t.route.clearLeftDeg, match.clearLeftDeg),
        clearRightDeg: mix(t.route.clearRightDeg, match.clearRightDeg),
        widthDeg: mix(t.route.widthDeg, match.widthDeg),
      };
      t.age += 1;
      t.misses = 0;
    }
    this.tracks = this.tracks.filter((t) => t.misses <= p.holdFrames);
    for (const c of candidates) {
      if (taken.has(c)) continue;
      const probability = c.probability as number;
      this.tracks.push({ key: this.nextKey++, route: { ...c }, smooth: probability, shown: probability, age: 1, misses: 0 });
    }

    // 表示するのは、続けて見つかっていて、確率が小さすぎないルートだけ。
    const visible = this.tracks
      .filter((t) => t.age >= p.minAgeFrames && t.shown >= p.minProbability)
      .sort((a, b) => b.shown - a.shown)
      .slice(0, maxRoutes);

    // 主役は、ほかのルートがはっきり上回ったときだけ入れ替える。
    const top = visible[0] ?? null;
    const leader = visible.find((t) => t.key === this.leaderKey) ?? null;
    if (!top) this.leaderKey = null;
    else if (!leader || top.shown >= leader.shown + p.leaderMargin) this.leaderKey = top.key;

    const routes = [...visible]
      .sort((a, b) => a.route.aimDeg - b.route.aimDeg)
      .map((t, i) => ({
        ...t.route,
        id: `track-${t.key}`,
        letter: String.fromCharCode(65 + i),
        probability: t.shown,
        level: levelOf(t.shown),
        isBest: top !== null && t.key === top.key,
      }));
    return { routes, leaderId: this.leaderKey === null ? null : `track-${this.leaderKey}` };
  }
}
