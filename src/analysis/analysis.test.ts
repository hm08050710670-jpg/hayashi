import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from '../model/types';
import { LIVE_PARAMS, LiveAnalyzer, RouteTracker, estimateShift } from './live';
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


// ---------- リアルタイム解析の安定化 ----------

const N = 64;

/** 見通せる列は明るく、障害物の列は暗い、という明るさの並びを作る（横ずれの推定に使われる）。 */
function detection(open: number[], reason: OpeningDetection['reason'] = 'ok', profile?: number[]): OpeningDetection {
  return {
    reason,
    open: Uint8Array.from(open),
    bandTop: OPENING_PARAMS.bandTop,
    bandBottom: OPENING_PARAMS.bandBottom,
    brightness: 120,
    profile: Float32Array.from(profile ?? open.map((v, x) => (v ? 200 : 60) + (x % 3))),
  };
}

/** 障害物（0）の区間を指定して、列ごとの判定を作る。 */
function pattern(blocks: [number, number][], shift = 0): number[] {
  const open = new Array<number>(N).fill(1);
  for (const [from, to] of blocks) {
    for (let x = from + shift; x < to + shift; x++) if (x >= 0 && x < N) open[x] = 0;
  }
  return open;
}

const BASE: [number, number][] = [
  [10, 16],
  [34, 42],
];

test('横ずれの推定：ずらした明るさの並びから、ずれた列数を求められる', () => {
  const base = Float32Array.from({ length: 96 }, (_, x) => 100 + 60 * Math.sin(x * 0.37) + 30 * Math.sin(x * 1.3));
  for (const s of [-5, -1, 0, 2, 7]) {
    const moved = Float32Array.from({ length: 96 }, (_, x) => base[Math.min(95, Math.max(0, x - s))]);
    const got = estimateShift(base, moved, 9);
    assert.equal(got.shift, s);
    assert.ok(got.residual < 2);
  }
});

test('同じ向きを続けて解析できるまでは「確認中」とし、結果を出さない', () => {
  const live = new LiveAnalyzer();
  for (let i = 1; i < LIVE_PARAMS.minFrames; i++) {
    const step = live.push(detection(pattern(BASE)));
    assert.equal(step.status, 'confirming');
    assert.equal(step.spans.length, 0);
  }
  const step = live.push(detection(pattern(BASE)));
  assert.equal(step.status, 'ok');
  assert.deepEqual(step.spans, [
    { x: 10 / N, w: 6 / N },
    { x: 34 / N, w: 8 / N },
  ]);
});

test('1フレームだけの誤判定では結果を変えず、続けば障害物として反映する', () => {
  const live = new LiveAnalyzer();
  for (let i = 0; i < LIVE_PARAMS.windowFrames; i++) live.push(detection(pattern(BASE)));
  const noisy = pattern([...BASE, [50, 54]]);
  // 明るさの並びは同じにして、判定だけが1フレーム揺れた状況を作る
  const sameLook = detection(pattern(BASE)).profile;
  const once = live.push(detection(noisy, 'ok', Array.from(sameLook)));
  assert.equal(once.spans.length, 2, '1回だけでは増えない');
  const twice = live.push(detection(noisy, 'ok', Array.from(sameLook)));
  assert.equal(twice.spans.length, 3, '続けば障害物になる');
  assert.deepEqual(twice.spans[2], { x: 50 / N, w: 4 / N });
});

test('フレームがそろうまでは、1回でも障害物と判定された列を見通せるとしない', () => {
  const live = new LiveAnalyzer();
  const sameLook = Array.from(detection(pattern(BASE)).profile);
  live.push(detection(pattern(BASE)));
  live.push(detection(pattern([...BASE, [50, 54]]), 'ok', sameLook));
  const step = live.push(detection(pattern(BASE)));
  assert.equal(step.status, 'ok');
  assert.equal(step.spans.length, 3);
});

test('手の揺れ・ゆっくりした向きの変化では、判定を今の位置に合わせ直して追従する', () => {
  const live = new LiveAnalyzer();
  let last = live.push(detection(pattern(BASE, 0)));
  for (let k = 1; k <= 6; k++) {
    last = live.push(detection(pattern(BASE, 2 * k)));
    assert.notEqual(last.status, 'moving', `${k}フレーム目`);
    assert.ok(Math.abs(last.shift - 2 / N) < 1e-9, '横ずれは2列');
  }
  assert.equal(last.status, 'ok');
  // 障害物は、ずれた先の位置に、元の幅のまま残る（位置を合わせないと、ずれた分だけ太る）
  const first = last.spans.find((s) => Math.abs(s.x - (10 + 12) / N) < 1e-9);
  const second = last.spans.find((s) => Math.abs(s.x - (34 + 12) / N) < 1e-9);
  assert.ok(first && Math.abs(first.w - 6 / N) < 1e-9, JSON.stringify(last.spans));
  assert.ok(second && Math.abs(second.w - 8 / N) < 1e-9, JSON.stringify(last.spans));
  // 新しく映り込んだ左端は、まだ確認できていないので見通せるとしない
  assert.equal(last.spans[0].x, 0);
});

test('速く動かしたときは結果を出さず、止まってから数え直す', () => {
  const live = new LiveAnalyzer();
  for (let i = 0; i < LIVE_PARAMS.windowFrames; i++) live.push(detection(pattern(BASE)));
  const fast = Math.round(N * LIVE_PARAMS.maxShiftRatio) + 3;
  const moved = live.push(detection(pattern(BASE, fast)));
  assert.equal(moved.status, 'moving');
  assert.equal(moved.spans.length, 0);
  for (let i = 2; i < LIVE_PARAMS.minFrames; i++) {
    assert.equal(live.push(detection(pattern(BASE, fast))).status, 'confirming');
  }
  assert.equal(live.push(detection(pattern(BASE, fast))).status, 'ok');
});

test('映像が大きく変わったときは、それまでの判定を引き継がない', () => {
  const live = new LiveAnalyzer();
  for (let i = 0; i < LIVE_PARAMS.windowFrames; i++) live.push(detection(pattern(BASE)));
  const other = pattern([
    [2, 30],
    [48, 60],
  ]);
  assert.equal(live.push(detection(other)).status, 'moving');
});

test('判定できないフレームが来たら、それまでの判定を捨てる', () => {
  const live = new LiveAnalyzer();
  for (let i = 0; i < LIVE_PARAMS.windowFrames; i++) live.push(detection(pattern(BASE)));
  assert.equal(live.push(detection(pattern([[0, N]]), 'low_contrast')).status, 'low_contrast');
  assert.equal(live.push(detection(pattern(BASE))).status, 'confirming');
});

test('「再解析」で最初から数え直す', () => {
  const live = new LiveAnalyzer();
  for (let i = 0; i < LIVE_PARAMS.windowFrames; i++) live.push(detection(pattern(BASE)));
  live.reset();
  assert.equal(live.push(detection(pattern(BASE))).status, 'confirming');
});

// ---------- ルートの追跡 ----------

const FRAME = { width: 1200, height: 1600 };
const FOCAL = 26;
const DT = 250;

function route(aimDeg: number, probability: number, widthDeg = 6): Route {
  return {
    id: 'gap',
    letter: '?',
    status: 'ok',
    clearLeftDeg: aimDeg - widthDeg / 2,
    clearRightDeg: aimDeg + widthDeg / 2,
    widthDeg,
    leftBound: 'obstacle',
    rightBound: 'obstacle',
    hasOverhead: false,
    minClearanceM: null,
    aimDeg,
    probability,
    level: 'yellow',
    unknownReason: null,
    isBest: false,
  };
}

function feed(tracker: RouteTracker, routes: Route[], shift = 0) {
  return tracker.update(routes, shift, DT, FRAME, FOCAL);
}

test('見つかったばかりのルートは、続けて見つかるまで表示しない', () => {
  const tracker = new RouteTracker();
  assert.equal(feed(tracker, [route(0, 0.6)]).routes.length, 0);
  const out = feed(tracker, [route(0, 0.6)]);
  assert.equal(out.routes.length, 1);
  assert.equal(out.routes[0].probability, 0.6);
  assert.equal(out.leaderId, out.routes[0].id);
});

test('確率の小さな揺れでは、表示の数値を変えない', () => {
  const tracker = new RouteTracker();
  const shown = new Set<number>();
  for (let i = 0; i < 24; i++) {
    const out = feed(tracker, [route(0.1 * (i % 3), i % 2 ? 0.62 : 0.58)]);
    if (out.routes[0]) shown.add(out.routes[0].probability as number);
  }
  assert.equal(shown.size, 1, [...shown].join(','));
});

test('確率が大きく変わったときは、急に飛ばずになめらかに近づく', () => {
  const tracker = new RouteTracker();
  for (let i = 0; i < 4; i++) feed(tracker, [route(0, 0.6)]);
  const seen: number[] = [];
  for (let i = 0; i < 30; i++) seen.push(feed(tracker, [route(0, 0.3)]).routes[0].probability as number);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] <= seen[i - 1] + 1e-9, '戻らない');
    assert.ok(seen[i - 1] - seen[i] < 0.1, '1回で大きく飛ばない');
  }
  assert.ok(seen[0] > 0.5, '最初の1回ではほとんど変わらない');
  assert.ok(Math.abs(seen[seen.length - 1] - 0.3) <= LIVE_PARAMS.displayDeadband, '最終的には新しい値に近づく');
});

test('同じ隙間は、位置が少しずつ動いても同じルートとして追い続ける', () => {
  const tracker = new RouteTracker();
  feed(tracker, [route(0, 0.6)]);
  const id = feed(tracker, [route(0, 0.6)]).routes[0].id;
  for (let i = 1; i <= 12; i++) {
    const out = feed(tracker, [route(0.4 * i, 0.6)]);
    assert.equal(out.routes[0].id, id);
  }
});

test('映像が横にずれたときは、覚えている位置もずらして同じルートとして扱う', () => {
  const tracker = new RouteTracker();
  feed(tracker, [route(-8, 0.6, 4), route(4, 0.5, 4)]);
  const before = feed(tracker, [route(-8, 0.6, 4), route(4, 0.5, 4)]).routes;
  // 映像が横幅の10%（約6°）右へずれた：どちらの隙間も6°ほど右に見える
  const out = tracker.update([route(-2.1, 0.6, 4), route(9.6, 0.5, 4)], 0.1, DT, FRAME, FOCAL).routes;
  assert.deepEqual(
    out.map((r) => r.id),
    before.map((r) => r.id),
  );
  assert.ok(Math.abs(out[0].aimDeg - -2.1) < 0.5 && Math.abs(out[1].aimDeg - 9.6) < 0.5);
});

test('一瞬見失ったルートはしばらく表示を続け、見失い続けたら消す', () => {
  const tracker = new RouteTracker();
  feed(tracker, [route(0, 0.6)]);
  feed(tracker, [route(0, 0.6)]);
  for (let i = 0; i < LIVE_PARAMS.holdFrames; i++) assert.equal(feed(tracker, []).routes.length, 1, `${i + 1}回目`);
  assert.equal(feed(tracker, []).routes.length, 0);
});

test('主役のルートは、わずかな差では入れ替えず、はっきり上回ったら入れ替える', () => {
  const tracker = new RouteTracker();
  feed(tracker, [route(-10, 0.52), route(10, 0.5)]);
  const first = feed(tracker, [route(-10, 0.52), route(10, 0.5)]);
  const leader = first.leaderId;
  assert.equal(leader, first.routes[0].id);
  // 右のルートがわずかに上回ったり下回ったりしても、主役は変わらない
  for (let i = 0; i < 20; i++) {
    const out = feed(tracker, [route(-10, 0.5), route(10, i % 2 ? 0.56 : 0.5)]);
    assert.equal(out.leaderId, leader);
  }
  // 右のルートがはっきり上回り続けると、主役が入れ替わる
  let last = first;
  for (let i = 0; i < 30; i++) last = feed(tracker, [route(-10, 0.5), route(10, 0.75)]);
  assert.equal(last.leaderId, last.routes[1].id);
  assert.equal(last.routes[1].isBest, true);
});

test('確率が小さすぎるルートは表示せず、表示するルートには左から順に記号を振る', () => {
  const tracker = new RouteTracker();
  const input = [route(12, 0.4), route(-12, 0.6), route(0, 0.03), route(24, 0.2)];
  feed(tracker, input);
  const out = feed(tracker, input).routes;
  assert.deepEqual(
    out.map((r) => [r.letter, Math.round(r.aimDeg)]),
    [
      ['A', -12],
      ['B', 12],
      ['C', 24],
    ],
  );
  assert.deepEqual(out.map((r) => r.isBest), [true, false, false]);
  assert.deepEqual(out.map((r) => r.level), ['yellow', 'yellow', 'red']);
});

test('やり直すと、追跡も最初からになる', () => {
  const tracker = new RouteTracker();
  feed(tracker, [route(0, 0.6)]);
  feed(tracker, [route(0, 0.6)]);
  tracker.reset();
  assert.equal(feed(tracker, [route(0, 0.6)]).routes.length, 0);
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
