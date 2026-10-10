/**
 * 障害物の位置から、通過候補のルートと推定確率を計算する。
 *
 * 入力は「障害物の矩形」と「撮影条件」だけの純粋な関数にしてある。
 * 手動指定・静止画の自動検出・リアルタイム解析のどれも、同じ形式の障害物を渡して使う。
 *
 * 考え方：
 *  1. 写真の横位置を、ボール付近から見た左右の角度に変換する（画角は仮定）。
 *  2. 幹・地面の障害物がふさぐ角度の範囲を除いた残りを「隙間」とする。
 *  3. 隙間の両側から、指定のずれとボール幅の分の余裕を引く。
 *  4. 打ち出し方向のばらつきを正規分布とみなし、隙間に収まる割合を求める。
 *     枝がかかる範囲では、打ち出し高さが枝の下に収まる割合を掛ける。
 *  5. 大きなミス（チョロなど）の割合を差し引く。
 *
 * AIの検出確信度は、この確率には一切使わない。
 */
import { degToX, hfovDeg, normalCdf, toDeg, xToDeg } from './geometry';
import {
  BAND_PARAMS,
  CLEARANCES,
  CLUBS,
  GEOMETRY,
  LEVEL_THRESHOLDS,
  LIES,
  MAX_ROUTES,
} from './params';
import type { BoundKind, Level, Route, RouteInput, RouteResult } from './types';

interface Interval {
  lo: number;
  hi: number;
}

interface Segment extends Interval {
  /** この範囲にかかる枝のうち最も低い下端の高さ（m）。枝がなければ null */
  heightM: number | null;
}

const EPS = 1e-9;

export function levelOf(probability: number): Level {
  if (probability >= LEVEL_THRESHOLDS.green) return 'green';
  if (probability >= LEVEL_THRESHOLDS.yellow) return 'yellow';
  return 'red';
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.lo - b.lo);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.lo <= last.hi + EPS) last.hi = Math.max(last.hi, cur.hi);
    else out.push({ ...cur });
  }
  return out;
}

/** 隙間を、枝のかかり方が同じ範囲ごとに分ける。 */
function buildSegments(lo: number, hi: number, branches: (Interval & { heightM: number })[]): Segment[] {
  const cuts = new Set<number>([lo, hi]);
  for (const b of branches) {
    if (b.lo > lo && b.lo < hi) cuts.add(b.lo);
    if (b.hi > lo && b.hi < hi) cuts.add(b.hi);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b - a < EPS) continue;
    const mid = (a + b) / 2;
    let heightM: number | null = null;
    for (const br of branches) {
      if (mid > br.lo && mid < br.hi) heightM = heightM === null ? br.heightM : Math.min(heightM, br.heightM);
    }
    segments.push({ lo: a, hi: b, heightM });
  }
  return segments;
}

export function computeRoutes(input: RouteInput): RouteResult {
  const { frame, focalEq, obstacles } = input;
  const band = BAND_PARAMS[input.band];
  const lie = LIES.find((l) => l.id === input.lie) ?? LIES[0];
  const club = CLUBS.find((c) => c.id === input.clubId) ?? null;

  const dirSigmaDeg = band.dirSigmaDeg * lie.sigmaMult;
  const launchSigmaDeg = band.launchSigmaDeg * lie.sigmaMult;
  const mishitRate = Math.min(GEOMETRY.mishitCap, band.mishitRate * lie.mishitMult);

  const frameOk = frame.width > 0 && frame.height > 0 && focalEq > 0;
  const distanceForMargin = input.distanceM ?? GEOMETRY.unknownDistanceAssumedM;
  const marginDeg =
    GEOMETRY.markToleranceDeg + toDeg(Math.atan(GEOMETRY.ballRadiusM / distanceForMargin));

  const base: RouteResult = {
    status: 'ok',
    insufficientReason: null,
    routes: [],
    hiddenCount: 0,
    blockedCount: 0,
    hfovDeg: frameOk ? hfovDeg(frame, focalEq) : 0,
    dirSigmaDeg,
    launchSigmaDeg,
    mishitRate,
    marginDeg,
    distanceAssumed: input.distanceM === null,
  };

  if (!frameOk) return { ...base, status: 'insufficient', insufficientReason: 'bad_frame' };
  if (obstacles.length === 0) return { ...base, status: 'insufficient', insufficientReason: 'no_obstacles' };

  const viewLo = xToDeg(0, frame, focalEq);
  const viewHi = xToDeg(1, frame, focalEq);
  const clampView = (deg: number) => Math.min(viewHi, Math.max(viewLo, deg));
  const span = (o: { x: number; w: number }): Interval => ({
    lo: xToDeg(Math.min(o.x, o.x + o.w), frame, focalEq),
    hi: xToDeg(Math.max(o.x, o.x + o.w), frame, focalEq),
  });

  // 幹と地面の障害物は、低い球に対して全面的にふさぐものとして扱う。
  const blockers = mergeIntervals(
    obstacles
      .filter((o) => o.kind === 'trunk' || o.kind === 'ground')
      .map(span)
      .map((s) => ({ lo: clampView(s.lo), hi: clampView(s.hi) }))
      .filter((s) => s.hi - s.lo > EPS),
  );

  const branches = obstacles
    .filter((o) => o.kind === 'branch')
    .map((o) => {
      const s = span(o);
      const clearance = CLEARANCES.find((c) => c.id === o.clearance) ?? CLEARANCES[0];
      return { lo: s.lo - marginDeg, hi: s.hi + marginDeg, heightM: clearance.heightM };
    });

  // 見えている範囲から、ふさがれた範囲を除いた残りが隙間。
  const gaps: { lo: number; hi: number; leftBound: BoundKind; rightBound: BoundKind }[] = [];
  let cursor = viewLo;
  let cursorBound: BoundKind = 'edge';
  for (const b of blockers) {
    if (b.lo - cursor > EPS) gaps.push({ lo: cursor, hi: b.lo, leftBound: cursorBound, rightBound: 'obstacle' });
    cursor = Math.max(cursor, b.hi);
    cursorBound = 'obstacle';
  }
  if (viewHi - cursor > EPS) gaps.push({ lo: cursor, hi: viewHi, leftBound: cursorBound, rightBound: 'edge' });

  const heightProbability = (heightM: number): number => {
    // この関数は距離とクラブがそろっているときだけ呼ぶ。
    const maxLaunchDeg = toDeg(
      Math.atan2(heightM - GEOMETRY.ballRadiusM - GEOMETRY.heightSafetyM, input.distanceM as number),
    );
    return normalCdf((maxLaunchDeg - (club as NonNullable<typeof club>).launchDeg) / launchSigmaDeg);
  };

  const candidates: Route[] = [];
  const rank = new Map<string, number>();
  let blockedCount = 0;

  gaps.forEach((gap, index) => {
    const clearLo = gap.lo + (gap.leftBound === 'obstacle' ? marginDeg : 0);
    const clearHi = gap.hi - (gap.rightBound === 'obstacle' ? marginDeg : 0);
    const widthDeg = clearHi - clearLo;
    if (widthDeg < GEOMETRY.minClearWidthDeg) {
      blockedCount += 1;
      return;
    }

    const over = branches
      .map((b) => ({ lo: Math.max(b.lo, clearLo), hi: Math.min(b.hi, clearHi), heightM: b.heightM }))
      .filter((b) => b.hi - b.lo > EPS);
    const hasOverhead = over.length > 0;
    const minClearanceM = hasOverhead ? Math.min(...over.map((b) => b.heightM)) : null;

    const route: Route = {
      id: `gap-${index}`,
      letter: '',
      status: 'ok',
      clearLeftDeg: clearLo,
      clearRightDeg: clearHi,
      widthDeg,
      leftBound: gap.leftBound,
      rightBound: gap.rightBound,
      hasOverhead,
      minClearanceM,
      aimDeg: (clearLo + clearHi) / 2,
      probability: null,
      level: null,
      unknownReason: null,
      isBest: false,
    };

    // 枝がかかるのに距離かクラブが分からない場合は、高さの判定ができない。
    const heightUnknown = hasOverhead && (input.distanceM === null || club === null);

    const segments = buildSegments(clearLo, clearHi, over).map((s) => ({
      ...s,
      pass: s.heightM === null || heightUnknown ? 1 : heightProbability(s.heightM),
    }));
    const passAt = (aim: number) =>
      segments.reduce(
        (sum, s) =>
          sum + (normalCdf((s.hi - aim) / dirSigmaDeg) - normalCdf((s.lo - aim) / dirSigmaDeg)) * s.pass,
        0,
      );

    // 隙間の中で、通過の割合が最大になる狙い方向を探す。
    const steps = Math.max(1, Math.round(widthDeg / GEOMETRY.aimStepDeg));
    const values: number[] = [];
    let best = -1;
    for (let i = 0; i <= steps; i++) {
      const p = passAt(clearLo + (widthDeg * i) / steps);
      values.push(p);
      if (p > best) best = p;
    }
    const tied = values.map((p, i) => (p >= best - EPS ? i : -1)).filter((i) => i >= 0);
    const bestIndex = tied[Math.floor(tied.length / 2)];

    // 刻みの間に最大がある場合に備えて、見つけた位置の前後を細かく探し直す。
    const stepDeg = widthDeg / steps;
    const coarseAim = clearLo + stepDeg * bestIndex;
    let lo = Math.max(clearLo, coarseAim - stepDeg);
    let hi = Math.min(clearHi, coarseAim + stepDeg);
    for (let i = 0; i < 40; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (passAt(m1) < passAt(m2)) lo = m1;
      else hi = m2;
    }
    const fineAim = (lo + hi) / 2;
    const fine = passAt(fineAim);
    const bestAim = fine > best ? fineAim : coarseAim;
    const passed = Math.min(1, Math.max(0, (1 - mishitRate) * Math.max(best, fine)));

    if (heightUnknown) {
      // 判定不能。数値は表示しないが、枝を無視した場合の上限を並べ替えにだけ使う。
      route.status = 'unknown';
      route.unknownReason =
        input.distanceM === null && club === null ? 'both' : input.distanceM === null ? 'distance' : 'club';
    } else {
      route.aimDeg = bestAim;
      route.probability = passed;
      route.level = levelOf(passed);
    }
    rank.set(route.id, passed);
    candidates.push(route);
  });

  // 有力な順に並べる。判定不能の候補も、枝がなければ有力な隙間なら残す
  // （情報を入力すれば計算できることを利用者に示すため）。
  const ranked = [...candidates].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
  const shown = ranked.slice(0, MAX_ROUTES);
  const top = shown.find((r) => r.status === 'ok'); // 並べ替え済みなので、最初に見つかるものが最も確率が高い
  if (top) top.isBest = true;

  shown.sort((a, b) => a.aimDeg - b.aimDeg);
  shown.forEach((r, i) => {
    r.letter = String.fromCharCode(65 + i);
  });

  return { ...base, routes: shown, hiddenCount: ranked.length - shown.length, blockedCount };
}

/** ルートの描画用に、角度を写真の横位置（0〜1）に変換する。 */
export function routeToImageX(route: Route, input: Pick<RouteInput, 'frame' | 'focalEq'>) {
  return {
    left: degToX(route.clearLeftDeg, input.frame, input.focalEq),
    right: degToX(route.clearRightDeg, input.frame, input.focalEq),
    aim: degToX(route.aimDeg, input.frame, input.focalEq),
  };
}
