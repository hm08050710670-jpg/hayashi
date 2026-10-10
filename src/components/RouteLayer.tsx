import { percentText } from '../model/describe';
import { routeToImageX } from '../model/routes';
import type { FrameMeta, Obstacle, Route } from '../model/types';
import type { StageSize } from './PhotoStage';

interface Props {
  routes: Route[];
  obstacles: Obstacle[];
  frame: FrameMeta;
  focalEq: number;
  size: StageSize;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 写真の上にルートを描く。
 * 写真の下端中央（ボール側）から、隙間の通過できる範囲へ向かう帯と、狙う方向の矢印を重ねる。
 * 色だけに頼らないよう、ラベルに記号と数値（または「判定不能」）を必ず入れる。
 */
export function RouteLayer({ routes, obstacles, frame, focalEq, size, selectedId, onSelect }: Props) {
  const blockers = obstacles.filter((o) => o.kind !== 'branch');
  const meanY = blockers.length
    ? blockers.reduce((sum, o) => sum + o.y + o.h * 0.5, 0) / blockers.length
    : 0.5;
  const tipY = Math.min(0.72, Math.max(0.3, meanY)) * size.h;
  const origin = { x: size.w / 2, y: size.h };

  // 選択中のルートを最後に描いて、いちばん手前に出す。
  const ordered = [...routes].sort((a, b) => Number(a.id === selectedId) - Number(b.id === selectedId));

  return (
    <g className="routes">
      {ordered.map((route) => {
        const index = routes.indexOf(route);
        const xs = routeToImageX(route, { frame, focalEq });
        const left = xs.left * size.w;
        const right = xs.right * size.w;
        const aim = xs.aim * size.w;
        const selected = route.id === selectedId;
        const level = route.status === 'ok' && route.level ? route.level : 'unknown';

        const text =
          route.status === 'ok' && route.probability !== null
            ? `${route.letter}  ${percentText(route.probability)}%`
            : `${route.letter}  判定不能`;
        const pillW = route.status === 'ok' ? 78 : 104;
        const pillH = 30;
        const pillX = Math.min(size.w - pillW - 4, Math.max(4, aim - pillW / 2));
        const pillY = Math.max(4, tipY - pillH - 12 - (index % 2) * (pillH + 6));

        // 矢じりは、矢印の向きに合わせて回転させる。
        const angle = (Math.atan2(tipY - origin.y, aim - origin.x) * 180) / Math.PI;

        return (
          <g
            key={route.id}
            className={`route ${level}${selected ? ' selected' : ''}`}
            onClick={() => onSelect(route.id)}
            role="button"
            aria-label={`ルート${route.letter}を選択`}
          >
            <polygon className="route-band" points={`${origin.x},${origin.y} ${left},${tipY} ${right},${tipY}`} />
            <line className="route-hit" x1={origin.x} y1={origin.y} x2={aim} y2={tipY} />
            <line className="route-line" x1={origin.x} y1={origin.y} x2={aim} y2={tipY} />
            <polygon
              className="route-head"
              points="0,0 -16,-9 -16,9"
              transform={`translate(${aim} ${tipY}) rotate(${angle})`}
            />
            <line className="route-leader" x1={aim} y1={tipY} x2={pillX + pillW / 2} y2={pillY + pillH} />
            <rect className="route-pill" x={pillX} y={pillY} width={pillW} height={pillH} rx="6" />
            <text className="route-text" x={pillX + pillW / 2} y={pillY + 21} textAnchor="middle">
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
