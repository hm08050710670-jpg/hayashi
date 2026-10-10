import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import type { LiveStatus } from '../analysis/live';
import { OPENING_PARAMS } from '../analysis/openingDetector';
import { useCamera, type CameraErrorKind } from '../camera/useCamera';
import { useLiveAnalysis, type LiveMode } from '../camera/useLiveAnalysis';
import { FanLayer } from '../components/FanLayer';
import { GearIcon, ImageIcon } from '../components/Icons';
import { ObstacleLayer } from '../components/ObstacleLayer';
import { RouteLayer } from '../components/RouteLayer';
import { canvasToPhoto, fileToPhoto } from '../image/process';
import { LEVEL_TEXT, directionLabel, percentText, recommendText, routeDescription } from '../model/describe';
import { MODEL_LABEL, type ScoreBand } from '../model/params';
import type { Photo } from '../types';

interface Props {
  band: ScoreBand;
  focalEq: number;
  /** リアルタイム解析の目標の更新頻度（1秒あたりの回数） */
  liveRate: number;
  /** カメラが映ったら、リアルタイム解析を自動で始めるか（「終了」を押すと、その起動中は自動で始めない） */
  liveWanted: boolean;
  onLiveWanted: (wanted: boolean) => void;
  /** 今回の起動で、前方の安全を確認済みか */
  safetyConfirmed: boolean;
  onSafetyConfirmed: () => void;
  onPhoto: (photo: Photo) => void;
  onChangeScore: () => void;
  onOpenSettings: () => void;
}

/** 扇と矢印の付け根の高さ（映像の高さに対する割合）。帯の少し下に置く */
const FAN_ORIGIN_Y = Math.min(1, OPENING_PARAMS.bandBottom + 0.16);

/** 解析の状態ごとの表示。数値を出せない状態では、理由と次にすることを伝える。 */
const LIVE_STATUS_TEXT: Record<LiveStatus | 'idle', string> = {
  idle: '解析中…',
  confirming: '障害物を確認中…',
  moving: 'カメラをゆっくり動かしてください',
  too_dark: '暗すぎて判定できません',
  no_backdrop: '判定不能：奥が明るく見える方向に向けてください',
  low_contrast: '判定不能：奥が明るく見える方向に向けてください',
  bad_frame: '映像を取得できません',
  ok: '',
};

const CAMERA_ERRORS: Record<CameraErrorKind, { title: string; body: string }> = {
  denied: {
    title: 'カメラの使用が許可されていません',
    body: 'iPhone：「設定」アプリで「Safari」→「カメラ」を「確認」または「許可」にして、このページを開き直してください（iOS 18 以降は「設定」→「アプリ」→「Safari」）。Android：アドレスバーの左のアイコン→「権限」→「カメラ」を許可してください。',
  },
  notfound: {
    title: 'カメラが見つかりません',
    body: 'この端末で使えるカメラを検出できませんでした。',
  },
  busy: {
    title: 'カメラを起動できませんでした',
    body: 'ほかのアプリがカメラを使用中の可能性があります。ほかのアプリを閉じてから、もう一度お試しください。',
  },
  insecure: {
    title: '安全な接続（HTTPS）が必要です',
    body: 'カメラは https:// で始まるアドレスで開いたときだけ使えます。',
  },
  unsupported: {
    title: 'このブラウザーではカメラを使えません',
    body: 'iPhone は Safari、Android は Chrome の最新版でお試しください。',
  },
  unknown: {
    title: 'カメラを起動できませんでした',
    body: '時間をおいて、もう一度お試しください。',
  },
};

/** カメラのプレビューを使えない場所（1ファイルの試用ページ）に置かれているか */
const IS_TRIAL = Boolean(import.meta.env.VITE_TRIAL);

const TRIAL_ERROR = {
  title: 'この試用ページではカメラのプレビューを使えません',
  body: '下の「画像を読み込む」を押すと、その場で写真を撮るか、保存済みの写真を選んで解析できます。カメラのプレビューは、HTTPSで公開した本番用ファイルで動作します。',
};

export function Capture({
  band,
  focalEq,
  liveRate,
  liveWanted,
  onLiveWanted,
  safetyConfirmed,
  onSafetyConfirmed,
  onPhoto,
  onChangeScore,
  onOpenSettings,
}: Props) {
  const camera = useCamera();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<LiveMode>('off');
  const [askSafety, setAskSafety] = useState(false);
  /** 利用者が選んだルート（同じ隙間を追っている間は変わらない id で覚える） */
  const [pickedId, setPickedId] = useState<string | null>(null);

  const ready = camera.state.status === 'ready';
  const error =
    camera.state.status === 'error' ? (IS_TRIAL ? TRIAL_ERROR : CAMERA_ERRORS[camera.state.error]) : null;

  // カメラが映ったら、リアルタイム解析を自動で始める。
  // 安全確認は起動ごとに1回だけ行い、確認が済むまでは始めない。
  useEffect(() => {
    if (!ready || !liveWanted) return;
    if (safetyConfirmed) setMode((current) => (current === 'off' ? 'on' : current));
    else setAskSafety(true);
  }, [ready, liveWanted, safetyConfirmed]);

  const startLive = () => {
    onLiveWanted(true);
    if (safetyConfirmed) setMode('on');
    else setAskSafety(true);
  };

  // カメラが使えなくなったら、解析も止める。
  const liveMode: LiveMode = ready ? mode : 'off';
  const live = useLiveAnalysis({ mode: liveMode, grabPixels: camera.grabPixels, band, focalEq, targetRate: liveRate });

  // 映像を切り取らずに枠へ収めたときの表示サイズ。重ね描きをこの大きさに合わせる。
  const finderRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const frameW = camera.frame?.width ?? 0;
  const frameH = camera.frame?.height ?? 0;
  useLayoutEffect(() => {
    const box = finderRef.current;
    if (!box || !frameW || !frameH) {
      setFit(null);
      return;
    }
    const update = () => {
      const scale = Math.min(box.clientWidth / frameW, box.clientHeight / frameH);
      const w = Math.floor(frameW * scale);
      const h = Math.floor(frameH * scale);
      setFit((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [frameW, frameH]);

  const shoot = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const canvas = camera.grabFrame();
      if (!canvas) throw new Error('no frame');
      onPhoto(await canvasToPhoto(canvas, 'camera'));
    } catch {
      setMessage('撮影できませんでした。もう一度シャッターを押してください。');
      setBusy(false);
    }
  };

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      onPhoto(await fileToPhoto(file));
    } catch {
      setMessage('この画像は読み込めませんでした。JPEG または PNG の写真を選んでください。');
      setBusy(false);
    }
  };

  const { view } = live;
  const liveOn = liveMode !== 'off';
  // 古くなった結果は、最新のように見せない（一時停止中は、停止した時点の結果として表示する）。
  const showResult = liveOn && view.status === 'ok' && !live.stale;
  const routes = showResult ? view.routes : [];
  const obstacles = showResult ? view.obstacles : [];
  // 選んだルートがあればそれを、なければ主役のルートを大きく表示する。
  const selected =
    routes.find((r) => r.id === pickedId) ?? routes.find((r) => r.id === view.leaderId) ?? routes[0] ?? null;

  // 選んだルートの数値を、画面の上部に大きく表示する。
  const hero =
    selected && selected.status === 'ok' && selected.probability !== null && selected.level
      ? {
          route: selected,
          level: selected.level,
          percent: percentText(selected.probability),
          // 「10球打って何球通るか」に言い換える
          balls: Math.round(selected.probability * 10),
        }
      : null;

  let statusText = LIVE_STATUS_TEXT[view.status];
  if (liveMode === 'paused') statusText = '一時停止中：表示は停止した時点の結果です';
  else if (live.stale) statusText = '解析が止まっています。表示を消しました';
  else if (view.status === 'ok') {
    if (view.result?.status === 'insufficient') statusText = '判定に必要な情報が不足しています（障害物が写っていません）';
    else if (routes.length === 0) statusText = '見通せる方向が見つかりません';
    else statusText = `毎秒約${Math.max(1, Math.round(view.ratePerSec))}回更新（表示は少し遅れて反映）`;
  }

  return (
    <div className="screen capture">
      <div className="viewfinder" ref={finderRef}>
        <div className="video-fit" style={fit ? { width: fit.w, height: fit.h } : undefined}>
          <video ref={camera.videoRef} playsInline muted autoPlay className={ready ? '' : 'is-hidden'} />
          {liveOn && fit ? (
            <svg
              className={`live-layer${liveMode === 'paused' ? ' is-paused' : ''}`}
              width={fit.w}
              height={fit.h}
              viewBox={`0 0 ${fit.w} ${fit.h}`}
            >
              <line className="band-line" x1="0" x2={fit.w} y1={OPENING_PARAMS.bandTop * fit.h} y2={OPENING_PARAMS.bandTop * fit.h} />
              <line className="band-line" x1="0" x2={fit.w} y1={OPENING_PARAMS.bandBottom * fit.h} y2={OPENING_PARAMS.bandBottom * fit.h} />
              <text className="band-label" x="6" y={OPENING_PARAMS.bandBottom * fit.h + 14}>
                判定する高さ（水平に構える）
              </text>
              {view.frame ? (
                <>
                  <ObstacleLayer obstacles={obstacles} size={fit} dim />
                  {/* 選んでいないルートは、位置と数値だけを控えめに示す */}
                  <RouteLayer
                    routes={routes.filter((r) => r.id !== selected?.id)}
                    obstacles={obstacles}
                    frame={view.frame}
                    focalEq={focalEq}
                    size={fit}
                    selectedId={null}
                    originY={FAN_ORIGIN_Y}
                    compact
                    onSelect={setPickedId}
                  />
                  {/* 選んだルートには、ショットのばらつきの扇を重ねる */}
                  {selected && selected.status === 'ok' && view.result ? (
                    <FanLayer
                      route={selected}
                      sigmaDeg={view.result.dirSigmaDeg}
                      frame={view.frame}
                      focalEq={focalEq}
                      size={fit}
                      originY={FAN_ORIGIN_Y}
                      gateY={(OPENING_PARAMS.bandTop + OPENING_PARAMS.bandBottom) / 2}
                    />
                  ) : null}
                </>
              ) : null}
            </svg>
          ) : null}
        </div>

        {hero ? (
          <div className={`hud ${hero.level}`}>
            <p className="hud-caption">
              推定成功率<span>（{MODEL_LABEL}）</span>
            </p>
            <div className="hud-main">
              <span className="hud-pct num">
                {hero.percent}
                <small>%</small>
              </span>
              <span className="hud-side">
                <span className="hud-route">
                  ルート{hero.route.letter}：{directionLabel(hero.route.aimDeg)}
                </span>
                <span className="hud-level">難易度：{LEVEL_TEXT[hero.level]}</span>
                <span className="hud-recommend">おすすめ度：{recommendText(hero.route)}</span>
              </span>
            </div>
            <div className="hud-balls">
              <span className="balls" role="img" aria-label={`10球のうち${hero.balls}球`}>
                {Array.from({ length: 10 }, (_, i) => (
                  <i key={i} className={i < hero.balls ? 'ball in' : 'ball'} />
                ))}
              </span>
              <span className="hud-balls-text">
                {hero.balls === 0 ? '10球打って 1球未満' : `10球打って 約${hero.balls}球`}
              </span>
            </div>
          </div>
        ) : (
          <div className="guide">
            <p className="guide-main">ボールの近くから、脱出したい方向にカメラを向けてください</p>
            <p className="guide-sub">
              {liveOn
                ? 'スマートフォンをゆっくり動かすと、周囲の木を確認しやすくなります'
                : '周囲に人やカートがいないことを確認してから撮影してください'}
            </p>
          </div>
        )}

        {camera.state.status === 'starting' ? (
          <div className="viewfinder-msg" role="status">
            <p className="msg-title">カメラを起動しています</p>
          </div>
        ) : null}

        {error ? (
          <div className="viewfinder-msg" role="alert">
            <p className="msg-title">{error.title}</p>
            <p className="msg-body">{error.body}</p>
            {IS_TRIAL ? null : (
              <>
                <p className="msg-body">カメラを使えない場合は、下の「画像を読み込む」から写真を選んで解析できます。</p>
                <button type="button" className="btn ghost" onClick={camera.retry}>
                  カメラをもう一度起動する
                </button>
              </>
            )}
          </div>
        ) : null}

        <div className="viewfinder-foot">
          {message ? (
            <p className="banner bad" role="alert">
              {message}
            </p>
          ) : null}

          {liveOn ? (
            <div className="live-panel">
              <p className="live-status" role="status">
                {statusText}
              </p>
              {routes.length > 1 ? (
                <div className="live-routes" role="group" aria-label="候補ルート">
                  {routes.map((route) => (
                    <button
                      key={route.letter}
                      type="button"
                      className={`live-route ${route.level ?? 'unknown'}`}
                      aria-pressed={route.letter === selected?.letter}
                      onClick={() => setPickedId(route.id)}
                    >
                      <span className="live-route-letter num">{route.letter}</span>
                      <span className="live-route-pct num">
                        {route.probability !== null ? `${percentText(route.probability)}%` : '判定不能'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {hero && view.result ? (
                <>
                  <p className="live-detail">{routeDescription(hero.route, view.result)}</p>
                  <p className="live-legend">
                    <span>
                      <i className="swatch pass" />
                      通る方向
                    </span>
                    <span>
                      <i className="swatch hit" />
                      当たる方向
                    </span>
                    <span>扇は、あなたのショットのばらつき</span>
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          {ready ? (
            <div className="live-controls">
              {liveMode === 'off' ? (
                <button type="button" className="btn small primary" onClick={startLive}>
                  リアルタイム解析を開始（試験版）
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setMode(liveMode === 'on' ? 'paused' : 'on')}
                  >
                    {liveMode === 'on' ? '解析を一時停止' : '解析を再開'}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      live.reset();
                      setPickedId(null);
                      setMode('on');
                    }}
                  >
                    再解析
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => {
                      setMode('off');
                      onLiveWanted(false);
                    }}
                  >
                    終了
                  </button>
                </>
              )}
            </div>
          ) : null}

          {liveOn ? (
            <p className="mode-note">
              斜線の範囲は「障害物または未確認」です。画面に映っていない範囲の障害物は判定できません
            </p>
          ) : null}
        </div>
      </div>

      <footer className="camera-bar">
        <label className={`bar-btn${busy ? ' is-disabled' : ''}`}>
          <input
            id="photo-file"
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={pickFile}
            disabled={busy}
          />
          <ImageIcon />
          <span>画像を読み込む</span>
        </label>

        <button
          type="button"
          className="shutter"
          onClick={shoot}
          disabled={!ready || busy}
          aria-label="静止画を撮影"
        >
          <span />
        </button>

        <div className="bar-pair">
          <button type="button" className="bar-btn" onClick={onChangeScore} aria-label={`スコア変更（現在 ${band}台）`}>
            <span className="num bar-num">{band}台</span>
            <span>スコア変更</span>
          </button>
          <button type="button" className="bar-btn" onClick={onOpenSettings}>
            <GearIcon />
            <span>設定</span>
          </button>
        </div>
      </footer>

      {askSafety && ready ? (
        <div className="sheet-backdrop">
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="live-safety-title">
            <h2 id="live-safety-title">前方の安全を確認してください</h2>
            <p>
              カメラを向ける方向とその周囲に、人、カート、ほかのプレーヤー、コース管理車両がいないことを、自分の目で確認してください。人やカートの自動検出は行いません。
            </p>
            <p>
              リアルタイム解析は試験版です。スマートフォンを立てて水平に構え、黄色い点線の帯を、木の間から奥の明るい場所が見える高さに合わせてください。その帯の中で、奥が見通せる方向を探します。
            </p>
            <p>
              斜線の範囲は「障害物または未確認」です。実際の木と合っているかを必ず目で確認し、合っていないときは結果を使わないでください。床や地面に向けた場合や、屋内では正しく判定できません。
            </p>
            <div className="stack">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setAskSafety(false);
                  setMessage(null);
                  onSafetyConfirmed();
                  onLiveWanted(true);
                  setMode('on');
                }}
              >
                誰もいないことを確認した
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAskSafety(false);
                  onLiveWanted(false);
                  setMessage('安全を確認できるまで、リアルタイム解析は開始しません。');
                }}
              >
                人がいる・確認できない
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setAskSafety(false);
                  onLiveWanted(false);
                }}
              >
                解析せずに閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
