import type { Level, Route, RouteResult } from './types';

export function directionLabel(aimDeg: number): string {
  if (aimDeg < -8) return '左前方';
  if (aimDeg > 8) return '右前方';
  return '正面';
}

/** 「左へ12°」のように、写真の中心からの向きを表す。 */
export function aimText(aimDeg: number): string {
  const rounded = Math.round(Math.abs(aimDeg));
  if (rounded === 0) return '写真の中心';
  return `中心から${aimDeg < 0 ? '左' : '右'}へ約${rounded}°`;
}

export const LEVEL_TEXT: Record<Level, string> = {
  green: '比較的通しやすい',
  yellow: '注意が必要',
  red: '難易度が高い',
};

/**
 * おすすめ度。色に頼らず記号と文字で示す。
 * 写真の端にかかる隙間は、その先を確認できていないため、確率が高くても「◎」にはしない。
 */
export function recommendText(route: Route): string {
  if (route.status !== 'ok' || route.level === null) return '評価なし';
  const touchesEdge = route.leftBound === 'edge' || route.rightBound === 'edge';
  const mark = route.level === 'green' ? (touchesEdge ? '○' : '◎') : route.level === 'yellow' ? '○' : '△';
  return route.isBest ? `${mark} この中では最有力` : mark;
}

export function percentText(probability: number): string {
  return `${Math.round(probability * 100)}`;
}

export function routeDescription(route: Route, result: Pick<RouteResult, 'dirSigmaDeg'>): string {
  const parts: string[] = [];
  if (route.status === 'unknown') {
    const need =
      route.unknownReason === 'distance'
        ? '最初の木までの距離'
        : route.unknownReason === 'club'
          ? '使用クラブ'
          : '最初の木までの距離と使用クラブ';
    parts.push(`枝がかかっています。枝の下を通せるかを計算するには、${need}の入力が必要です。`);
  } else {
    const ratio = route.widthDeg / 2 / result.dirSigmaDeg;
    if (ratio >= 1.5) parts.push('通過幅に余裕があります。');
    else if (ratio >= 0.8) parts.push('隙間はありますが、方向のずれに注意が必要です。');
    else parts.push('木の間が狭く、方向の正確性が必要です。');
    if (route.hasOverhead) parts.push('枝の下を通す低い球が必要です。');
  }
  if (route.leftBound === 'edge' || route.rightBound === 'edge') {
    parts.push('写真の端にかかっています。写っていない範囲は未確認です。');
  }
  return parts.join('');
}
