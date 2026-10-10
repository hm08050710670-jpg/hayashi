import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraErrorKind = 'denied' | 'notfound' | 'busy' | 'insecure' | 'unsupported' | 'unknown';

export type CameraState =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'error'; error: CameraErrorKind };

function classify(err: unknown): CameraErrorKind {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notfound';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy';
  return 'unknown';
}

/**
 * 背面カメラの起動・停止と、フレームの取り出しを行う。
 * grabFrame() は静止画の撮影に使うほか、第3段階で一定間隔のフレーム取得にもそのまま使える。
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let starting = false;

    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      if (starting) return;
      starting = true;
      try {
        await open();
      } finally {
        starting = false;
      }
    };

    const open = async () => {
      setState({ status: 'starting' });
      if (!window.isSecureContext) {
        setState({ status: 'error', error: 'insecure' });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ status: 'error', error: 'unsupported' });
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        // iPhone の Safari は、playsInline と muted がないとインライン再生できない。
        try {
          await video.play();
        } catch {
          /* 自動再生が止められても、映像が届けば下の待機で検出できる */
        }
        const deadline = Date.now() + 8000;
        while (!cancelled && video.videoWidth === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (cancelled) return;
        if (video.videoWidth === 0) {
          stop();
          setState({ status: 'error', error: 'busy' });
          return;
        }
        setState({ status: 'ready' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', error: classify(err) });
      }
    };

    // 画面が隠れている間はカメラを止めて、バッテリーの消費を抑える。
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!streamRef.current) void start();
    };

    void start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** 現在の映像を1枚、キャンバスに取り出す。長辺は maxSide 以下に縮小する。 */
  const grabFrame = useCallback((maxSide = 1600): HTMLCanvasElement | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  return { videoRef, state, retry, grabFrame };
}
