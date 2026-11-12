import type { Rate } from './timecode';

export interface Clip {
  id: string;
  cameraId: string;
  /** Media file name as on the card, e.g. C0001.MP4 */
  fileName: string;
  /** Number of frames in the file. */
  durationFrames: number;
  rate: Rate;
  /** Timecode label base written by the camera: 24, 25 or 30. */
  tcBase: number;
  /** File frames per timecode label (1, 2 at 50/59.94p, 4 at 100/119.88p). */
  k: number;
  dropFrame: boolean;
  /** Start timecode as a frame count at the FULL file rate base (what editors display). */
  startFrameFull: number;
  /** Camera clock at record start, as an absolute instant (ms since epoch). 1 s resolution. */
  creationMs: number;
  /** Minutes east of UTC of the camera clock, from the sidecar. */
  creationOffsetMin: number;
  model: string;
  /** Last 16 hex digits of the UMID; constant per camera body. */
  bodyId: string;
  /** Slow & Quick / different capture rate: real time does not map linearly. */
  slowQuick: boolean;
  width: number;
  height: number;
  audioChannels: number;
}

export interface Camera {
  id: string;
  label: string;
  /** Camera clock minus phone clock, in ms. Positive: camera clock is ahead. */
  clockOffsetMs: number;
  /** True once the user has calibrated against the sync slate. */
  calibrated: boolean;
  /** Optional folder where this camera's media will live on the edit machine. */
  mediaPath: string;
}

export interface Marker {
  id: string;
  /** Phone clock at the tap (ms since epoch). */
  tapMs: number;
  /** Look-back applied to the tap, in ms. Effective time = tapMs - preRollMs. */
  preRollMs: number;
  tag: string;
  color: string;
  note: string;
}

export interface Session {
  version: 1;
  id: string;
  name: string;
  createdMs: number;
  preRollMs: number;
  tags: { label: string; color: string }[];
  cameras: Camera[];
  markers: Marker[];
  clips: Clip[];
}

export function markerTime(m: Marker): number {
  return m.tapMs - m.preRollMs;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
