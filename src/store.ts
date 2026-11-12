// Sessions live in localStorage: tiny, synchronous, written on every tap.
import { uid, type Session } from './core/types';

const PREFIX = 'contentsync:';
const INDEX = PREFIX + 'index';

export interface SessionSummary {
  id: string;
  name: string;
  createdMs: number;
  markers: number;
  clips: number;
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function listSessions(): SessionSummary[] {
  return (read<SessionSummary[]>(INDEX) ?? []).sort((a, b) => b.createdMs - a.createdMs);
}

export function loadSession(id: string): Session | null {
  return read<Session>(PREFIX + 's:' + id);
}

/** Returns false when the browser refused to store (private mode, storage full). */
export function saveSession(s: Session): boolean {
  try {
    localStorage.setItem(PREFIX + 's:' + s.id, JSON.stringify(s));
    const rest = (read<SessionSummary[]>(INDEX) ?? []).filter((x) => x.id !== s.id);
    rest.push({ id: s.id, name: s.name, createdMs: s.createdMs, markers: s.markers.length, clips: s.clips.length });
    localStorage.setItem(INDEX, JSON.stringify(rest));
    return true;
  } catch {
    return false;
  }
}

export function deleteSession(id: string): void {
  try {
    localStorage.removeItem(PREFIX + 's:' + id);
    localStorage.setItem(INDEX, JSON.stringify((read<SessionSummary[]>(INDEX) ?? []).filter((x) => x.id !== id)));
  } catch {
    /* nothing to do */
  }
}

export const DEFAULT_TAGS = [
  { label: 'Great quote', color: 'green' },
  { label: 'Emotion', color: 'purple' },
  { label: 'B-roll idea', color: 'blue' },
  { label: 'Redo', color: 'yellow' },
];

export function newSession(name: string, cameraCount: number): Session {
  return {
    version: 1,
    id: uid(),
    name: name.trim() || 'Interview',
    createdMs: Date.now(),
    preRollMs: 5000,
    tags: DEFAULT_TAGS,
    cameras: Array.from({ length: Math.min(4, Math.max(1, cameraCount)) }, (_, i) => newCamera(i)),
    markers: [],
    clips: [],
  };
}

export function newCamera(index: number) {
  return { id: uid(), label: `Cam ${'ABCD'[index] ?? index + 1}`, clockOffsetMs: 0, calibrated: false, mediaPath: '' };
}

/** Validate and adopt a session backup file. A fresh id avoids clobbering an existing session. */
export function importSessionJson(text: string): Session {
  const s = JSON.parse(text) as Session;
  if (!s || s.version !== 1 || !Array.isArray(s.markers) || !Array.isArray(s.cameras) || !Array.isArray(s.clips)) {
    throw new Error('This is not a ContentSync session backup.');
  }
  const existing = loadSession(s.id);
  if (existing) return { ...s, id: uid(), name: `${s.name} (imported)` };
  return s;
}
