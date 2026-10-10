import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from '../model/types';
import { LIVE_PARAMS, LiveAnalyzer, smoothRoutes } from './live';
import { OPENING_PARAMS, blockedSpans, detectOpenings, type OpeningDetection, type Pixels } from './openingDetector';

type RGB = [number, number, number];

const W = 192;
const H = 340;
const CANOPY: RGB = [40, 90, 40];
const SKY: RGB = [232, 236, 240];
const GROUND: RGB = [112, 96, 60];
const DARK_TRUNK: RGB = [70, 50, 35];
const WHITE_TRUNK: RGB = [226, 226, 220];

/** 上から「葉・明るい奥・地面」の背景に、縦に通った幹を描いた画像を作る。 */
function scene(trunks: { from: number; to: number; color: RGB }[], background?: (y: number) => RGB): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  // 判定する帯の少し外側まで、奥の明るい背景が見えている状態を基本にする。
  const skyTop = H * (OPENING_PARAMS.bandTop - 0.04);
  const skyBottom = H * (OPENING_PARAMS.bandBottom + 0.04);
  const bg = background ?? ((y: number) => (y < skyTop ? CANOPY : y < skyBottom ? SKY : GROUND));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const trunk = trunks.find((t) => x >= t.from && x < t.to);
      const [r, g, b] = trunk ? trunk.color : bg(y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

test('暗い幹は障害物、奥の明るい背景が見える列は見通せると判定する', () => {
  const det = detectOpenings(
    scene([
      { from: 40, to: 52, color: DARK_TRUNK },
      { from: 120, to: 136, color: DARK_TRUNK },
    ]),
  );
  assert.equal(det.reason, 'ok');
  for (let x = 42; x < 50; x++) assert.equal(det.open[x], 0, `幹の列 ${x}`);
  for (let x = 122; x < 134; x++) assert.equal(det.open[x], 0, `幹の列 ${x}`);
  for (const x of [10, 30, 70, 100, 150, 185]) assert.equal(det.open[x], 1, `隙間の列 ${x}`);

  const spans = blockedSpans(det.open, 2);
  assert.equal(spans.length, 2);
  assert.ok(Math.abs(spans[0].x * W - 40) <= 2 && Math.abs((spans[0].x + spans[0].w) * W - 52) <= 2);
  assert.ok(Math.abs(spans[1].x * W - 120) <= 2 && Math.abs((spans[1].x + spans[1].w) * W - 136) <= 2);
});

test('背景と同じくらい明るい幹も、上まで同じ色が続いていれば障害物とする', () => {
  const det = detectOpenings(
    scene([
      { from: 20, to: 44, color: DARK_TRUNK },
      { from: 80, to: 96, color: WHITE_TRUNK },
    ]),
  );
  assert.equal(det.reason, 'ok');
  for (let x = 83; x < 93; x++) assert.equal(det.open[x], 0, `白い幹の列 ${x}`);
  assert.equal(det.open[60], 1);
  assert.equal(det.open[150], 1);
});

test('暗すぎる画像は判定しない', () => {
  const det = detectOpenings(scene([], () => [12, 14, 12]));
  assert.equal(det.reason, 'too_dark');
  assert.ok(det.open.every((v) => v === 0));
});

test('明暗の差が小さい画像（奥が明るく見えていない）は判定不能にする', () => {
  // 林の奥に向けた状態：全体が中くらいの明るさで、幹が少し暗いだけ
  const det = detectOpenings(
    scene([{ from: 60, to: 80, color: [70, 72, 66] }], (y) => (y < H * 0.5 ? [84, 96, 80] : [92, 100, 84])),
  );
  assert.notEqual(det.reason, 'ok');
  assert.ok(det.open.every((v) => v === 0));
});

test('明るい点がまばらにあるだけの列は、見通せるとしない', () => {
  // 帯の中で1行おきに明るい（葉の隙間の木漏れ日のような状態）列を作る
  const px = scene([{ from: 40, to: 52, color: DARK_TRUNK }]);
  for (let y = Math.round(H * (OPENING_PARAMS.bandTop - 0.04)); y < Math.round(H * (OPENING_PARAMS.bandBottom + 0.04)); y++) {
    for (let x = 90; x < 100; x++) {
      const i = (y * W + x) * 4;
      const v = y % 2 === 0 ? 235 : 30;
      px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
    }
  }
  const det = detectOpenings(px);
  assert.equal(det.reason, 'ok');
  for (let x = 92; x < 98; x++) assert.equal(det.open[x], 0);
});

test('細すぎる「見通せる範囲」はノイズとして閉じる', () => {
  const open = [0, 0, 1, 0, 0, 1, 1, 1, 0, 0];
  assert.deepEqual(blockedSpans(open, 2), [
    { x: 0, w: 0.5 },
    { x: 0.8, w: 0.2 },
  ]);
  assert.deepEqual(blockedSpans([1, 1, 1, 1], 2), []);
  assert.deepEqual(blockedSpans([0, 0, 0, 0], 2), [{ x: 0, w: 1 }]);
});

function detection(open: number[], profileValue = 100, reason: OpeningDetection['reason'] = 'ok'): OpeningDetection {
  return {
    reason,
    open: Uint8Array.from(open),
    bandTop: OPENING_PARAMS.bandTop,
    bandBottom: OPENING_PARAMS.bandBottom,
    brightness: 120,
    profile: Float32Array.from(open.map(() => profileValue)),
  };
}

test('同じ向きを続けて解析できるまでは「確認中」とし、結果を出さない', () => {
  const live = new LiveAnalyzer();
  const frame = [1, 1, 1, 0, 0, 1, 1, 1];
  for (let i = 1; i < LIVE_PARAMS.confirmFrames; i++) {
    const step = live.push(detection(frame));
    assert.equal(step.status, 'confirming');
    assert.equal(step.spans.length, 0);
  }
  const step = live.push(detection(frame));
  assert.equal(step.status, 'ok');
  assert.deepEqual(step.spans, [{ x: 3 / 8, w: 2 / 8 }]);
});

test('直近で1回でも障害物と判定された列は、見通せるとしない', () => {
  const live = new LiveAnalyzer();
  live.push(detection([1, 1, 1, 1, 1, 1, 1, 1]));
  live.push(detection([1, 1, 0, 0, 1, 1, 1, 1])); // 一時的に障害物と判定
  const step = live.push(detection([1, 1, 1, 1, 1, 1, 1, 1]));
  assert.equal(step.status, 'ok');
  assert.deepEqual(step.spans, [{ x: 2 / 8, w: 2 / 8 }]);
  // その後、同じ判定が続けば解消される
  live.push(detection([1, 1, 1, 1, 1, 1, 1, 1]));
  assert.deepEqual(live.push(detection([1, 1, 1, 1, 1, 1, 1, 1])).spans, []);
});

test('カメラが動いたら結果を出さず、止まってから数え直す', () => {
  const live = new LiveAnalyzer();
  const frame = [1, 1, 0, 0, 1, 1, 1, 1];
  for (let i = 0; i < LIVE_PARAMS.confirmFrames; i++) live.push(detection(frame, 100));
  const moved = live.push(detection(frame, 100 + LIVE_PARAMS.motionLimit * 3));
  assert.equal(moved.status, 'moving');
  assert.equal(moved.spans.length, 0);
  const still = 100 + LIVE_PARAMS.motionLimit * 3;
  for (let i = 2; i < LIVE_PARAMS.confirmFrames; i++) assert.equal(live.push(detection(frame, still)).status, 'confirming');
  assert.equal(live.push(detection(frame, still)).status, 'ok');
});

test('判定できないフレームが来たら、それまでの判定を捨てる', () => {
  const live = new LiveAnalyzer();
  const frame = [1, 1, 0, 0, 1, 1, 1, 1];
  for (let i = 0; i < LIVE_PARAMS.confirmFrames; i++) live.push(detection(frame));
  assert.equal(live.push(detection(frame.map(() => 0), 100, 'low_contrast')).status, 'low_contrast');
  assert.equal(live.push(detection(frame)).status, 'confirming');
});

test('「再解析」で最初から数え直す', () => {
  const live = new LiveAnalyzer();
  const frame = [1, 1, 0, 0, 1, 1, 1, 1];
  for (let i = 0; i < LIVE_PARAMS.confirmFrames; i++) live.push(detection(frame));
  live.reset();
  assert.equal(live.push(detection(frame)).status, 'confirming');
});

function route(id: string, aimDeg: number, probability: number | null): Route {
  return {
    id,
    letter: 'A',
    status: probability === null ? 'unknown' : 'ok',
    clearLeftDeg: aimDeg - 3,
    clearRightDeg: aimDeg + 3,
    widthDeg: 6,
    leftBound: 'obstacle',
    rightBound: 'obstacle',
    hasOverhead: false,
    minClearanceM: null,
    aimDeg,
    probability,
    level: probability === null ? null : 'yellow',
    unknownReason: null,
    isBest: false,
  };
}

test('推定確率は前回の値とならし、難易度と最有力を付け直す', () => {
  const previous = [route('p1', -10, 0.2), route('p2', 8, 0.9)];
  const current = [route('c1', -10.5, 0.6), route('c2', 8.4, 0.5), route('c3', 20, 0.3)];
  const out = smoothRoutes(previous, current);
  assert.ok(Math.abs((out[0].probability as number) - 0.4) < 1e-9);
  assert.ok(Math.abs((out[1].probability as number) - 0.7) < 1e-9);
  assert.equal(out[2].probability, 0.3, '前回に対応するルートがなければそのまま');
  assert.equal(out[1].level, 'green');
  assert.equal(out[0].level, 'yellow');
  assert.deepEqual(out.map((r) => r.isBest), [false, true, false]);
  assert.equal(current[0].probability, 0.6, '元のデータは書き換えない');
});

test('帯の中がすべて明るい（暗い手前が写っていない）ときは、判定不能にする', () => {
  // 明るい背景と白い幹だけ：明暗で分けられないので、白い幹を見落とすおそれがある
  const det = detectOpenings(scene([{ from: 80, to: 96, color: WHITE_TRUNK }]));
  assert.equal(det.reason, 'low_contrast');
});

test('根元で色が変わる明るい幹（下が地面や苔）も、障害物とする', () => {
  // 帯より下で幹の色が地面の色に変わる：帯の下を比較に使うと、開いていると誤る形
  const px = scene([
    { from: 20, to: 44, color: DARK_TRUNK },
    { from: 80, to: 96, color: [150, 150, 144] },
  ]);
  for (let y = Math.round(H * (OPENING_PARAMS.bandBottom + 0.01)); y < H; y++) {
    for (let x = 80; x < 96; x++) {
      const i = (y * W + x) * 4;
      px.data[i] = 60;
      px.data[i + 1] = 110;
      px.data[i + 2] = 50;
    }
  }
  const det = detectOpenings(px);
  assert.equal(det.reason, 'ok');
  for (let x = 83; x < 93; x++) assert.equal(det.open[x], 0, `幹の列 ${x}`);
});
