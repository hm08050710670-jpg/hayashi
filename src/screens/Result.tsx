import { useMemo, useState } from 'react';
import { Chips } from '../components/Chips';
import { AlertIcon, GearIcon } from '../components/Icons';
import { ObstacleLayer } from '../components/ObstacleLayer';
import { PhotoStage } from '../components/PhotoStage';
import { RouteLayer } from '../components/RouteLayer';
import {
  LEVEL_TEXT,
  aimText,
  directionLabel,
  percentText,
  recommendText,
  routeDescription,
} from '../model/describe';
import { CLUBS, DISTANCE_OPTIONS, LIES, MODEL_LABEL, SCORE_BANDS, type ScoreBand } from '../model/params';
import { computeRoutes } from '../model/routes';
import type { RouteInput } from '../model/types';
import type { Photo, Safety } from '../types';

interface Props {
  photo: Photo;
  input: RouteInput;
  safety: Safety;
  onBand: (band: ScoreBand) => void;
  onEdit: () => void;
  onRetake: () => void;
  onOpenSettings: () => void;
}

export function Result({ photo, input, safety, onBand, onEdit, onRetake, onOpenSettings }: Props) {
  const result = useMemo(() => computeRoutes(input), [input]);
  const [picked, setPicked] = useState<string | null>(null);

  const stopped = safety === 'blocked';
  const routes = stopped ? [] : result.routes;
  const best = routes.find((r) => r.isBest) ?? routes[0] ?? null;
  const selectedId = routes.some((r) => r.id === picked) ? picked : (best?.id ?? null);

  const lie = LIES.find((l) => l.id === input.lie);
  const club = CLUBS.find((c) => c.id === input.clubId);
  const distance = DISTANCE_OPTIONS.find((d) => d.value === input.distanceM);

  return (
    <div className="screen">
      <header className="bar">
        <h1 className="bar-title">解析結果</h1>
        <span className="tag">
          {input.obstacles.some((o) => o.source === 'auto') ? '静止画・自動検出あり' : '静止画・手動指定'}
        </span>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="設定">
          <GearIcon />
        </button>
      </header>

      <div className="result-stage">
        <PhotoStage
          photo={photo}
          label="解析した写真"
          overlay={(size) => (
            <>
              <ObstacleLayer obstacles={input.obstacles} size={size} dim />
              <RouteLayer
                routes={routes}
                obstacles={input.obstacles}
                frame={input.frame}
                focalEq={input.focalEq}
                size={size}
                selectedId={selectedId}
                onSelect={setPicked}
              />
            </>
          )}
        />
      </div>

      <div className="scroll pad stack result-body">
        {stopped ? (
          <div className="state-card bad" role="alert">
            <h2>
              <AlertIcon />
              ルートの表示を停止しました
            </h2>
            <p>
              前方に人がいる、または安全を確認できないと回答されたため、ルートと推定確率は表示しません。周囲の安全を確認できてから、もう一度計算してください。
            </p>
          </div>
        ) : result.status === 'insufficient' ? (
          <div className="state-card" role="status">
            <h2>判定不能</h2>
            <p>
              {result.insufficientReason === 'no_obstacles'
                ? '障害物が1つも指定されていないため、判定に必要な情報が不足しています。「障害物を修正」から、木の幹を囲んでください。'
                : '写真の情報を読み取れませんでした。撮影し直してください。'}
            </p>
          </div>
        ) : routes.length === 0 ? (
          <div className="state-card" role="status">
            <h2>通過できる隙間が見つかりません</h2>
            <p>
              写真に写っている範囲では、ボールが通れる幅の隙間がありませんでした。別の方向を撮影するか、障害物の指定を見直してください。
            </p>
          </div>
        ) : (
          <>
            <p className="model-note">
              <strong>{MODEL_LABEL}</strong>
              ：数値は「木の間を通過する」推定確率です。林から完全に脱出できる確率ではありません。
            </p>
            <ul className="route-list">
              {routes.map((route) => (
                <li key={route.id}>
                  <button
                    type="button"
                    className={`route-card ${route.status === 'ok' && route.level ? route.level : 'unknown'}`}
                    aria-pressed={route.id === selectedId}
                    onClick={() => setPicked(route.id)}
                  >
                    <span className="route-letter num">{route.letter}</span>
                    <span className="route-head-text">
                      <span className="route-name">
                        ルート{route.letter}：{directionLabel(route.aimDeg)}
                      </span>
                      <span className="route-level">
                        {route.status === 'ok' && route.level ? `難易度：${LEVEL_TEXT[route.level]}` : '難易度：評価できません'}
                      </span>
                    </span>
                    <span className="route-value">
                      {route.status === 'ok' && route.probability !== null ? (
                        <>
                          <span className="route-pct num">
                            {percentText(route.probability)}
                            <small>%</small>
                          </span>
                          <span className="route-value-label">推定成功率</span>
                        </>
                      ) : (
                        <span className="route-na">判定不能</span>
                      )}
                    </span>
                    <span className="route-detail">
                      <span className="route-recommend">おすすめ度：{recommendText(route)}</span>
                      <span className="route-desc">{routeDescription(route, result)}</span>
                      <span className="route-facts">
                        通過幅 約{route.widthDeg.toFixed(1)}°　狙い {aimText(route.aimDeg)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {result.hiddenCount > 0 || result.blockedCount > 0 ? (
              <p className="muted small-text">
                {result.hiddenCount > 0 ? `表示は上位3件までです（ほかに候補 ${result.hiddenCount} 件）。` : ''}
                {result.blockedCount > 0 ? `通過不可と判定した隙間：${result.blockedCount} 件。` : ''}
              </p>
            ) : null}
          </>
        )}

        {stopped ? null : (
          <>
            <Chips
              label="スコア帯を変えて比べる"
              options={SCORE_BANDS.map((b) => ({ value: b, label: `${b}台` }))}
              value={input.band}
              onChange={onBand}
            />

            <section className="detail">
              <h2>計算条件</h2>
              <dl>
                <div>
                  <dt>スコア帯</dt>
                  <dd>{input.band}台</dd>
                </div>
                <div>
                  <dt>ボールのライ</dt>
                  <dd>{lie?.label}</dd>
                </div>
                <div>
                  <dt>最初の木までの距離</dt>
                  <dd>{distance?.label ?? '不明'}</dd>
                </div>
                <div>
                  <dt>使用予定クラブ</dt>
                  <dd>{club?.label ?? '未選択'}</dd>
                </div>
                <div>
                  <dt>方向のばらつき（仮）</dt>
                  <dd>標準偏差 {result.dirSigmaDeg.toFixed(1)}°</dd>
                </div>
                <div>
                  <dt>大きなミスの割合（仮）</dt>
                  <dd>{Math.round(result.mishitRate * 100)}%</dd>
                </div>
                <div>
                  <dt>写真の横の画角（仮定）</dt>
                  <dd>約{Math.round(result.hfovDeg)}°</dd>
                </div>
                <div>
                  <dt>障害物の両側の余裕</dt>
                  <dd>各 {result.marginDeg.toFixed(1)}°</dd>
                </div>
              </dl>
              {result.distanceAssumed ? (
                <p className="muted small-text">
                  距離が不明のため、ボール幅の余裕は近い距離（2m）を想定して大きめに取っています。
                </p>
              ) : null}
            </section>
          </>
        )}

        {routes.length > 0 ? (
          <section className="detail">
            <h2>ご注意</h2>
            <ul className="cautions">
              <li>画面に映っていない範囲の障害物は判定できません。</li>
              <li>指定していない奥の木や枝は計算に含まれていません。この先の障害物は未確認です。</li>
              <li>推定確率はショットの成功を保証するものではありません。</li>
              <li>ショットの前に、周囲の安全を必ず自分の目で確認してください。</li>
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="actions two">
        <button type="button" className="btn" onClick={onRetake}>
          再撮影
        </button>
        <button type="button" className="btn primary" onClick={onEdit}>
          {stopped ? '安全を確認し直す' : '障害物を修正'}
        </button>
      </footer>
    </div>
  );
}
