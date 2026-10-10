import { useEffect, useState } from 'react';
import { Chips } from '../components/Chips';
import { BackIcon } from '../components/Icons';
import {
  BAND_PARAMS,
  CLUBS,
  FOCAL_OPTIONS,
  GEOMETRY,
  LEVEL_THRESHOLDS,
  LIES,
  MODEL_VERSION,
  SCORE_BANDS,
  type ScoreBand,
} from '../model/params';

import { LIVE_RATE_OPTIONS } from '../storage';

interface Props {
  band: ScoreBand;
  onBand: (band: ScoreBand) => void;
  focalEq: number;
  onFocalEq: (focalEq: number) => void;
  liveRate: number;
  onLiveRate: (rate: number) => void;
  onShowNotice: () => void;
  onReset: () => void;
  onBack: () => void;
}

const IMPLEMENTED = [
  'スコア帯の選択と保存',
  'カメラの起動と静止画の撮影',
  '端末内の画像の読み込み',
  '障害物（幹・枝・地面）の手動指定',
  '指定した障害物からの候補ルートの計算',
  'スコア帯別の推定確率（仮モデル）',
  'リアルタイム解析（試験版）：映像から見通せる方向を自動で探し、ルートと推定確率を更新',
  '静止画での障害物の自動検出（試験版）と、手動での修正',
];

const NOT_IMPLEMENTED = [
  'AIモデルによる木・障害物の検出（現在の自動検出は画像処理によるもので、実際の林での精度は未検証）',
  '枝・切り株・地面の障害物の自動検出',
  '人やカートの自動検出（現在は自己申告で確認）',
  '奥行きの推定、クラブ別の球筋、実測データによる補正',
];

const RATE_LABEL: Record<number, string> = {
  2: '低（毎秒2回）',
  4: '標準（毎秒4回）',
  8: '高（毎秒8回）',
};

export function Settings({
  band,
  onBand,
  focalEq,
  onFocalEq,
  liveRate,
  onLiveRate,
  onShowNotice,
  onReset,
  onBack,
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="戻る">
          <BackIcon />
        </button>
        <h1 className="bar-title">設定</h1>
      </header>
      <div className="scroll pad stack">
        <Chips
          label="平均スコア"
          options={SCORE_BANDS.map((b) => ({ value: b, label: `${b}台` }))}
          value={band}
          onChange={onBand}
        />

        <Chips
          label="写真の画角の仮定"
          options={FOCAL_OPTIONS}
          value={focalEq}
          onChange={onFocalEq}
          hint="写真の横位置を角度に直すときの仮定です。機種やカメラの設定で変わります。分からなければ「標準」のままにしてください。"
        />

        <Chips
          label="リアルタイム解析の更新頻度"
          options={LIVE_RATE_OPTIONS.map((r) => ({ value: r, label: RATE_LABEL[r] ?? `毎秒${r}回` }))}
          value={liveRate}
          onChange={onLiveRate}
          hint="高くすると反応が速くなりますが、バッテリーの消費が増えます。端末の処理が追いつかない場合は、自動で頻度を下げます。"
        />

        <section className="detail">
          <h2>計算に使っている仮の数値</h2>
          <p className="muted small-text">
            すべて調整可能な仮の値で、実測データによる検証は行っていません（モデル {MODEL_VERSION}）。「方向」「高さ」は打ち出しのばらつき（標準偏差）です。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>スコア帯</th>
                  <th>方向</th>
                  <th>高さ</th>
                  <th>大きなミス</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_BANDS.map((b) => (
                  <tr key={b}>
                    <th>{b}台</th>
                    <td>{BAND_PARAMS[b].dirSigmaDeg.toFixed(1)}°</td>
                    <td>{BAND_PARAMS[b].launchSigmaDeg.toFixed(1)}°</td>
                    <td>{Math.round(BAND_PARAMS[b].mishitRate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ライ</th>
                  <th>ばらつき</th>
                  <th>大きなミス</th>
                </tr>
              </thead>
              <tbody>
                {LIES.map((l) => (
                  <tr key={l.id}>
                    <th>{l.label}</th>
                    <td>×{l.sigmaMult.toFixed(2)}</td>
                    <td>×{l.mishitMult.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>クラブ</th>
                  <th>低い球の打ち出し角</th>
                </tr>
              </thead>
              <tbody>
                {CLUBS.map((c) => (
                  <tr key={c.id}>
                    <th>{c.label}</th>
                    <td>{c.launchDeg}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-text">
            色分けの基準：{Math.round(LEVEL_THRESHOLDS.green * 100)}%以上は「比較的通しやすい」、
            {Math.round(LEVEL_THRESHOLDS.yellow * 100)}%以上は「注意が必要」、それ未満は「難しい」。障害物の両側には、指定のずれとして
            {GEOMETRY.markToleranceDeg}°とボール半径分の余裕を取ります。
          </p>
        </section>

        <section className="detail">
          <h2>この版でできること</h2>
          <ul className="cautions">
            {IMPLEMENTED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <h2>まだできないこと</h2>
          <ul className="cautions">
            {NOT_IMPLEMENTED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <div className="stack">
          <button type="button" className="btn" onClick={onShowNotice}>
            ご利用上の注意を表示
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (!confirmReset) setConfirmReset(true);
              else onReset();
            }}
          >
            {confirmReset ? 'もう一度押すと初期化します' : '保存した設定を初期化'}
          </button>
        </div>
        <p className="muted small-text">GOLF ESCAPE AI 試作版（静止画解析＋リアルタイム解析の試験版）</p>
      </div>
    </div>
  );
}
