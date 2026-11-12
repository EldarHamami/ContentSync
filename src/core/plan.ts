// Turns a session into export-ready "plans": one synced multi-camera timeline per frame rate.
import { canDropFrame, msToFrames, rateKey, rateLabel, tcToFrames, type Rate } from './timecode';
import { computeTimings, frameAt, type CameraTiming } from './sync';
import { markerTime, type Camera, type Clip, type Marker, type Session } from './types';

export interface NamedMarker {
  marker: Marker;
  /** 1-based number in time order across the session. */
  number: number;
  name: string;
}

export interface PlanClip {
  clip: Clip;
  camera: Camera;
  /** 0-based video track (one per camera). */
  track: number;
  /** Position on the timeline, in frames from its first frame. */
  seqStart: number;
  startMs: number;
  markers: { m: NamedMarker; frame: number }[];
}

export interface Plan {
  rate: Rate;
  drop: boolean;
  name: string;
  width: number;
  height: number;
  /** Timeline start timecode (01:00:00:00) as a frame count. */
  startTcFrames: number;
  durationFrames: number;
  clips: PlanClip[];
  markers: { m: NamedMarker; frame: number }[];
  /** Phone-clock instant of timeline frame 0. */
  originMs: number;
}

export interface PlanResult {
  plans: Plan[];
  named: NamedMarker[];
  /** Markers that landed on no clip of any camera. */
  unplaced: NamedMarker[];
  slowQuickClips: Clip[];
  timings: CameraTiming[];
}

export function nameMarkers(markers: Marker[]): NamedMarker[] {
  return [...markers]
    .sort((a, b) => markerTime(a) - markerTime(b))
    .map((marker, i) => ({ marker, number: i + 1, name: `${marker.tag || 'Mark'} ${i + 1}` }));
}

/** Make frame positions strictly increasing so no two markers share a frame. */
function spread<T extends { frame: number }>(items: T[], max: number): T[] {
  const sorted = [...items].sort((a, b) => a.frame - b.frame);
  let prev = -1;
  const out: T[] = [];
  for (const it of sorted) {
    const frame = Math.max(it.frame, prev + 1);
    if (frame > max) continue;
    out.push({ ...it, frame });
    prev = frame;
  }
  return out;
}

export function buildPlans(session: Session): PlanResult {
  const timings = computeTimings(session);
  const named = nameMarkers(session.markers);
  const slowQuickClips = session.clips.filter((c) => c.slowQuick);
  const placed = new Set<string>();

  const groups = new Map<string, { rate: Rate; items: { cam: CameraTiming; idx: number; t: CameraTiming['clips'][number] }[] }>();
  timings.forEach((cam, idx) => {
    for (const t of cam.clips) {
      if (t.clip.slowQuick) continue;
      const key = rateKey(t.clip.rate);
      if (!groups.has(key)) groups.set(key, { rate: t.clip.rate, items: [] });
      groups.get(key)!.items.push({ cam, idx, t });
    }
  });

  const plans: Plan[] = [];
  for (const { rate, items } of groups.values()) {
    const originMs = Math.min(...items.map((i) => i.t.startMs));
    const drop = canDropFrame(rate.timebase) && rate.ntsc && items.some((i) => i.t.clip.dropFrame);
    const lastEnd = new Map<number, number>();
    const clips: PlanClip[] = [];
    for (const it of [...items].sort((a, b) => a.t.startMs - b.t.startMs)) {
      // Clips of one camera can never overlap; clock rounding must not make them.
      const seqStart = Math.max(Math.round(msToFrames(it.t.startMs - originMs, rate)), lastEnd.get(it.idx) ?? 0);
      lastEnd.set(it.idx, seqStart + it.t.clip.durationFrames);
      const markers = spread(
        named.flatMap((m) => {
          const frame = frameAt(it.t, markerTime(m.marker));
          return frame === null ? [] : [{ m, frame }];
        }),
        it.t.clip.durationFrames - 1,
      );
      markers.forEach((x) => placed.add(x.m.marker.id));
      clips.push({ clip: it.t.clip, camera: it.cam.camera, track: it.idx, seqStart, startMs: it.t.startMs, markers });
    }
    const durationFrames = Math.max(...clips.map((c) => c.seqStart + c.clip.durationFrames));
    const markers = spread(
      named.flatMap((m) => {
        const frame = Math.round(msToFrames(markerTime(m.marker) - originMs, rate));
        return frame >= 0 && frame < durationFrames ? [{ m, frame }] : [];
      }),
      durationFrames - 1,
    );
    const first = clips[0].clip;
    plans.push({
      rate,
      drop,
      name: groups.size > 1 ? `${session.name} (${rateLabel(rate)})` : session.name,
      width: first.width,
      height: first.height,
      startTcFrames: tcToFrames({ hh: 1, mm: 0, ss: 0, ff: 0 }, rate.timebase, drop),
      durationFrames,
      clips,
      markers,
      originMs,
    });
  }
  plans.sort((a, b) => b.clips.length - a.clips.length);
  return { plans, named, unplaced: named.filter((m) => !placed.has(m.marker.id)), slowQuickClips, timings };
}
