import { useCallback, useMemo, useRef, useState } from 'react';
import { DEFAULT_LIE, type ClubId, type LieId, type ScoreBand } from './model/params';
import type { Obstacle, RouteInput } from './model/types';
import { Capture } from './screens/Capture';
import { Confirm } from './screens/Confirm';
import { Mark } from './screens/Mark';
import { Notice } from './screens/Notice';
import { Result } from './screens/Result';
import { ScoreSelect } from './screens/ScoreSelect';
import { Settings } from './screens/Settings';
import * as storage from './storage';
import type { Photo, Safety } from './types';

type Screen = 'notice' | 'score' | 'capture' | 'confirm' | 'mark' | 'result' | 'settings';

export function App() {
  const [band, setBand] = useState<ScoreBand | null>(() => storage.loadBand());
  const [noticeAccepted, setNoticeAccepted] = useState(() => storage.loadNoticeAccepted());
  const [focalEq, setFocalEq] = useState(() => storage.loadFocalEq());

  const [screen, setScreen] = useState<Screen>(() =>
    !storage.loadNoticeAccepted() ? 'notice' : storage.loadBand() === null ? 'score' : 'capture',
  );
  /** スコア選択・設定・注意書きを閉じたあとに戻る画面 */
  const [returnTo, setReturnTo] = useState<Screen>('capture');
  const [settingsReturn, setSettingsReturn] = useState<Screen>('capture');

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [lie, setLie] = useState<LieId>(DEFAULT_LIE);
  const [clubId, setClubId] = useState<ClubId | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [safety, setSafety] = useState<Safety>('clear');

  // 使い終わった写真の一時URLを解放して、メモリを使い続けないようにする。
  const photoUrl = useRef<string | null>(null);
  const releasePhotoUrl = useCallback(() => {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
  }, []);

  const chooseBand = useCallback((next: ScoreBand) => {
    setBand(next);
    storage.saveBand(next);
  }, []);

  const chooseFocal = useCallback((next: number) => {
    setFocalEq(next);
    storage.saveFocalEq(next);
  }, []);

  const takePhoto = useCallback(
    (next: Photo) => {
      releasePhotoUrl();
      photoUrl.current = next.url;
      // 新しい写真では、前の写真に対する指定を引き継がない。
      setPhoto(next);
      setObstacles([]);
      setClubId(null);
      setDistanceM(null);
      setLie(DEFAULT_LIE);
      setScreen('confirm');
    },
    [releasePhotoUrl],
  );

  const openSettings = useCallback((from: Screen) => {
    setSettingsReturn(from);
    setScreen('settings');
  }, []);

  const input = useMemo<RouteInput | null>(
    () =>
      photo && band !== null
        ? {
            obstacles,
            frame: { width: photo.width, height: photo.height },
            band,
            lie,
            clubId,
            distanceM,
            focalEq,
          }
        : null,
    [photo, band, obstacles, lie, clubId, distanceM, focalEq],
  );

  if (screen === 'notice') {
    return (
      <Notice
        firstTime={!noticeAccepted}
        onAccept={() => {
          if (!noticeAccepted) {
            storage.saveNoticeAccepted();
            setNoticeAccepted(true);
            setScreen(band === null ? 'score' : 'capture');
          } else {
            setScreen('settings');
          }
        }}
      />
    );
  }

  if (screen === 'score' || band === null) {
    return (
      <ScoreSelect
        current={band}
        onSelect={(next) => {
          const first = band === null;
          chooseBand(next);
          setScreen(first ? 'capture' : returnTo);
        }}
        onBack={band === null ? undefined : () => setScreen(returnTo)}
      />
    );
  }

  if (screen === 'settings') {
    return (
      <Settings
        band={band}
        onBand={chooseBand}
        focalEq={focalEq}
        onFocalEq={chooseFocal}
        onShowNotice={() => setScreen('notice')}
        onReset={() => {
          storage.clearAll();
          setBand(null);
          setNoticeAccepted(false);
          setFocalEq(storage.loadFocalEq());
          releasePhotoUrl();
          setPhoto(null);
          setObstacles([]);
          setScreen('notice');
        }}
        onBack={() => setScreen(settingsReturn)}
      />
    );
  }

  if (screen === 'confirm' && photo) {
    return <Confirm photo={photo} onRetake={() => setScreen('capture')} onUse={() => setScreen('mark')} />;
  }

  if (screen === 'mark' && photo) {
    return (
      <Mark
        photo={photo}
        obstacles={obstacles}
        onObstacles={setObstacles}
        lie={lie}
        onLie={setLie}
        clubId={clubId}
        onClub={setClubId}
        distanceM={distanceM}
        onDistance={setDistanceM}
        onRetake={() => setScreen('capture')}
        onCompute={(answer) => {
          setSafety(answer);
          setScreen('result');
        }}
      />
    );
  }

  if (screen === 'result' && photo && input) {
    return (
      <Result
        photo={photo}
        input={input}
        safety={safety}
        onBand={chooseBand}
        onEdit={() => setScreen('mark')}
        onRetake={() => setScreen('capture')}
        onOpenSettings={() => openSettings('result')}
      />
    );
  }

  return (
    <Capture
      band={band}
      onPhoto={takePhoto}
      onChangeScore={() => {
        setReturnTo('capture');
        setScreen('score');
      }}
      onOpenSettings={() => openSettings('capture')}
    />
  );
}
