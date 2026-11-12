// Frame-rate and timecode arithmetic. Everything is integer frame counts; never multiply by 29.97.

export interface Rate {
  /** Integer frames-per-second label base: 24, 25, 30, 50, 60, 100, 120. */
  timebase: number;
  /** True for the 1000/1001 "NTSC" rates (23.976, 29.97, 59.94, 119.88). */
  ntsc: boolean;
}

export function rateKey(r: Rate): string {
  return `${r.timebase}${r.ntsc ? 'n' : ''}`;
}

export function sameRate(a: Rate, b: Rate): boolean {
  return a.timebase === b.timebase && a.ntsc === b.ntsc;
}

/** Real frames per second. */
export function fps(r: Rate): number {
  return r.ntsc ? (r.timebase * 1000) / 1001 : r.timebase;
}

export function rateLabel(r: Rate): string {
  if (!r.ntsc) return `${r.timebase}p`;
  const map: Record<number, string> = { 24: '23.98p', 30: '29.97p', 60: '59.94p', 120: '119.88p' };
  return map[r.timebase] ?? `${fps(r).toFixed(2)}p`;
}

/** Parse Sony strings such as "23.98p", "25p", "59.94p", "119.88p". */
export function parseSonyFps(s: string): Rate | null {
  const m = /^(\d+(?:\.\d+)?)\s*[pi]?$/i.exec(s.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v) || v <= 0) return null;
  const rounded = Math.round(v);
  const ntsc = Math.abs(v - rounded) > 0.001;
  return { timebase: ntsc ? Math.ceil(v) : rounded, ntsc };
}

/** Milliseconds of real time covered by n frames. */
export function framesToMs(frames: number, r: Rate): number {
  return r.ntsc ? (frames * 1001) / r.timebase : (frames * 1000) / r.timebase;
}

/** Real milliseconds to a (fractional) number of frames. */
export function msToFrames(ms: number, r: Rate): number {
  return r.ntsc ? (ms * r.timebase) / 1001 : (ms * r.timebase) / 1000;
}

/** Frame numbers skipped per minute in drop-frame counting: 2 at 30, 4 at 60, 8 at 120. */
function dropPerMinute(timebase: number): number {
  return Math.round(timebase / 15);
}

export function canDropFrame(timebase: number): boolean {
  return timebase % 30 === 0;
}

export interface TcFields {
  hh: number;
  mm: number;
  ss: number;
  ff: number;
}

/** Timecode label fields to a frame count from 00:00:00:00 (drop-frame aware). */
export function tcToFrames(tc: TcFields, timebase: number, drop: boolean): number {
  const totalMinutes = tc.hh * 60 + tc.mm;
  let frames = (totalMinutes * 60 + tc.ss) * timebase + tc.ff;
  if (drop && canDropFrame(timebase)) {
    const d = dropPerMinute(timebase);
    frames -= d * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

/** Frame count from 00:00:00:00 to timecode label fields (drop-frame aware, wraps at 24 h). */
export function framesToTc(frameCount: number, timebase: number, drop: boolean): TcFields {
  let f = Math.floor(frameCount);
  if (drop && canDropFrame(timebase)) {
    const d = dropPerMinute(timebase);
    const perMin = timebase * 60 - d;
    const per10 = timebase * 600 - d * 9;
    const day = per10 * 6 * 24;
    f = ((f % day) + day) % day;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += d * 9 * tens;
    if (rem >= timebase * 60) f += d * (1 + Math.floor((rem - timebase * 60) / perMin));
  } else {
    const day = timebase * 86400;
    f = ((f % day) + day) % day;
  }
  const ff = f % timebase;
  const s = Math.floor(f / timebase);
  return { hh: Math.floor(s / 3600), mm: Math.floor(s / 60) % 60, ss: s % 60, ff };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function formatTc(tc: TcFields, timebase: number, drop: boolean): string {
  const w = timebase > 100 ? 3 : 2;
  return `${pad(tc.hh)}:${pad(tc.mm)}:${pad(tc.ss)}${drop ? ';' : ':'}${pad(tc.ff, w)}`;
}

export function framesToTcString(frameCount: number, timebase: number, drop: boolean): string {
  return formatTc(framesToTc(frameCount, timebase, drop), timebase, drop);
}

/** Parse "HH:MM:SS:FF" / "HH:MM:SS;FF". */
export function parseTc(s: string): (TcFields & { drop: boolean }) | null {
  const m = /^\s*(\d{1,2})[:.](\d{1,2})[:.](\d{1,2})([:;.,])(\d{1,3})\s*$/.exec(s);
  if (!m) return null;
  return { hh: +m[1], mm: +m[2], ss: +m[3], ff: +m[5], drop: m[4] === ';' || m[4] === ',' };
}

/** Elapsed real time as M:SS.d for display. */
export function formatElapsed(ms: number): string {
  const neg = ms < 0;
  const t = Math.abs(ms);
  const s = Math.floor(t / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const body = `${h > 0 ? h + ':' + pad(m) : m}:${pad(s % 60)}`;
  return (neg ? '-' : '') + body;
}
