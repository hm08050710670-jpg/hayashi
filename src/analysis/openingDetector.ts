/**
 * 画像処理による「見通せる方向」の自動検出（試験版）。AIモデルは使っていない。
 *
 * 林の中から開けた場所（フェアウェイや空）を見ると、奥は明るく、手前の幹や枝は暗い影絵のように写る。
 * この性質を使い、映像の中央付近の帯（目の高さあたり）で、列ごとに次の2つを両方満たすときだけ
 * 「見通せる」とし、それ以外はすべて「障害物または未確認」とする。
 *   1. 帯の中に、奥の明るい背景が上下に連続して見えている。
 *   2. その列の色が、帯の上・帯の中・帯の下で変わっている。
 *      （幹は上から下まで同じ色が続く。開けた方向は、葉・奥の景色・地面と上下で色が変わる。
 *        日が当たった明るい幹や白い幹を「開いている」と誤らないための確認）
 * 幹そのものを当てにいくのではなく、「奥が見えている」と確認できた範囲だけを開いているとみなすので、
 * 見落としは「通れない」側に倒れる。
 *
 * 判定できない・誤りやすい場面：
 *  - 奥が明るく写っていない（林の奥に向けている、曇天・夕方・日陰で明暗の差が小さい）→ 判定不能にする
 *  - 開けた方向でも、上下で色があまり変わらない場合 → 未確認として扱う（開いていると表示しない）
 *  - 幹の途中で色が変わる場合（苔、強い影、手前の葉）→ 開いていると誤る可能性が残る
 *  - 帯の高さに入っていない低い枝・切り株・地面の障害物 → 検出しない
 * 実際の林での精度は未検証。しきい値はすべて調整可能な仮の値。
 */

export interface Pixels {
  /** RGBA の画素（1画素4バイト） */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface OpeningParams {
  /** 解析用に縮小する横幅（px） */
  analysisWidth: number;
  /** 見通しを調べる帯の上端・下端（画像の高さに対する割合） */
  bandTop: number;
  bandBottom: number;
  /** 明るい背景と暗い手前の、平均の明るさの差の下限（0〜255） */
  minSeparation: number;
  /** 明暗がどれだけはっきり2つに分かれているかの下限（0〜1） */
  minBimodality: number;
  /** 明るい背景とみなす下限を、背景の明るさからこの値だけ下に置く（明るい幹を背景と誤らないため） */
  backdropMargin: number;
  /** 列を「見通せる」とするのに必要な、帯の中で背景が上下に連続して見えている割合 */
  minOpenFraction: number;
  /** 列を「見通せる」とするのに必要な、上下の色の変化の下限（0〜255）。これ未満は幹とみなす */
  minVerticalChange: number;
  /** 上下の色の変化を調べるために、帯の上と下にそれぞれ足す範囲（画像の高さに対する割合） */
  aboveBand: number;
  belowBand: number;
  /** 見通せる範囲の幅の下限（px）。これより細いものはノイズとして捨てる */
  minOpenRunPx: number;
  /** 明るい背景が帯全体に占める割合の下限。これ未満は「奥が見えていない」とする */
  minBackdropShare: number;
  /** 画像全体がこれより暗いときは判定しない */
  darkBelow: number;
}

export const OPENING_PARAMS: OpeningParams = {
  analysisWidth: 192,
  bandTop: 0.4,
  bandBottom: 0.58,
  minSeparation: 45,
  minBimodality: 0.55,
  backdropMargin: 45,
  minOpenFraction: 0.2,
  minVerticalChange: 22,
  aboveBand: 0.25,
  belowBand: 0.2,
  minOpenRunPx: 2,
  minBackdropShare: 0.02,
  darkBelow: 40,
};

export type OpeningReason = 'ok' | 'too_dark' | 'no_backdrop' | 'low_contrast' | 'bad_frame';

export interface OpeningDetection {
  /** 判定できたか。ok 以外のとき open は使わない */
  reason: OpeningReason;
  /** 列ごとの、見通せるか（1）・障害物または未確認か（0）。長さは解析用の横幅 */
  open: Uint8Array;
  /** 帯の上端・下端（画像の高さに対する割合） */
  bandTop: number;
  bandBottom: number;
  /** 画像全体の平均の明るさ（0〜255） */
  brightness: number;
  /** 帯の列ごとの平均の明るさ。カメラの動きの検出に使う */
  profile: Float32Array;
}

/** 調整用に、判定の途中の値を受け取る入れ物 */
export interface OpeningDebug {
  split?: number;
  darkMean?: number;
  brightMean?: number;
  bimodality?: number;
  threshold?: number;
  backdropShare?: number;
}

export function detectOpenings(
  px: Pixels,
  params: OpeningParams = OPENING_PARAMS,
  debug?: OpeningDebug,
): OpeningDetection {
  const { data, width: W, height: H } = px;
  const y0 = Math.round(H * params.bandTop);
  const y1 = Math.max(y0 + 4, Math.round(H * params.bandBottom));
  const empty: OpeningDetection = {
    reason: 'bad_frame',
    open: new Uint8Array(Math.max(0, W)),
    bandTop: params.bandTop,
    bandBottom: params.bandBottom,
    brightness: 0,
    profile: new Float32Array(Math.max(0, W)),
  };
  if (W < 16 || H < 16 || y1 > H) return empty;

  // 画像全体の明るさ（間引いて計算）
  let total = 0;
  let count = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count += 1;
    }
  }
  const brightness = count ? total / count : 0;

  // 帯の中の明るさと、その度数分布
  const rows = y1 - y0;
  const lum = new Uint8Array(W * rows);
  const hist = new Float64Array(256);
  const profile = new Float32Array(W);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      lum[(y - y0) * W + x] = v;
      hist[v] += 1;
      profile[x] += v / rows;
    }
  }
  const base = { ...empty, brightness, profile };
  if (brightness < params.darkBelow) return { ...base, reason: 'too_dark' };

  // 大津の方法で、暗い手前と明るい背景を分ける明るさを求める。
  const n = W * rows;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  const meanAll = sumAll / n;
  let varAll = 0;
  for (let v = 0; v < 256; v++) varAll += hist[v] * (v - meanAll) * (v - meanAll);
  varAll /= n;

  let best = -1;
  let split = 128;
  let w0 = 0;
  let sum0 = 0;
  let darkMean = 0;
  let brightMean = 0;
  for (let v = 0; v < 255; v++) {
    w0 += hist[v];
    sum0 += v * hist[v];
    const w1 = n - w0;
    if (w0 === 0 || w1 === 0) continue;
    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const between = (w0 / n) * (w1 / n) * (m1 - m0) * (m1 - m0);
    if (between > best) {
      best = between;
      split = v + 1;
      darkMean = m0;
      brightMean = m1;
    }
  }
  const bimodality = varAll > 0 ? best / varAll : 0;
  if (debug) Object.assign(debug, { split, darkMean, brightMean, bimodality });
  if (brightMean - darkMean < params.minSeparation || bimodality < params.minBimodality) {
    return { ...base, reason: 'low_contrast' };
  }

  // 背景とみなす明るさの下限。背景より明らかに暗いもの（明るめの幹など）は背景に含めない。
  const threshold = Math.max(split, brightMean - params.backdropMargin);

  // 帯の上・帯の中・帯の下の、列ごとの平均の色
  const zoneColor = (from: number, to: number): Float32Array => {
    const a = Math.max(0, Math.min(H, Math.round(from)));
    const b = Math.max(a + 1, Math.min(H, Math.round(to)));
    const out = new Float32Array(W * 3);
    for (let y = a; y < b && y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        out[x * 3] += data[i];
        out[x * 3 + 1] += data[i + 1];
        out[x * 3 + 2] += data[i + 2];
      }
    }
    for (let i = 0; i < out.length; i++) out[i] /= b - a;
    return out;
  };
  const above = zoneColor(y0 - H * params.aboveBand, y0);
  const within = zoneColor(y0, y1);
  const below = zoneColor(y1, y1 + H * params.belowBand);
  const change = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let d = 0;
    for (let c = 0; c < 3; c++) {
      d += Math.abs(above[x * 3 + c] - within[x * 3 + c]) + Math.abs(within[x * 3 + c] - below[x * 3 + c]);
    }
    change[x] = d / 6;
  }

  let backdrop = 0;
  const open = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    // 背景が上下に連続して見えている、最も長い区間
    let run = 0;
    let longest = 0;
    for (let r = 0; r < rows; r++) {
      if (lum[r * W + x] >= threshold) {
        run += 1;
        backdrop += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    // 上下の色の変化は、隣の列とならして1列だけのノイズを抑える
    const smooth = (change[Math.max(0, x - 1)] + 2 * change[x] + change[Math.min(W - 1, x + 1)]) / 4;
    open[x] = longest / rows >= params.minOpenFraction && smooth >= params.minVerticalChange ? 1 : 0;
  }
  if (debug) Object.assign(debug, { threshold, backdropShare: backdrop / n });
  if (backdrop / n < params.minBackdropShare) return { ...base, reason: 'no_backdrop' };

  return { ...base, reason: 'ok', open };
}

export interface BlockedSpan {
  /** 画像の横幅に対する割合（0〜1） */
  x: number;
  w: number;
}

/** 列ごとの「見通せるか」から、障害物または未確認の範囲（見通せない範囲）を求める。 */
export function blockedSpans(open: ArrayLike<boolean | number>, minOpenRunPx: number): BlockedSpan[] {
  const W = open.length;
  const isOpen: boolean[] = [];
  for (let x = 0; x < W; x++) isOpen.push(Boolean(open[x]));

  // 細すぎる「見通せる範囲」はノイズとして閉じる。
  let x = 0;
  while (x < W) {
    if (!isOpen[x]) {
      x += 1;
      continue;
    }
    let end = x;
    while (end < W && isOpen[end]) end += 1;
    if (end - x < minOpenRunPx) for (let i = x; i < end; i++) isOpen[i] = false;
    x = end;
  }

  const spans: BlockedSpan[] = [];
  x = 0;
  while (x < W) {
    if (isOpen[x]) {
      x += 1;
      continue;
    }
    let end = x;
    while (end < W && !isOpen[end]) end += 1;
    spans.push({ x: x / W, w: (end - x) / W });
    x = end;
  }
  return spans;
}
