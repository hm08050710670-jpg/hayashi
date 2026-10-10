import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_PARAMS, LiveAnalyzer, smoothRoutes, type LiveStatus } from '../analysis/live';
import { OPENING_PARAMS, detectOpenings, type BlockedSpan } from '../analysis/openingDetector';
import { DEFAULT_CLEARANCE, DEFAULT_LIE, type ScoreBand } from '../model/params';
import { computeRoutes } from '../model/routes';
import type { Obstacle, Route, RouteResult } from '../model/types';

export type LiveMode = 'off' | 'on' | 'paused';

export interface LiveView {
  /** idle: まだ1回も解析していない */
  status: LiveStatus | 'idle';
  obstacles: Obstacle[];
  routes: Route[];
  result: RouteResult | null;
  /** 解析した画像の縦横比を保った大きさ（角度の換算に使う） */
  frame: { width: number; height: number } | null;
  /** 実際の更新頻度（1秒あたりの回数） */
  ratePerSec: number;
  /** この結果のもとになった映像を取得した時刻（performance.now()） */
  capturedAt: number;
}

const IDLE: LiveView = {
  status: 'idle',
  obstacles: [],
  routes: [],
  result: null,
  frame: null,
  ratePerSec: 0,
  capturedAt: 0,
};

/** 見通せない範囲を、ルート計算に渡す障害物の形にする。帯の高さの矩形として表示する。 */
export function spansToObstacles(spans: BlockedSpan[], bandTop: number, bandBottom: number): Obstacle[] {
  return spans.map((span, i) => ({
    id: `auto-${i}`,
    kind: 'trunk',
    x: span.x,
    y: bandTop,
    w: span.w,
    h: bandBottom - bandTop,
    clearance: DEFAULT_CLEARANCE,
    source: 'auto',
  }));
}

interface Options {
  mode: LiveMode;
  /** カメラの映像を解析用に縮小して取り出す関数（useCamera の grabPixels） */
  grabPixels: (targetWidth: number) => ImageData | null;
  band: ScoreBand;
  focalEq: number;
  /** 目標の更新頻度（1秒あたりの回数）。処理が追いつかない端末では自動で下げる */
  targetRate: number;
}

/**
 * カメラの映像を一定間隔で解析し、障害物・ルート・推定確率を更新する。
 * 解析は端末内だけで行い、映像は外部に送信しない。
 */
export function useLiveAnalysis({ mode, grabPixels, band, focalEq, targetRate }: Options) {
  const [view, setView] = useState<LiveView>(IDLE);
  const [stale, setStale] = useState(false);
  const analyzer = useRef(new LiveAnalyzer());
  const previousRoutes = useRef<Route[]>([]);
  // 解析の途中で条件が変わっても、次の回から新しい条件を使えるように最新の値を持っておく。
  const latest = useRef({ band, focalEq, grabPixels });
  latest.current = { band, focalEq, grabPixels };

  const reset = useCallback(() => {
    analyzer.current.reset();
    previousRoutes.current = [];
    setView(IDLE);
    setStale(false);
  }, []);

  useEffect(() => {
    if (mode === 'off') reset();
  }, [mode, reset]);

  useEffect(() => {
    if (mode !== 'on') return;
    let timer = 0;
    let stopped = false;
    let lastTick = 0;
    let rate = 0;
    const wanted = 1000 / Math.max(1, targetRate);

    const tick = () => {
      if (stopped) return;
      const started = performance.now();
      const { band: curBand, focalEq: curFocal, grabPixels: grab } = latest.current;
      const pixels = grab(OPENING_PARAMS.analysisWidth);

      if (pixels) {
        const detection = detectOpenings(pixels);
        const step = analyzer.current.push(detection);
        const frame = { width: pixels.width, height: pixels.height };
        let obstacles: Obstacle[] = [];
        let routes: Route[] = [];
        let result: RouteResult | null = null;
        if (step.status === 'ok') {
          obstacles = spansToObstacles(step.spans, detection.bandTop, detection.bandBottom);
          result = computeRoutes({
            obstacles,
            frame,
            band: curBand,
            lie: DEFAULT_LIE,
            clubId: null,
            distanceM: null,
            focalEq: curFocal,
          });
          routes = smoothRoutes(previousRoutes.current, result.routes);
        }
        previousRoutes.current = routes;

        if (lastTick > 0) {
          const instant = 1000 / Math.max(1, started - lastTick);
          rate = rate === 0 ? instant : rate * 0.7 + instant * 0.3;
        }
        lastTick = started;
        setView({ status: step.status, obstacles, routes, result, frame, ratePerSec: rate, capturedAt: started });
        setStale(false);
      }

      // 処理が重い端末では、解析に使う時間が半分を超えないよう間隔を広げる。
      const spent = performance.now() - started;
      const interval = Math.max(wanted, spent * 2);
      timer = window.setTimeout(tick, Math.max(20, interval - spent));
    };

    // 映像が届かなくなったら、古い結果を最新として表示しないようにする。
    const watchdog = window.setInterval(() => {
      if (lastTick > 0 && performance.now() - lastTick > LIVE_PARAMS.staleMs) setStale(true);
    }, 400);

    timer = window.setTimeout(tick, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(watchdog);
    };
  }, [mode, targetRate]);

  return { view, stale: mode === 'on' && stale, reset };
}
