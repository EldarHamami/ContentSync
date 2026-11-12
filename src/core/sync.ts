// Maps phone-clock marks onto camera clips.
//
// The only thing phone and cameras share is time. Each clip records the camera's clock at record
// start (1 s resolution). Per camera we keep one number: how far its clock is from the phone's.
// When the camera runs free-run timecode we additionally use the timecode to position that
// camera's clips relative to each other with frame precision.
import { fps, framesToMs, msToFrames, parseTc, sameRate, tcToFrames, type Rate } from './timecode';
import { markerTime, type Camera, type Clip, type Marker, type Session } from './types';

export interface ClipTiming {
  clip: Clip;
  /** Estimated phone-clock instant of the clip's first frame. */
  startMs: number;
  endMs: number;
}

export interface CameraTiming {
  camera: Camera;
  /** True when this camera's timecode was detected as free run (continuous across clips). */
  freeRun: boolean;
  clips: ClipTiming[];
}

const FREE_RUN_TOLERANCE_MS = 1500;
const DAY_MS = 86400000;

/** Real elapsed ms from timecode 00:00:00:00 to the clip's first frame. */
function tcRealMs(c: Clip): number {
  return framesToMs(c.startFrameFull, c.rate);
}

/** Camera-clock estimates of each clip's first frame, for one camera's clips. */
export function estimateCameraClockStarts(clips: Clip[]): { starts: Map<string, number>; freeRun: boolean } {
  const starts = new Map<string, number>();
  // The camera stamps whole seconds; the true start lies somewhere in that second.
  for (const c of clips) starts.set(c.id, c.creationMs + 500);

  const normal = clips.filter((c) => !c.slowQuick).sort((a, b) => a.creationMs - b.creationMs);
  if (normal.length < 2 || !normal.every((c) => sameRate(c.rate, normal[0].rate))) {
    return { starts, freeRun: false };
  }
  // Free run: timecode advances with the wall clock, also between clips. Unwrap midnight.
  const t: number[] = [];
  let wrap = 0;
  for (let i = 0; i < normal.length; i++) {
    let v = tcRealMs(normal[i]) + wrap;
    if (i > 0 && v < t[i - 1] - DAY_MS / 2) {
      wrap += framesToMs(tcToFrames({ hh: 24, mm: 0, ss: 0, ff: 0 }, normal[i].rate.timebase, normal[i].dropFrame), normal[i].rate);
      v = tcRealMs(normal[i]) + wrap;
    }
    t.push(v);
  }
  const freeRun = normal.every(
    (c, i) => Math.abs(t[i] - t[0] - (c.creationMs - normal[0].creationMs)) <= FREE_RUN_TOLERANCE_MS,
  );
  if (!freeRun) return { starts, freeRun: false };

  // Every clip says: base is within [creation - t, creation - t + 1 s). Intersect them all.
  let lo = -Infinity;
  let hi = Infinity;
  let sum = 0;
  normal.forEach((c, i) => {
    const b = c.creationMs - t[i];
    lo = Math.max(lo, b);
    hi = Math.min(hi, b + 1000);
    sum += b + 500;
  });
  const base = lo <= hi ? (lo + hi) / 2 : sum / normal.length;
  normal.forEach((c, i) => starts.set(c.id, base + t[i]));
  return { starts, freeRun: true };
}

export function computeTimings(session: Session): CameraTiming[] {
  return session.cameras.map((camera) => {
    const clips = session.clips.filter((c) => c.cameraId === camera.id);
    const { starts, freeRun } = estimateCameraClockStarts(clips);
    const timed = clips
      .map((clip) => {
        const startMs = (starts.get(clip.id) ?? clip.creationMs) - camera.clockOffsetMs;
        return { clip, startMs, endMs: startMs + framesToMs(clip.durationFrames, clip.rate) };
      })
      .sort((a, b) => a.startMs - b.startMs);
    return { camera, freeRun, clips: timed };
  });
}

export interface Placement {
  marker: Marker;
  clip: Clip;
  cameraId: string;
  /** 0-based frame within the clip's file. */
  frame: number;
}

/** Frame of an instant within a clip, or null when outside it. */
export function frameAt(t: ClipTiming, ms: number): number | null {
  if (t.clip.slowQuick) return null;
  const f = Math.floor(msToFrames(ms - t.startMs, t.clip.rate) + 1e-6);
  return f >= 0 && f < t.clip.durationFrames ? f : null;
}

export function placeMarkers(session: Session, timings = computeTimings(session)): Placement[] {
  const out: Placement[] = [];
  for (const marker of session.markers) {
    const ms = markerTime(marker);
    for (const cam of timings) {
      for (const t of cam.clips) {
        const frame = frameAt(t, ms);
        if (frame !== null) {
          out.push({ marker, clip: t.clip, cameraId: cam.camera.id, frame });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Calibrate one camera from a filmed sync slate: at `frameInClip` of `clip` the footage shows the
 * phone clock reading `slateMs`. Returns the new clock offset for that camera.
 */
export function calibrateOffset(session: Session, clip: Clip, frameInClip: number, slateMs: number): number {
  const camera = session.cameras.find((c) => c.id === clip.cameraId);
  if (!camera) throw new Error('Clip has no camera');
  const timing = computeTimings(session)
    .find((c) => c.camera.id === camera.id)!
    .clips.find((t) => t.clip.id === clip.id)!;
  const wantedStart = slateMs - framesToMs(frameInClip, clip.rate);
  return camera.clockOffsetMs + (timing.startMs - wantedStart);
}

/**
 * Sync a camera from a snapshot of its timecode display taken at a known phone time.
 * Works when the camera was recording at that moment, or when its timecode is free run.
 */
export function offsetFromTcAnchor(session: Session, cameraId: string, anchor: { phoneMs: number; tc: string }): { offsetMs: number } | { error: string } {
  const tc = parseTc(anchor.tc);
  if (!tc) return { error: 'Type the timecode like 01:23:45:10' };
  const cam = computeTimings(session).find((c) => c.camera.id === cameraId);
  const clips = (cam?.clips ?? []).filter((t) => !t.clip.slowQuick);
  if (!cam || clips.length === 0) return { error: 'Add this camera\'s clips first' };
  let best: { clip: Clip; frame: number; dist: number } | null = null;
  for (const t of clips) {
    // The camera display counts in its own base (24/25/30); files may run 2x or 4x that.
    const frame = tcToFrames(tc, t.clip.tcBase, t.clip.dropFrame) * t.clip.k - t.clip.startFrameFull;
    const dist = frame < 0 ? -frame : Math.max(0, frame - (t.clip.durationFrames - 1));
    if (!best || dist < best.dist) best = { clip: t.clip, frame, dist };
  }
  if (!best) return { error: 'No usable clip' };
  if (best.dist > 0 && !cam.freeRun) {
    return { error: 'That timecode is not inside any clip. Take the snapshot while the camera is recording, or set the camera to Free Run timecode.' };
  }
  return { offsetMs: calibrateOffset(session, best.clip, best.frame, anchor.phoneMs) };
}

/** Apply every stored timecode snapshot that can be resolved against the loaded clips. */
export function applyTcAnchors(session: Session): Session {
  let s = session;
  for (const cam of session.cameras) {
    if (!cam.tcAnchor) continue;
    const r = offsetFromTcAnchor(s, cam.id, cam.tcAnchor);
    if ('offsetMs' in r) s = { ...s, cameras: s.cameras.map((c) => (c.id === cam.id ? { ...c, clockOffsetMs: r.offsetMs, calibrated: true } : c)) };
  }
  return s;
}

export function describeAccuracy(cam: CameraTiming): string {
  if (cam.clips.length === 0) return 'No clips yet';
  if (cam.camera.calibrated) return cam.freeRun ? 'Synced, free-run timecode: a few frames' : 'Synced on one clip: that clip to a few frames, others within about 1 second';
  return 'Camera clock: within a second or two if the camera clock matches your phone';
}

export { fps, type Rate };
