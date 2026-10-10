import { AlertIcon } from '../components/Icons';
import { PhotoStage } from '../components/PhotoStage';
import { QUALITY_THRESHOLDS } from '../image/process';
import type { Photo } from '../types';

interface Props {
  photo: Photo;
  onRetake: () => void;
  onUse: () => void;
}

export function Confirm({ photo, onRetake, onUse }: Props) {
  const dark = photo.brightness < QUALITY_THRESHOLDS.darkBelow;
  const blurry = photo.sharpness < QUALITY_THRESHOLDS.blurBelow;

  return (
    <div className="screen">
      <header className="bar">
        <h1 className="bar-title">写真の確認</h1>
        <span className="tag">{photo.source === 'camera' ? '撮影した写真' : '読み込んだ画像'}</span>
      </header>
      <PhotoStage photo={photo} label="解析する写真" />
      <div className="pad stack confirm-notes">
        {dark ? (
          <p className="banner warn" role="status">
            <AlertIcon />
            <span>写真が暗めです。木の輪郭が見分けにくい場合は、明るい向きから撮り直してください。</span>
          </p>
        ) : null}
        {blurry ? (
          <p className="banner warn" role="status">
            <AlertIcon />
            <span>ブレまたはピンぼけの可能性があります。木の輪郭が見分けにくい場合は撮り直してください。</span>
          </p>
        ) : null}
        <p className="muted">脱出したい方向の木が写っていれば、この写真で進めます。次の画面で、木の位置を指でなぞって指定します。</p>
      </div>
      <footer className="actions two">
        <button type="button" className="btn" onClick={onRetake}>
          再撮影
        </button>
        <button type="button" className="btn primary" onClick={onUse}>
          この写真で進む
        </button>
      </footer>
    </div>
  );
}
