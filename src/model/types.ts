import type { ClearanceId, ClubId, LieId, ScoreBand } from './params';

/** 幹：全高さをふさぐ / 枝：下端より上をふさぐ / 地面：低い球をふさぐ */
export type ObstacleKind = 'trunk' | 'branch' | 'ground';

/**
 * 障害物。座標は写真に対する割合（0〜1、左上原点）。
 * source は指定元。'manual' は利用者の手動指定、'auto' は自動検出。
 */
export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 枝の下端の高さ（kind が 'branch' のときだけ使う） */
  clearance: ClearanceId;
  source: 'manual' | 'auto';
}

/** 解析した画像の大きさ（ピクセル） */
export interface FrameMeta {
  width: number;
  height: number;
}

export interface RouteInput {
  obstacles: Obstacle[];
  frame: FrameMeta;
  band: ScoreBand;
  lie: LieId;
  /** 使用予定クラブ。未選択は null */
  clubId: ClubId | null;
  /** ボールから最初の木までの距離（m）。不明は null */
  distanceM: number | null;
  /** 画角の仮定（35mm判換算の焦点距離） */
  focalEq: number;
}

export type Level = 'green' | 'yellow' | 'red';
export type BoundKind = 'obstacle' | 'edge';

export interface Route {
  id: string;
  /** 表示用の記号。左から順に A, B, C */
  letter: string;
  /** ok: 確率を計算できた / unknown: 情報不足で判定不能 */
  status: 'ok' | 'unknown';
  /** 余裕を引いたあとの通過可能な範囲（度。写真の中心が0、右が正） */
  clearLeftDeg: number;
  clearRightDeg: number;
  widthDeg: number;
  leftBound: BoundKind;
  rightBound: BoundKind;
  /** 隙間に枝（高さ制限）がかかっているか */
  hasOverhead: boolean;
  /** かかっている枝のうち最も低い下端の高さ（m） */
  minClearanceM: number | null;
  /** 狙う方向（度）。判定不能のときは隙間の中央 */
  aimDeg: number;
  /** 木の間を通過する推定確率（0〜1）。判定不能のときは null */
  probability: number | null;
  level: Level | null;
  unknownReason: null | 'distance' | 'club' | 'both';
  /** 計算できた候補の中で最も確率が高い */
  isBest: boolean;
}

export interface RouteResult {
  /** insufficient: データ不足で全体が判定不能 */
  status: 'ok' | 'insufficient';
  insufficientReason: null | 'no_obstacles' | 'bad_frame';
  /** 表示する候補（最大3件、左から順） */
  routes: Route[];
  /** 表示件数を超えたため省いた候補の数 */
  hiddenCount: number;
  /** 余裕を引くと通れないと判定した隙間の数 */
  blockedCount: number;
  /** 写真の横方向の画角（度、仮定にもとづく） */
  hfovDeg: number;
  dirSigmaDeg: number;
  launchSigmaDeg: number;
  mishitRate: number;
  /** 障害物の両側に取った余裕（度） */
  marginDeg: number;
  /** 距離が不明のため、控えめな仮の距離で余裕を計算した */
  distanceAssumed: boolean;
}
