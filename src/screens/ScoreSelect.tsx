import { BackIcon } from '../components/Icons';
import { SCORE_BANDS, type ScoreBand } from '../model/params';

interface Props {
  current: ScoreBand | null;
  onSelect: (band: ScoreBand) => void;
  /** 変更のために開いたときだけ、戻るボタンを出す */
  onBack?: () => void;
}

export function ScoreSelect({ current, onSelect, onBack }: Props) {
  return (
    <div className="screen">
      <header className="bar">
        {onBack ? (
          <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
            <BackIcon />
          </button>
        ) : (
          <span className="brand">GOLF ESCAPE AI</span>
        )}
        <span className="tag">試作版</span>
      </header>
      <div className="scroll pad score-screen">
        <h1 className="title">あなたの平均スコアを選択してください</h1>
        <div className="score-grid">
          {SCORE_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              className="score-btn"
              aria-pressed={band === current}
              onClick={() => onSelect(band)}
            >
              <span className="score-label">
                <span className="num">{band}</span>
                <span className="score-unit">台</span>
              </span>
            </button>
          ))}
        </div>
        <p className="muted">
          スコア帯は、ショットの方向や高さのばらつきの仮定に使います。選んだ内容はこの端末に保存され、設定からいつでも変更できます。
        </p>
      </div>
    </div>
  );
}
