import { CLEARANCES } from '../model/params';
import type { Obstacle, ObstacleKind } from '../model/types';
import type { StageSize } from './PhotoStage';

export const KIND_LABEL: Record<ObstacleKind, string> = {
  trunk: '幹',
  branch: '枝',
  ground: '地面',
};

export function obstacleTag(o: Obstacle): string {
  if (o.kind !== 'branch') return KIND_LABEL[o.kind];
  const c = CLEARANCES.find((x) => x.id === o.clearance);
  return `枝 ${c ? c.label : ''}`;
}

interface Props {
  obstacles: Obstacle[];
  size: StageSize;
  selectedId?: string | null;
  /** 結果画面では控えめに表示する */
  dim?: boolean;
}

/**
 * 障害物の矩形を描く。種類は色ではなく、線の種類・塗り・文字で区別する。
 * 幹：斜線の塗り＋実線 / 枝：破線 / 地面：点線
 */
export function ObstacleLayer({ obstacles, size, selectedId, dim }: Props) {
  return (
    <g className={dim ? 'obstacles dim' : 'obstacles'}>
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(0,0,0,0.45)" />
          <rect width="2.5" height="8" fill="rgba(255,255,255,0.55)" />
        </pattern>
      </defs>
      {obstacles.map((o) => {
        const x = o.x * size.w;
        const y = o.y * size.h;
        const w = o.w * size.w;
        const h = o.h * size.h;
        const tag = obstacleTag(o);
        const tagW = tag.length * 12 + 10;
        const tagY = y >= 20 ? y - 20 : y + 2;
        return (
          <g key={o.id} className={`obstacle ${o.kind}${o.id === selectedId ? ' selected' : ''}`}>
            <rect className="obstacle-box" x={x} y={y} width={w} height={h} rx="3" />
            {dim ? null : (
              <g>
                <rect className="obstacle-tag-bg" x={x} y={tagY} width={tagW} height="18" rx="3" />
                <text className="obstacle-tag" x={x + 5} y={tagY + 13}>
                  {tag}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
