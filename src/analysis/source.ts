import type { FrameMeta, Obstacle } from '../model/types';

/**
 * 障害物の検出元の共通インターフェース。
 *
 * 第1段階ではユーザーの手動指定だけを使うため、このインターフェースの実装はまだない
 * （ダミーの検出器を置くと、未実装の機能が動いているように見えるため置かない）。
 *
 * 第2段階：静止画を受け取って Obstacle[] を返す検出器を、この形で実装する。
 * 第3段階：useCamera の grabFrame() で一定間隔に取り出したフレームを同じ検出器に渡し、
 *          capturedAt を見て古い結果を最新として表示しないようにする。
 * どちらの段階でも、検出結果は computeRoutes() にそのまま渡せる。
 */
export interface ObstacleDetection {
  obstacles: Obstacle[];
  frame: FrameMeta;
  /** 解析したフレームを取得した時刻（ms） */
  capturedAt: number;
  /** 検出の確信度（0〜1）。通過の推定確率には使わない */
  confidence: number | null;
}

export interface ObstacleSource {
  readonly id: string;
  readonly label: string;
  detect(frame: HTMLCanvasElement): Promise<ObstacleDetection>;
}
