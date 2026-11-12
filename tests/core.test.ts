import { describe, expect, it } from 'vitest';
import { decodeLtc, mediaNameFromSource, parseSonyDate, parseSonyXml } from '../src/core/sony';
import { framesToTc, framesToTcString, parseSonyFps, tcToFrames, framesToMs } from '../src/core/timecode';
import { calibrateOffset, computeTimings, placeMarkers } from '../src/core/sync';
import { buildPlans } from '../src/core/plan';
import { extractSonyXmlFromMp4 } from '../src/core/mp4';
import type { Clip, Marker, Session } from '../src/core/types';
import { REAL, sidecar } from './fixtures';

describe('timecode', () => {
  it('parses Sony frame-rate strings', () => {
    expect(parseSonyFps('23.98p')).toEqual({ timebase: 24, ntsc: true });
    expect(parseSonyFps('25p')).toEqual({ timebase: 25, ntsc: false });
    expect(parseSonyFps('59.94p')).toEqual({ timebase: 60, ntsc: true });
    expect(parseSonyFps('119.88p')).toEqual({ timebase: 120, ntsc: true });
    expect(parseSonyFps('24p')).toEqual({ timebase: 24, ntsc: false });
  });
  it('matches Apple reference drop-frame values', () => {
    // Apple FCP7 XML reference: 02:42:35;14 DF at 29.97 is frame 292372.
    expect(tcToFrames({ hh: 2, mm: 42, ss: 35, ff: 14 }, 30, true)).toBe(292372);
    expect(tcToFrames({ hh: 1, mm: 0, ss: 0, ff: 0 }, 30, true)).toBe(107892);
    expect(tcToFrames({ hh: 1, mm: 0, ss: 0, ff: 0 }, 60, true)).toBe(215784);
    expect(tcToFrames({ hh: 10, mm: 15, ss: 30, ff: 0 }, 25, false)).toBe(923250);
  });
  it('round-trips every kind of timecode', () => {
    for (const [tb, drop] of [[24, false], [25, false], [30, false], [30, true], [50, false], [60, true], [120, true]] as const) {
      for (const f of [0, 1, tb * 60 - 1, tb * 60, tb * 60 + 1, tb * 600 - 3, tb * 600, 1234567, tb * 3600 * 23 + 777]) {
        const tc = framesToTc(f, tb, drop);
        expect(tcToFrames(tc, tb, drop), `${tb} ${drop} ${f}`).toBe(f);
        if (drop && tc.ss === 0 && tc.mm % 10 !== 0) expect(tc.ff).toBeGreaterThanOrEqual(tb / 15);
      }
    }
    expect(framesToTcString(292372, 30, true)).toBe('02:42:35;14');
    expect(framesToTcString(1800, 30, true)).toBe('00:01:00;02');
    expect(framesToTcString(3600, 60, true)).toBe('00:01:00;04');
  });
});

describe('Sony sidecar', () => {
  it('decodes real timecode values', () => {
    expect(decodeLtc('00535300', 24)).toMatchObject({ hh: 0, mm: 53, ss: 53, ff: 0, drop: false });
    expect(decodeLtc('43114805', 30)).toMatchObject({ hh: 5, mm: 48, ss: 11, ff: 3, drop: true, secondOfPair: false });
    expect(decodeLtc('44A64905', 30)).toMatchObject({ hh: 5, mm: 49, ss: 26, ff: 4, drop: true, secondOfPair: true });
    expect(decodeLtc('57C21909', 30)).toMatchObject({ hh: 9, mm: 19, ss: 42, ff: 17, secondOfPair: true });
    expect(decodeLtc('12590292', 25)).toMatchObject({ hh: 12, mm: 2, ss: 59, ff: 12, secondOfPair: true });
    expect(decodeLtc('59041204', 30)).toMatchObject({ hh: 4, mm: 12, ss: 4, ff: 19, drop: true });
  });

  // For every real file: start label + (duration - 1) frames must land exactly on the end label.
  for (const [name, o] of Object.entries(REAL)) {
    it(`start + duration reaches the recorded end timecode: ${name}`, () => {
      const clip = parseSonyXml(sidecar(o), 'C0001M01.XML', 'cam');
      const end = decodeLtc(o.end, o.tcFps);
      const endFull = tcToFrames(end, o.tcFps, end.drop) * clip.k;
      const last = clip.startFrameFull + clip.durationFrames - 1;
      // Same timecode label as the camera wrote for the last frame.
      expect(Math.floor(last / clip.k) * clip.k).toBe(endFull);
      expect(clip.fileName).toBe('C0001.MP4');
    });
  }

  it('reads the fields the app needs', () => {
    const c = parseSonyXml(sidecar(REAL.fx3_5994), '20221213_FX3_2724M01.XML', 'a');
    expect(c).toMatchObject({ fileName: '20221213_FX3_2724.MP4', durationFrames: 4500, k: 2, tcBase: 30, dropFrame: true, model: 'ILME-FX3', width: 3840, height: 2160, slowQuick: false, bodyId: 'C4AC59FFFEA88E27' });
    expect(c.rate).toEqual({ timebase: 60, ntsc: true });
    expect(c.creationMs).toBe(Date.UTC(2022, 11, 13, 7, 48, 35));
    expect(framesToTcString(c.startFrameFull, 60, true)).toBe('05:48:11;06');
    expect(parseSonyXml(sidecar(REAL.a7m3_120), 'x.xml', 'a').k).toBe(4);
    expect(parseSonyXml(sidecar(REAL.rx10_sq), 'x.xml', 'a').slowQuick).toBe(true);
    expect(() => parseSonyXml('<foo/>', 'x.xml', 'a')).toThrow();
  });
  it('parses dates with offsets as absolute instants', () => {
    expect(parseSonyDate('2025-02-05T17:11:22+01:00')!.ms).toBe(Date.UTC(2025, 1, 5, 16, 11, 22));
    expect(parseSonyDate('2020-12-29T19:01:18-05:00')!.ms).toBe(Date.UTC(2020, 11, 30, 0, 1, 18));
    expect(mediaNameFromSource('PRIVATE/M4ROOT/CLIP/A001C003_230101ABM01.XML')).toBe('A001C003_230101AB.MP4');
  });
  it('finds the XML embedded in an MP4', async () => {
    const enc = new TextEncoder();
    const box = (type: string, body: Uint8Array) => {
      const b = new Uint8Array(8 + body.length);
      new DataView(b.buffer).setUint32(0, b.length);
      b.set(enc.encode(type), 4);
      b.set(body, 8);
      return b;
    };
    const xml = sidecar(REAL.zve10_25);
    const meta = box('meta', new Uint8Array([0, 0, 0, 0, ...box('xml ', new Uint8Array([0, 0, 0, 0, ...enc.encode(xml)]))]));
    const parts = [box('ftyp', new Uint8Array(12)), box('mdat', new Uint8Array(5000)), box('moov', new Uint8Array(300)), meta];
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let p = 0;
    for (const x of parts) { all.set(x, p); p += x.length; }
    const reads: number[] = [];
    const got = await extractSonyXmlFromMp4({ size: all.length, read: async (s, e) => { reads.push(e - s); return all.slice(s, e); } });
    expect(got).toBe(xml);
    expect(parseSonyXml(got!, 'C1453.MP4', 'a').durationFrames).toBe(3012);
  });
});

function session(clips: Clip[], markers: Marker[], offsets: Record<string, number> = {}): Session {
  const ids = [...new Set(clips.map((c) => c.cameraId))];
  return {
    version: 1, id: 's', name: 'Test', createdMs: 0, preRollMs: 0, tags: [],
    cameras: ids.map((id) => ({ id, label: id.toUpperCase(), clockOffsetMs: offsets[id] ?? 0, calibrated: false, mediaPath: '' })),
    markers, clips,
  };
}
const mk = (id: string, tapMs: number, preRollMs = 0): Marker => ({ id, tapMs, preRollMs, tag: '', color: 'red', note: '' });

describe('sync', () => {
  const t0 = Date.UTC(2026, 10, 11, 10, 0, 0);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+00:00');
  const clip25 = (cam: string, name: string, startMs: number, frames: number, tc: string) =>
    parseSonyXml(sidecar({ duration: frames, tcFps: 25, start: tc, created: iso(startMs), fps: '25p' }), name, cam);

  it('places a mark on the right frame of the right clip', () => {
    const a = clip25('a', 'C0001M01.XML', t0, 25 * 600, '00000001');
    const s = session([a], [mk('m', t0 + 500 + 60000, 0), mk('late', t0 + 700000)]);
    const p = placeMarkers(s);
    expect(p).toHaveLength(1);
    expect(p[0].frame).toBe(1500);
  });

  it('applies the look-back and the camera clock offset', () => {
    const a = clip25('a', 'C0001M01.XML', t0, 25 * 600, '00000001');
    // Camera clock is 10 s ahead of the phone: the clip really started at t0 - 10 s on the phone clock.
    const s = session([a], [mk('m', t0 + 500 - 10000 + 65000, 5000)], { a: 10000 });
    expect(placeMarkers(s)[0].frame).toBe(1500);
  });

  it('detects free-run timecode and uses it for sub-second placement', () => {
    // Free run at 25p: timecode advances with real time between clips.
    const tcOf = (ms: number) => { const f = Math.round((ms - t0) / 40) + 25 * 3600; const t = framesToTc(f, 25, false); const b = (n: number) => n.toString().padStart(2, '0'); return b(t.ff) + b(t.ss) + b(t.mm) + b(t.hh); };
    const starts = [t0 + 120, t0 + 95_640, t0 + 300_880];
    const clips = starts.map((ms, i) => clip25('a', `C000${i + 1}M01.XML`, Math.floor(ms / 1000) * 1000, 25 * 60, tcOf(ms)));
    const cam = computeTimings(session(clips, []))[0];
    expect(cam.freeRun).toBe(true);
    cam.clips.forEach((t, i) => expect(Math.abs(t.startMs - starts[i])).toBeLessThan(150));
    // Rec run: timecode continues from the previous clip regardless of the pause.
    const rr = [clip25('a', 'C0001M01.XML', t0, 1500, '00000001'), clip25('a', 'C0002M01.XML', t0 + 200000, 1500, '00000101')];
    expect(computeTimings(session(rr, []))[0].freeRun).toBe(false);
  });

  it('calibrates a camera from a filmed slate', () => {
    const a = clip25('a', 'C0001M01.XML', t0, 25 * 600, '00000001');
    const s = session([a], []);
    // Frame 250 (10 s in) shows the phone clock reading t0 - 3 s + 10 s: camera clock is 3.5 s ahead.
    const off = calibrateOffset(s, a, 250, t0 + 500 - 3500 + 10000);
    expect(off).toBeCloseTo(3500, 5);
    s.cameras[0].clockOffsetMs = off;
    expect(computeTimings(s)[0].clips[0].startMs).toBeCloseTo(t0 + 500 - 3500, 5);
  });

  it('lays two cameras out in sync and never overlaps one camera with itself', () => {
    const a1 = clip25('a', 'C0001M01.XML', t0, 1500, '00000001');
    const a2 = clip25('a', 'C0002M01.XML', t0 + 60000, 1500, '00000101'); // back to back
    const b1 = clip25('b', 'C0001M01.XML', t0 + 10000, 2000, '00000005');
    const r = buildPlans(session([a1, a2, b1], [mk('m1', t0 + 20500), mk('m2', t0 + 20500), mk('x', t0 - 99999)]));
    expect(r.plans).toHaveLength(1);
    const plan = r.plans[0];
    const pa = plan.clips.filter((c) => c.camera.id === 'a');
    expect(pa[1].seqStart).toBeGreaterThanOrEqual(pa[0].seqStart + 1500);
    expect(plan.clips.find((c) => c.camera.id === 'b')!.seqStart).toBe(250);
    expect(plan.markers.map((m) => m.frame)).toEqual([500, 501]);
    expect(r.unplaced.map((m) => m.marker.id)).toEqual(['x']);
    expect(framesToMs(plan.durationFrames, plan.rate)).toBeGreaterThan(110000);
  });
});
