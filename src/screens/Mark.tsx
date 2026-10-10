import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { OPENING_PARAMS, blockedSpans, detectOpenings } from '../analysis/openingDetector';
import { spansToObstacles } from '../camera/useLiveAnalysis';
import { Chips } from '../components/Chips';
import { BackIcon, TrashIcon, UndoIcon } from '../components/Icons';
import { KIND_LABEL, ObstacleLayer, obstacleTag } from '../components/ObstacleLayer';
import { PhotoStage, type StageSize } from '../components/PhotoStage';
import { photoToPixels } from '../image/process';
import {
  CLEARANCES,
  CLUBS,
  DEFAULT_CLEARANCE,
  DISTANCE_OPTIONS,
  LIES,
  type ClearanceId,
  type ClubId,
  type LieId,
} from '../model/params';
import type { Obstacle, ObstacleKind } from '../model/types';
import type { Photo, Safety } from '../types';

interface Props {
  photo: Photo;
  obstacles: Obstacle[];
  onObstacles: (next: Obstacle[]) => void;
  lie: LieId;
  onLie: (lie: LieId) => void;
  clubId: ClubId | null;
  onClub: (club: ClubId | null) => void;
  distanceM: number | null;
  onDistance: (d: number | null) => void;
  onRetake: () => void;
  onCompute: (safety: Safety) => void;
}

interface Draft {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const KIND_HINT: Record<ObstacleKind, string> = {
  trunk: '木の幹を、指でなぞって四角で囲んでください。',
  branch: '低い球の邪魔になりそうな枝を囲み、枝の下の高さを選んでください。',
  ground: '切り株、根、低い茂みなど、地面付近の障害物を囲んでください。',
};

const KIND_OPTIONS: { value: ObstacleKind; label: string }[] = [
  { value: 'trunk', label: '幹' },
  { value: 'branch', label: '枝' },
  { value: 'ground', label: '地面の障害物' },
];

const MIN_DRAG_PX = 8;
const MIN_BOX_PX = 10;

let nextId = 1;

export function Mark(props: Props) {
  const { photo, obstacles, onObstacles } = props;
  const [kind, setKind] = useState<ObstacleKind>('trunk');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [askSafety, setAskSafety] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const sizeRef = useRef<StageSize>({ w: 1, h: 1 });

  const selected = obstacles.find((o) => o.id === selectedId) ?? null;
  const hasBranch = obstacles.some((o) => o.kind === 'branch');
  const autoCount = obstacles.filter((o) => o.source === 'auto').length;
  const counts =
    (['trunk', 'branch', 'ground'] as ObstacleKind[])
      .map((k) => `${KIND_LABEL[k]} ${obstacles.filter((o) => o.kind === k && o.source !== 'auto').length}`)
      .join('　') + (autoCount > 0 ? `　自動 ${autoCount}` : '');

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  /** 画面上の位置を、写真に対する割合（0〜1）に変換する。 */
  const locate = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current) return;
    const p = locate(e);
    drag.current = { pointerId: e.pointerId, x: p.x, y: p.y, moved: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 取得できなくても、枠内の操作は続けられる */
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = locate(e);
    const { w, h } = sizeRef.current;
    if (!d.moved && Math.hypot((p.x - d.x) * w, (p.y - d.y) * h) < MIN_DRAG_PX) return;
    d.moved = true;
    setDraft({ x0: d.x, y0: d.y, x1: p.x, y1: p.y });
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraft(null);
    const p = locate(e);
    const { w, h } = sizeRef.current;

    if (!d.moved) {
      // なぞらずに触れただけなら、その位置の障害物を選択する（上に重なっているものを優先）。
      const hit = [...obstacles].reverse().find((o) => {
        const padX = 8 / w;
        const padY = 8 / h;
        return p.x >= o.x - padX && p.x <= o.x + o.w + padX && p.y >= o.y - padY && p.y <= o.y + o.h + padY;
      });
      setSelectedId(hit ? hit.id : null);
      return;
    }

    const box = {
      x: Math.min(d.x, p.x),
      y: Math.min(d.y, p.y),
      w: Math.abs(p.x - d.x),
      h: Math.abs(p.y - d.y),
    };
    if (box.w * w < MIN_BOX_PX || box.h * h < MIN_BOX_PX) return;
    const id = `m${Date.now().toString(36)}-${nextId++}`;
    onObstacles([...obstacles, { id, kind, ...box, clearance: DEFAULT_CLEARANCE, source: 'manual' }]);
    setSelectedId(id);
  };

  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDraft(null);
  };

  const removeSelected = () => {
    if (!selected) return;
    onObstacles(obstacles.filter((o) => o.id !== selected.id));
    setSelectedId(null);
  };

  const undo = () => {
    const last = obstacles[obstacles.length - 1];
    if (!last) return;
    onObstacles(obstacles.slice(0, -1));
    if (selectedId === last.id) setSelectedId(null);
  };

  const clearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    onObstacles([]);
    setSelectedId(null);
    setConfirmClear(false);
  };

  /** 写真から障害物を自動検出する（試験版）。前回の自動検出の結果は置き換え、手動指定は残す。 */
  const autoDetect = async () => {
    if (detecting) return;
    setDetecting(true);
    setAutoNote(null);
    try {
      const pixels = await photoToPixels(photo, OPENING_PARAMS.analysisWidth);
      const detection = detectOpenings(pixels);
      const manual = obstacles.filter((o) => o.source !== 'auto');
      if (detection.reason !== 'ok') {
        onObstacles(manual);
        setAutoNote(
          detection.reason === 'too_dark'
            ? '写真が暗すぎて、自動検出できませんでした。手動で指定してください。'
            : '奥が明るく写っていないため、自動検出できませんでした。手動で指定してください。',
        );
      } else {
        const stamp = Date.now().toString(36);
        const found = spansToObstacles(
          blockedSpans(detection.open, OPENING_PARAMS.minOpenRunPx),
          detection.bandTop,
          detection.bandBottom,
        ).map((o) => ({ ...o, id: `${o.id}-${stamp}` }));
        onObstacles([...manual, ...found]);
        setAutoNote(
          found.length === 0
            ? '障害物は検出されませんでした。写真と合っているか確認し、必要なら手動で指定してください。'
            : `${found.length}か所を「障害物または未確認」として追加しました。写真と合っていない範囲は、選んで削除するか、手動で追加してください。`,
        );
      }
      setSelectedId(null);
    } catch {
      setAutoNote('自動検出に失敗しました。手動で指定してください。');
    } finally {
      setDetecting(false);
    }
  };

  const setClearance = (clearance: ClearanceId) => {
    if (!selected) return;
    onObstacles(obstacles.map((o) => (o.id === selected.id ? { ...o, clearance } : o)));
  };

  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="icon-btn" onClick={props.onRetake} aria-label="撮影に戻る">
          <BackIcon />
        </button>
        <h1 className="bar-title">障害物を指定</h1>
        <span className="tag">手動指定</span>
      </header>

      <PhotoStage
        photo={photo}
        label="障害物を指定する写真"
        svgProps={{
          className: 'draw-surface',
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel,
        }}
        overlay={(size) => {
          sizeRef.current = size;
          return (
            <>
              <ObstacleLayer obstacles={obstacles} size={size} selectedId={selectedId} />
              {draft ? (
                <rect
                  className="draft-box"
                  x={Math.min(draft.x0, draft.x1) * size.w}
                  y={Math.min(draft.y0, draft.y1) * size.h}
                  width={Math.abs(draft.x1 - draft.x0) * size.w}
                  height={Math.abs(draft.y1 - draft.y0) * size.h}
                  rx="3"
                />
              ) : null}
            </>
          );
        }}
      />

      <div className="panel scroll">
        <Chips
          label="囲む対象"
          hideLabel
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
          hint={KIND_HINT[kind]}
        />

        {selected ? (
          <div className="selected-row">
            <div className="selected-head">
              <span className="selected-name">選択中：{obstacleTag(selected)}</span>
              <button type="button" className="btn small danger" onClick={removeSelected}>
                <TrashIcon />
                削除
              </button>
            </div>
            {selected.kind === 'branch' ? (
              <Chips
                label="枝の下の高さ（目測）"
                options={CLEARANCES.map((c) => ({ value: c.id, label: c.label }))}
                value={selected.clearance}
                onChange={setClearance}
              />
            ) : null}
          </div>
        ) : null}

        <div className="tool-row">
          <span className="counts">{counts}</span>
          <button type="button" className="btn small" onClick={undo} disabled={obstacles.length === 0}>
            <UndoIcon />
            1つ戻す
          </button>
          <button type="button" className="btn small" onClick={clearAll} disabled={obstacles.length === 0}>
            {confirmClear ? 'もう一度押すと全消去' : 'すべて消す'}
          </button>
        </div>

        <div className="auto-row">
          <button type="button" className="btn small" onClick={autoDetect} disabled={detecting}>
            {detecting ? '検出中…' : '自動検出（試験版）'}
          </button>
          <span className="muted small-text">写真の中央の帯で、奥が見通せない範囲を障害物として追加します。</span>
        </div>
        {autoNote ? (
          <p className="banner" role="status">
            {autoNote}
          </p>
        ) : null}

        <Chips
          label="ボールのライ"
          options={LIES.map((l) => ({ value: l.id, label: l.label }))}
          value={props.lie}
          onChange={props.onLie}
        />

        {hasBranch ? (
          <>
            <Chips
              label="最初の木までの距離（目測）"
              options={DISTANCE_OPTIONS}
              value={props.distanceM}
              onChange={props.onDistance}
              hint="枝の下を通せるかの計算に使います。不明のままだと、枝がかかる隙間は判定不能になります。"
            />
            <Chips
              label="使用予定クラブ"
              options={[{ value: null, label: '未選択' }, ...CLUBS.map((c) => ({ value: c.id as ClubId | null, label: c.label }))]}
              value={props.clubId}
              onChange={props.onClub}
            />
          </>
        ) : null}

        <p className="muted small-text">
          自動検出は画像処理による試験版で、AIモデルではありません。画面に出ている障害物だけを使って計算します。
        </p>
      </div>

      <footer className="actions">
        <button type="button" className="btn primary" onClick={() => setAskSafety(true)}>
          ルートを計算
        </button>
      </footer>

      {askSafety ? (
        <div className="sheet-backdrop">
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="safety-title">
            <h2 id="safety-title">前方の安全を確認してください</h2>
            <p>
              打ちたい方向とその周囲に、人、カート、ほかのプレーヤー、コース管理車両がいないことを、自分の目で確認してください。
            </p>
            <div className="stack">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setAskSafety(false);
                  props.onCompute('clear');
                }}
              >
                誰もいないことを確認した
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setAskSafety(false);
                  props.onCompute('blocked');
                }}
              >
                人がいる・確認できない
              </button>
              <button type="button" className="btn ghost" onClick={() => setAskSafety(false)}>
                指定に戻る
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
