import assert from 'node:assert/strict';
import { test } from 'node:test';
import { degToX, hfovDeg, normalCdf, xToDeg } from './geometry';
import { BAND_PARAMS, GEOMETRY, SCORE_BANDS } from './params';
import { recommendText } from './describe';
import { computeRoutes } from './routes';
import type { Obstacle, RouteInput } from './types';

const frame = { width: 1200, height: 1600 };

let seq = 0;
function ob(kind: Obstacle['kind'], x: number, w: number, clearance: Obstacle['clearance'] = 'waist'): Obstacle {
  seq += 1;
  return { id: `o${seq}`, kind, x, y: 0.2, w, h: 0.6, clearance, source: 'manual' };
}

function input(obstacles: Obstacle[], over: Partial<RouteInput> = {}): RouteInput {
  return { obstacles, frame, band: 90, lie: 'good', clubId: null, distanceM: null, focalEq: 26, ...over };
}

/** 中央に隙間を1つ作る。gap は写真幅に対する割合。 */
function centerGap(gap: number): Obstacle[] {
  const half = gap / 2;
  return [ob('trunk', 0, 0.5 - half), ob('trunk', 0.5 + half, 0.5 - half)];
}

test('正規分布の累積分布関数が既知の値と一致する', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1) - 0.8413447) < 1e-6);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.0249979) < 1e-6);
});

test('写真の横位置と角度を相互に変換できる', () => {
  for (const x of [0, 0.13, 0.5, 0.77, 1]) {
    assert.ok(Math.abs(degToX(xToDeg(x, frame, 26), frame, 26) - x) < 1e-9);
  }
  assert.equal(xToDeg(0.5, frame, 26), 0);
  // 3:4 の縦写真で 26mm 相当なら、横方向の画角は約53°
  assert.ok(Math.abs(hfovDeg(frame, 26) - 53.1) < 0.2);
});

test('障害物がなければ、確率を出さず判定不能にする', () => {
  const r = computeRoutes(input([]));
  assert.equal(r.status, 'insufficient');
  assert.equal(r.insufficientReason, 'no_obstacles');
  assert.equal(r.routes.length, 0);
});

test('画像サイズが不正なら判定不能にする', () => {
  const r = computeRoutes(input(centerGap(0.2), { frame: { width: 0, height: 0 } }));
  assert.equal(r.status, 'insufficient');
  assert.equal(r.insufficientReason, 'bad_frame');
});

test('中央の隙間の確率が、式から求めた値と一致する', () => {
  const r = computeRoutes(input(centerGap(0.2), { distanceM: 5 }));
  assert.equal(r.routes.length, 1);
  const route = r.routes[0];
  const edge = xToDeg(0.6, frame, 26);
  const margin = GEOMETRY.markToleranceDeg + (Math.atan(GEOMETRY.ballRadiusM / 5) * 180) / Math.PI;
  const half = edge - margin;
  const expected = (1 - BAND_PARAMS[90].mishitRate) * (2 * normalCdf(half / BAND_PARAMS[90].dirSigmaDeg) - 1);
  assert.ok(Math.abs((route.probability as number) - expected) < 1e-6);
  assert.ok(Math.abs(route.aimDeg) < 0.06, '狙いは隙間の中央になる');
  assert.equal(route.isBest, true);
  assert.equal(route.letter, 'A');
});

test('スコア帯が良いほど、同じ隙間の確率が高い', () => {
  const obstacles = centerGap(0.2);
  const ps = SCORE_BANDS.map((band) => computeRoutes(input(obstacles, { band })).routes[0].probability as number);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i] < ps[i - 1], `${SCORE_BANDS[i]}台 < ${SCORE_BANDS[i - 1]}台`);
  for (const p of ps) assert.ok(p > 0 && p < 1);
});

test('隙間が広いほど確率が高い', () => {
  const narrow = computeRoutes(input(centerGap(0.1))).routes[0].probability as number;
  const wide = computeRoutes(input(centerGap(0.3))).routes[0].probability as number;
  assert.ok(wide > narrow);
});

test('ライが悪いほど確率が低い', () => {
  const obstacles = centerGap(0.2);
  const good = computeRoutes(input(obstacles, { lie: 'good' })).routes[0].probability as number;
  const rough = computeRoutes(input(obstacles, { lie: 'rough' })).routes[0].probability as number;
  const bad = computeRoutes(input(obstacles, { lie: 'bad' })).routes[0].probability as number;
  assert.ok(good > rough && rough > bad);
});

test('全面がふさがれていれば候補を出さない', () => {
  const r = computeRoutes(input([ob('trunk', 0, 1)], { band: 70 }));
  assert.equal(r.status, 'ok');
  assert.equal(r.routes.length, 0);
});

test('余裕を引くと通れない隙間は、上級者でも候補にしない', () => {
  // 幅1%（約0.6°）の隙間は、両側の余裕（合計1°以上）より狭い
  const r = computeRoutes(input(centerGap(0.01), { band: 70 }));
  assert.equal(r.routes.length, 0);
  assert.equal(r.blockedCount, 1);
});

test('重なった幹は1つの障害物として扱う', () => {
  const r = computeRoutes(input([ob('trunk', 0.2, 0.2), ob('trunk', 0.3, 0.2), ob('ground', 0.45, 0.1)]));
  // 0.2〜0.55 がまとめてふさがれ、左右に1つずつ隙間が残る
  assert.equal(r.routes.length, 2);
  assert.deepEqual(r.routes.map((x) => x.letter), ['A', 'B']);
  assert.ok(r.routes[0].aimDeg < r.routes[1].aimDeg);
  assert.equal(r.routes[0].leftBound, 'edge');
  assert.equal(r.routes[0].rightBound, 'obstacle');
});

test('枝がかかる隙間は、距離かクラブが未入力なら判定不能にする', () => {
  const obstacles = [...centerGap(0.2), ob('branch', 0.4, 0.2, 'waist')];
  const none = computeRoutes(input(obstacles)).routes[0];
  assert.equal(none.status, 'unknown');
  assert.equal(none.probability, null);
  assert.equal(none.unknownReason, 'both');
  assert.equal(computeRoutes(input(obstacles, { distanceM: 5 })).routes[0].unknownReason, 'club');
  assert.equal(computeRoutes(input(obstacles, { clubId: 'mid' })).routes[0].unknownReason, 'distance');
  const ok = computeRoutes(input(obstacles, { distanceM: 5, clubId: 'mid' })).routes[0];
  assert.equal(ok.status, 'ok');
  assert.ok((ok.probability as number) > 0);
});

test('枝が低いほど確率が低く、枝がない場合を上回らない', () => {
  const cond = { distanceM: 5, clubId: 'long' as const };
  const free = computeRoutes(input(centerGap(0.2), cond)).routes[0].probability as number;
  const p = (c: Obstacle['clearance']) =>
    computeRoutes(input([...centerGap(0.2), ob('branch', 0.4, 0.2, c)], cond)).routes[0].probability as number;
  assert.ok(p('knee') < p('waist') && p('waist') < p('head') && p('head') <= p('over'));
  assert.ok(p('over') <= free + 1e-9);
});

test('枝が隙間の片側だけにかかるとき、狙いは枝のない側に寄る', () => {
  const r = computeRoutes(
    input([...centerGap(0.3), ob('branch', 0.35, 0.12, 'knee')], { distanceM: 5, clubId: 'mid' }),
  ).routes[0];
  assert.ok(r.aimDeg > 0.5, `aim=${r.aimDeg}`);
});

test('候補は最大3件で、左から順に A・B・C を振る', () => {
  // 幹5本で隙間が6つできる
  const trunks = [0.1, 0.25, 0.45, 0.62, 0.8].map((x) => ob('trunk', x, 0.04));
  const r = computeRoutes(input(trunks));
  assert.equal(r.routes.length, 3);
  assert.equal(r.hiddenCount, 3);
  assert.deepEqual(r.routes.map((x) => x.letter), ['A', 'B', 'C']);
  assert.ok(r.routes[0].aimDeg < r.routes[1].aimDeg && r.routes[1].aimDeg < r.routes[2].aimDeg);
  assert.equal(r.routes.filter((x) => x.isBest).length, 1);
  const best = r.routes.find((x) => x.isBest);
  for (const x of r.routes) assert.ok((best?.probability as number) >= (x.probability as number));
});

test('距離が不明なら、控えめな仮の距離で余裕を大きめに取る', () => {
  const unknown = computeRoutes(input(centerGap(0.2)));
  const known = computeRoutes(input(centerGap(0.2), { distanceM: 8 }));
  assert.equal(unknown.distanceAssumed, true);
  assert.equal(known.distanceAssumed, false);
  assert.ok(unknown.marginDeg > known.marginDeg);
  assert.ok((unknown.routes[0].probability as number) < (known.routes[0].probability as number));
});

test('枝がかかる広い隙間は、判定不能でも候補に残す（狭い隙間に置き換えない）', () => {
  // 幹4本で隙間が5つ。中央の広い隙間に枝がかかり、距離とクラブは未入力。
  const trunks = [ob('trunk', 0.1, 0.07), ob('trunk', 0.36, 0.06), ob('trunk', 0.6, 0.08), ob('trunk', 0.86, 0.07)];
  const r = computeRoutes(input([...trunks, ob('branch', 0.42, 0.18)]));
  assert.equal(r.routes.length, 3);
  const unknown = r.routes.filter((x) => x.status === 'unknown');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].probability, null);
  assert.equal(unknown[0].level, null);
  assert.equal(unknown[0].isBest, false);
  assert.ok(Math.abs(unknown[0].aimDeg) < 3, '中央の隙間が残っている');
  assert.equal(r.routes.filter((x) => x.isBest).length, 1);
});

test('写真の端にかかる隙間は、確率が高くてもおすすめ度を「◎」にしない', () => {
  // 幹1本だけ：左右の隙間はどちらも写真の端まで続く
  const edge = computeRoutes(input([ob('trunk', 0.3, 0.1)], { band: 70 })).routes;
  assert.ok(edge.every((x) => x.level === 'green'));
  assert.ok(edge.every((x) => !recommendText(x).includes('◎')));
  // 両側を幹で囲まれた広い隙間は「◎」になる
  const inner = computeRoutes(input(centerGap(0.5), { band: 70 })).routes[0];
  assert.equal(inner.level, 'green');
  assert.ok(recommendText(inner).startsWith('◎'));
});
