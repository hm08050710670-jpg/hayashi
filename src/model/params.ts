/**
 * 成功率計算の仮パラメータ。
 *
 * ここにある数値はすべて「調整可能な仮の値」であり、実測データで検証したものではない。
 * 実際のショット結果を集めて補正する前提で、1か所にまとめて管理する。
 * 画面上の確率には必ず「仮モデルによる推定・未検証」と表示すること。
 */

export const MODEL_LABEL = '仮モデルによる推定・未検証';
export const MODEL_VERSION = '0.1';

export const SCORE_BANDS = [70, 80, 90, 100, 110, 120] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export interface BandParams {
  /** 低い球の打ち出し方向のばらつき（標準偏差・度） */
  dirSigmaDeg: number;
  /** 打ち出し高さ（角度）のばらつき（標準偏差・度） */
  launchSigmaDeg: number;
  /** 方向以前の大きなミス（チョロ、ダフリなど）の割合 */
  mishitRate: number;
}

/** スコア帯別のばらつき。平均スコアが良いほど小さい、という初期仮定のみを置いた仮の値。 */
export const BAND_PARAMS: Record<ScoreBand, BandParams> = {
  70: { dirSigmaDeg: 2.5, launchSigmaDeg: 2.5, mishitRate: 0.03 },
  80: { dirSigmaDeg: 3.5, launchSigmaDeg: 3.0, mishitRate: 0.05 },
  90: { dirSigmaDeg: 4.5, launchSigmaDeg: 3.5, mishitRate: 0.08 },
  100: { dirSigmaDeg: 6.0, launchSigmaDeg: 4.5, mishitRate: 0.12 },
  110: { dirSigmaDeg: 7.5, launchSigmaDeg: 5.5, mishitRate: 0.17 },
  120: { dirSigmaDeg: 9.0, launchSigmaDeg: 6.5, mishitRate: 0.22 },
};

export type LieId = 'good' | 'rough' | 'bare' | 'bad';

export interface LieParams {
  id: LieId;
  label: string;
  /** ばらつき（方向・高さ）に掛ける倍率 */
  sigmaMult: number;
  /** ミスの割合に掛ける倍率 */
  mishitMult: number;
}

export const LIES: LieParams[] = [
  { id: 'good', label: '芝の上', sigmaMult: 1.0, mishitMult: 1.0 },
  { id: 'rough', label: 'ラフ', sigmaMult: 1.15, mishitMult: 1.3 },
  { id: 'bare', label: '土・落ち葉', sigmaMult: 1.25, mishitMult: 1.5 },
  { id: 'bad', label: '深いラフ・根の近く', sigmaMult: 1.5, mishitMult: 2.0 },
];
export const DEFAULT_LIE: LieId = 'rough';

export type ClubId = 'wood' | 'long' | 'mid' | 'short';

export interface ClubParams {
  id: ClubId;
  label: string;
  /** 低く打ち出したときの打ち出し角の中心値（度） */
  launchDeg: number;
}

export const CLUBS: ClubParams[] = [
  { id: 'wood', label: 'UT・FW', launchDeg: 9 },
  { id: 'long', label: '5〜6I', launchDeg: 11 },
  { id: 'mid', label: '7〜8I', launchDeg: 15 },
  { id: 'short', label: '9I〜PW', launchDeg: 21 },
];

/** ボールから最初の木までの距離の選択肢（メートル）。null は「不明」。 */
export const DISTANCE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: '不明' },
  { value: 2, label: '約2m' },
  { value: 3, label: '約3m' },
  { value: 5, label: '約5m' },
  { value: 8, label: '約8m' },
  { value: 12, label: '12m以上' },
];

export type ClearanceId = 'knee' | 'waist' | 'head' | 'over';

export interface ClearanceParams {
  id: ClearanceId;
  label: string;
  /** 枝の下端の高さ（メートル） */
  heightM: number;
}

/** 枝の下端の高さ。ユーザーの目測を体の部位で選んでもらう。 */
export const CLEARANCES: ClearanceParams[] = [
  { id: 'knee', label: 'ひざ', heightM: 0.5 },
  { id: 'waist', label: '腰', heightM: 1.0 },
  { id: 'head', label: '頭', heightM: 1.6 },
  { id: 'over', label: '頭より上', heightM: 2.3 },
];
export const DEFAULT_CLEARANCE: ClearanceId = 'waist';

/** 写真の画角の仮定（35mm判換算の焦点距離）。機種やカメラモードで変わるため調整可能にする。 */
export const FOCAL_OPTIONS: { value: number; label: string }[] = [
  { value: 24, label: '広め（24mm相当）' },
  { value: 26, label: '標準（26mm相当）' },
  { value: 30, label: 'やや狭め（30mm相当）' },
  { value: 35, label: '狭め（35mm相当）' },
];
export const DEFAULT_FOCAL_EQ = 26;

export const GEOMETRY = {
  /** ゴルフボールの半径（m） */
  ballRadiusM: 0.02135,
  /** 手動指定のずれを見込んで、障害物の両側に取る余裕（度） */
  markToleranceDeg: 0.5,
  /** 距離が不明のとき、ボール幅の余裕を計算するために置く控えめな仮の距離（m） */
  unknownDistanceAssumedM: 2,
  /** 枝の下を通すときに、枝の下端から取る余裕（m） */
  heightSafetyM: 0.05,
  /** これより狭い隙間は「通過不可」として候補から外す（度） */
  minClearWidthDeg: 0.2,
  /** 狙う方向を探すときの刻み（度） */
  aimStepDeg: 0.1,
  /** ミスの割合の上限 */
  mishitCap: 0.6,
};

/** 難易度の色分けのしきい値（通過の推定確率）。検証後に調整する。 */
export const LEVEL_THRESHOLDS = {
  green: 0.7,
  yellow: 0.4,
};

export const MAX_ROUTES = 3;
