import { useState, type ChangeEvent } from 'react';
import { useCamera, type CameraErrorKind } from '../camera/useCamera';
import { GearIcon, ImageIcon } from '../components/Icons';
import { canvasToPhoto, fileToPhoto } from '../image/process';
import type { ScoreBand } from '../model/params';
import type { Photo } from '../types';

interface Props {
  band: ScoreBand;
  onPhoto: (photo: Photo) => void;
  onChangeScore: () => void;
  onOpenSettings: () => void;
}

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

export function Capture({ band, onPhoto, onChangeScore, onOpenSettings }: Props) {
  const camera = useCamera();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const ready = camera.state.status === 'ready';
  const error =
    camera.state.status === 'error' ? (IS_TRIAL ? TRIAL_ERROR : CAMERA_ERRORS[camera.state.error]) : null;

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

  return (
    <div className="screen capture">
      <div className="viewfinder">
        <video ref={camera.videoRef} playsInline muted autoPlay className={ready ? '' : 'is-hidden'} />

        <div className="guide">
          <p className="guide-main">ボールの近くから、脱出したい方向にカメラを向けてください</p>
          <p className="guide-sub">周囲に人やカートがいないことを確認してから撮影してください</p>
        </div>

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
          <p className="mode-note">静止画解析（リアルタイム解析は未実装）</p>
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
    </div>
  );
}
