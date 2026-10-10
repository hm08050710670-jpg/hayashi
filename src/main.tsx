import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

/**
 * オフラインでも開けるよう、本番ビルドのときだけサービスワーカーを登録する。
 * 登録に失敗してもアプリ本体はそのまま動く。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // 読み込み済みのファイルを伝えて、次回からオフラインでも開けるようにする。
        const urls = [
          window.location.href,
          ...performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((name) => name.startsWith(window.location.origin)),
        ];
        registration.active?.postMessage({ type: 'cache-urls', urls });
      })
      .catch(() => {
        /* サービスワーカーを使えない環境では、通常のWebページとして動く */
      });
  });
}
