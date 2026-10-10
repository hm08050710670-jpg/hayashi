import { degToX } from '../model/geometry';
import type { FrameMeta, Route } from '../model/types';
import type { StageSize } from './PhotoStage';

interface Props {
  route: Route;
  /** 打ち出し方向のばらつき（標準偏差・度） */
  sigmaDeg: number;
  frame: FrameMeta;
  focalEq: number;
  size: StageSize;
  /** 扇の付け根の高さ（表示の高さに対する割合） */
  originY: number;
  /** 扇の先（木の間を通過する位置）の高さ（表示の高さに対する割合） */
  gateY: number;
}

const SLICES = 30;
/** 扇に描く範囲。±2.5σ で、ショットのほぼすべて（約99%）が入る */
const SPREAD = 2.5;

/**
 * 「ショットのばらつきの扇」を映像に重ねる。
 *
 * 狙った方向を中心に、ショットが散らばる範囲を扇形で描く。扇の濃さは、その方向へ飛ぶ頻度を表す
 * （中心ほど濃い）。木の間を通る方向は緑、障害物に当たる方向は赤で塗るので、
 * 「扇のうち緑の部分がどれだけあるか」が、そのまま通過のしやすさになる。
 * 計算に使っている方向のばらつき（正規分布）をそのまま図にしたもので、飾りではない。
 */
export function FanLayer({ route, sigmaDeg, frame, focalEq, size, originY, gateY }: Props) {
  const origin = { x: size.w / 2, y: size.h * originY };
  const y = size.h * gateY;
  const toX = (deg: number) => degToX(deg, frame, focalEq) * size.w;

  const slices = [];
  for (let i = 0; i < SLICES; i++) {
    const from = route.aimDeg + sigmaDeg * SPREAD * ((2 * i) / SLICES - 1);
    const to = route.aimDeg + sigmaDeg * SPREAD * ((2 * (i + 1)) / SLICES - 1);
    const mid = (from + to) / 2;
    const distance = (mid - route.aimDeg) / sigmaDeg;
    const weight = Math.exp(-0.5 * distance * distance);
    const passes = mid >= route.clearLeftDeg && mid <= route.clearRightDeg;
    slices.push(
      <polygon
        key={i}
        className={passes ? 'fan-pass' : 'fan-hit'}
        points={`${origin.x},${origin.y} ${toX(from)},${y} ${toX(to)},${y}`}
        opacity={0.12 + 0.6 * weight}
      />,
    );
  }

  const left = toX(route.clearLeftDeg);
  const right = toX(route.clearRightDeg);
  const aim = toX(route.aimDeg);
  const angle = (Math.atan2(y - origin.y, aim - origin.x) * 180) / Math.PI;
  const cap = 9;

  return (
    <g className="fan">
      {slices}
      {/* 通過できる幅（木の間）を示す枠 */}
      <path className="gate-outline" d={`M${left},${y - cap} V${y + cap} M${left},${y} H${right} M${right},${y - cap} V${y + cap}`} />
      <path className="gate" d={`M${left},${y - cap} V${y + cap} M${left},${y} H${right} M${right},${y - cap} V${y + cap}`} />
      {/* 狙う方向 */}
      <line className="aim-outline" x1={origin.x} y1={origin.y} x2={aim} y2={y} />
      <line className="aim-line" x1={origin.x} y1={origin.y} x2={aim} y2={y} />
      <polygon className="aim-head" points="0,0 -13,-7 -13,7" transform={`translate(${aim} ${y}) rotate(${angle})`} />
      <g transform={`translate(${Math.min(size.w - 16, Math.max(16, aim))} ${y - cap - 16})`}>
        <circle className="gate-badge" r="13" />
        <text className="gate-badge-text" textAnchor="middle" y="5.5">
          {route.letter}
        </text>
      </g>
    </g>
  );
}
