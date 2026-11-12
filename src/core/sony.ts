// Parser for Sony "NonRealTimeMeta" clip metadata (the CxxxxM01.XML sidecar that FX3 / A7S III
// write next to every clip, and that is also embedded inside the MP4).
import { parseSonyFps, tcToFrames, type Rate } from './timecode';
import { uid, type Clip } from './types';

export class SonyParseError extends Error {}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

/** All opening tags with the given local name (namespace prefixes tolerated). */
function tags(xml: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])([^>]*)>`, 'g');
  const out: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(attrs(m[1]));
  return out;
}

const bcd = (b: number) => (b >> 4) * 10 + (b & 0x0f);

export interface LtcLabel {
  hh: number;
  mm: number;
  ss: number;
  ff: number;
  drop: boolean;
  /** True when this is the second file frame sharing a timecode label (50p / 59.94p). */
  secondOfPair: boolean;
}

/** Decode an LtcChange value: 8 hex digits, bytes in the order FF SS MM HH, BCD with flag bits. */
export function decodeLtc(value: string, tcBase: number): LtcLabel {
  const v = value.trim().padStart(8, '0');
  if (!/^[0-9a-fA-F]{8}$/.test(v)) throw new SonyParseError(`Bad timecode value "${value}"`);
  const b = [0, 2, 4, 6].map((i) => parseInt(v.slice(i, i + 2), 16));
  return {
    ff: bcd(b[0] & 0x3f),
    drop: (b[0] & 0x40) !== 0,
    ss: bcd(b[1] & 0x7f),
    mm: bcd(b[2] & 0x7f),
    hh: bcd(b[3] & 0x3f),
    secondOfPair: tcBase === 25 ? (b[3] & 0x80) !== 0 : (b[1] & 0x80) !== 0,
  };
}

/** Parse an ISO date-time with a numeric offset into an absolute instant. */
export function parseSonyDate(s: string): { ms: number; offsetMin: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
  if (!m) return null;
  let offsetMin = 0;
  if (m[7] && m[7] !== 'Z') {
    const sign = m[7][0] === '-' ? -1 : 1;
    const digits = m[7].slice(1).replace(':', '');
    offsetMin = sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2), 10));
  }
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - offsetMin * 60000;
  return { ms, offsetMin };
}

/** Turn a sidecar name (C0001M01.XML) or media name into the media file name (C0001.MP4). */
export function mediaNameFromSource(sourceName: string): string {
  const base = sourceName.replace(/^.*[\\/]/, '');
  const side = /^(.*)M\d{2}\.xml$/i.exec(base);
  if (side) return `${side[1]}.MP4`;
  return base;
}

export function parseSonyXml(xml: string, sourceName: string, cameraId: string): Clip {
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (!/<(?:[\w.-]+:)?NonRealTimeMeta[\s>]/.test(xml)) {
    throw new SonyParseError('Not a Sony clip metadata file (no NonRealTimeMeta element)');
  }
  const duration = parseInt(tags(xml, 'Duration')[0]?.value ?? '', 10);
  if (!Number.isFinite(duration) || duration <= 0) throw new SonyParseError('Missing clip duration');

  const table = tags(xml, 'LtcChangeTable')[0];
  const changes = tags(xml, 'LtcChange');
  const frame = tags(xml, 'VideoFrame')[0] ?? {};
  const formatRate = parseSonyFps(frame.formatFps ?? '');
  const captureRate = parseSonyFps(frame.captureFps ?? frame.formatFps ?? '');
  const tcBase = parseInt(table?.tcFps ?? '', 10);

  let rate: Rate | null = formatRate;
  if (!rate && Number.isFinite(tcBase)) rate = { timebase: tcBase, ntsc: false };
  if (!rate) throw new SonyParseError('Missing frame rate');
  const base = Number.isFinite(tcBase) && tcBase > 0 ? tcBase : rate.timebase;
  const k = Math.max(1, Math.round(rate.timebase / base));

  let dropFrame = false;
  let startFrameFull = 0;
  const start = changes.find((c) => c.frameCount === '0') ?? changes.find((c) => c.status === 'increment');
  if (start?.value) {
    const l = decodeLtc(start.value, base);
    dropFrame = l.drop;
    // Label count in the camera's base, then scaled to the full file rate (editors show that).
    const labelFrames = tcToFrames(l, base, l.drop);
    startFrameFull = labelFrames * k + (l.secondOfPair ? 1 : 0);
  }

  const created = parseSonyDate(tags(xml, 'CreationDate')[0]?.value ?? '');
  if (!created) throw new SonyParseError('Missing recording date');

  const layout = tags(xml, 'VideoLayout')[0] ?? {};
  const device = tags(xml, 'Device')[0] ?? {};
  const mode = tags(xml, 'RecordingMode')[0] ?? {};
  const umid = tags(xml, 'TargetMaterial')[0]?.umidRef ?? '';
  const audio = parseInt(tags(xml, 'AudioFormat')[0]?.numOfChannel ?? '', 10);
  const slowQuick =
    /slow|quick/i.test(mode.type ?? '') ||
    (!!captureRate && !!formatRate && (captureRate.timebase !== formatRate.timebase || captureRate.ntsc !== formatRate.ntsc));

  return {
    id: uid(),
    cameraId,
    fileName: mediaNameFromSource(sourceName),
    durationFrames: duration,
    rate,
    tcBase: base,
    k,
    dropFrame,
    startFrameFull,
    creationMs: created.ms,
    creationOffsetMin: created.offsetMin,
    model: device.modelName ?? '',
    bodyId: umid.length >= 16 ? umid.slice(-16).toUpperCase() : '',
    slowQuick,
    width: parseInt(layout.pixel ?? '', 10) || 1920,
    height: parseInt(layout.numOfVerticalLine ?? '', 10) || 1080,
    audioChannels: Number.isFinite(audio) && audio > 0 ? audio : 2,
  };
}

const MODELS: Record<string, string> = {
  'ILME-FX3': 'FX3',
  'ILME-FX3A': 'FX3',
  'ILCE-7SM3': 'A7S III',
  'ILME-FX30': 'FX30',
  'ILME-FX6': 'FX6',
};
export function friendlyModel(model: string): string {
  return MODELS[model] ?? model;
}
