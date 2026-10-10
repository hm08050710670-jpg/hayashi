import { useLayoutEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import type { FrameMeta } from '../model/types';

export interface StageSize {
  w: number;
  h: number;
}

interface PhotoStageProps {
  photo: FrameMeta & { url: string };
  /** 写真の上に重ねる図形。表示サイズ（CSSピクセル）を受け取って描く */
  overlay?: (size: StageSize) => ReactNode;
  svgProps?: SVGProps<SVGSVGElement>;
  label: string;
}

/**
 * 写真を、切り取らずに枠いっぱいへ収めて表示し、その真上に同じ大きさのSVGを重ねる。
 * 写真上の位置は「割合（0〜1）× 表示サイズ」で扱うので、端末の画面サイズに依存しない。
 */
export function PhotoStage({ photo, overlay, svgProps, label }: PhotoStageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<StageSize>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      const scale = Math.min(box.clientWidth / photo.width, box.clientHeight / photo.height);
      const w = Math.max(0, Math.floor(photo.width * scale));
      const h = Math.max(0, Math.floor(photo.height * scale));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [photo.width, photo.height]);

  return (
    <div className="stage" ref={boxRef}>
      <div className="stage-fit" style={{ width: size.w, height: size.h }}>
        <img src={photo.url} alt={label} draggable={false} />
        {overlay && size.w > 0 ? (
          <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} {...svgProps}>
            {overlay(size)}
          </svg>
        ) : null}
      </div>
    </div>
  );
}
