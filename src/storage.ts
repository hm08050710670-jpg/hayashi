import { DEFAULT_FOCAL_EQ, FOCAL_OPTIONS, SCORE_BANDS, type ScoreBand } from './model/params';

/**
 * 端末内（localStorage）への保存。
 * プライベートブラウズなどで使えない場合でもアプリが止まらないよう、すべて try/catch で囲む。
 */
const KEYS = {
  band: 'golf-escape-ai.band',
  notice: 'golf-escape-ai.notice-accepted',
  focal: 'golf-escape-ai.focal-eq',
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

export function loadBand(): ScoreBand | null {
  const n = Number(read(KEYS.band));
  return (SCORE_BANDS as readonly number[]).includes(n) ? (n as ScoreBand) : null;
}
export const saveBand = (band: ScoreBand) => write(KEYS.band, String(band));

export const loadNoticeAccepted = () => read(KEYS.notice) === '1';
export const saveNoticeAccepted = () => write(KEYS.notice, '1');

export function loadFocalEq(): number {
  const n = Number(read(KEYS.focal));
  return FOCAL_OPTIONS.some((f) => f.value === n) ? n : DEFAULT_FOCAL_EQ;
}
export const saveFocalEq = (focalEq: number) => write(KEYS.focal, String(focalEq));

export function clearAll(): void {
  write(KEYS.band, null);
  write(KEYS.notice, null);
  write(KEYS.focal, null);
}
