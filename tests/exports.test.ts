import { describe, expect, it } from 'vitest';
import { parseSonyXml } from '../src/core/sony';
import { buildPlans } from '../src/core/plan';
import { buildExports } from '../src/core/exports';
import { buildXmeml } from '../src/core/exports/xmeml';
import { buildFcpxml, fcpTime } from '../src/core/exports/fcpxml';
import { buildEdl } from '../src/core/exports/edl';
import { buildCsv } from '../src/core/exports/csv';
import { buildZip, crc32 } from '../src/core/exports/zip';
import { fileUrl } from '../src/core/exports/xml';
import { parseTc, tcToFrames } from '../src/core/timecode';
import type { Session } from '../src/core/types';
import { REAL, sidecar } from './fixtures';

const t0 = Date.UTC(2026, 10, 11, 10, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, '+00:00');

export function demo(fps = '25p', tcFps = 25, halfStep = false, start = '00000010'): Session {
  const mkClip = (cam: string, name: string, at: number, frames: number) =>
    parseSonyXml(sidecar({ duration: frames, tcFps, halfStep, start, created: iso(at), fps }), name, cam);
  return {
    version: 1, id: 's', name: 'Dana interview / take "2" & more', createdMs: t0, preRollMs: 5000,
    tags: [],
    cameras: [
      { id: 'a', label: 'Cam A', clockOffsetMs: 0, calibrated: false, mediaPath: '/Volumes/Edit SSD/Shoot/Cam A' },
      { id: 'b', label: 'Cam B', clockOffsetMs: 0, calibrated: false, mediaPath: '' },
    ],
    clips: [mkClip('a', 'C0001M01.XML', t0, 3000), mkClip('a', 'C0002M01.XML', t0 + 200000, 3000), mkClip('b', 'C0001M01.XML', t0 + 20000, 6000)],
    markers: [
      { id: 'm1', tapMs: t0 + 45500, preRollMs: 5000, tag: 'Great quote', color: 'green', note: 'She says "why" & laughs <big>\nsecond line' },
      { id: 'm2', tapMs: t0 + 230500, preRollMs: 0, tag: '', color: 'red', note: 'שלום' },
      { id: 'm3', tapMs: t0 + 150500, preRollMs: 0, tag: 'B-roll', color: 'blue', note: '' },
    ],
  };
}

describe('Premiere / Resolve XML', () => {
  const plan = buildPlans(demo()).plans[0];
  const x = buildXmeml(plan);
  it('has consistent ids and links', () => {
    const ids = [...x.matchAll(/<clipitem id="(clipitem-\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(9);
    for (const ref of x.matchAll(/<linkclipref>(clipitem-\d+)<\/linkclipref>/g)) expect(ids).toContain(ref[1]);
    const defs = [...x.matchAll(/<file id="(file-\d+)">/g)].map((m) => m[1]);
    for (const ref of x.matchAll(/<file id="(file-\d+)"\/>/g)) expect(defs).toContain(ref[1]);
  });
  it('places clips and markers in frames', () => {
    expect(x).toContain('<start>500</start>'); // Cam B starts 20 s after Cam A at 25 fps
    expect(x).toContain('<end>6500</end>');
    // m1: 40 s into Cam A clip 1 = frame 1000; 20 s into Cam B = frame 500.
    expect(x).toMatch(/<name>Great quote 1<\/name>\s*<in>1000<\/in>\s*<out>-1<\/out>/);
    expect(x).toMatch(/<name>Great quote 1<\/name>\s*<in>500<\/in>/);
    expect(x).toContain('&quot;why&quot; &amp; laughs &lt;big&gt;&#10;second line');
    expect(x).toContain('<pathurl>file://localhost/Volumes/Edit%20SSD/Shoot/Cam%20A/C0001.MP4</pathurl>');
    expect(x.match(/<pathurl>/g)).toHaveLength(2);
    expect(x).not.toContain('NaN');
    expect(x).not.toContain('undefined');
  });
  it('writes timecode strings that agree with their frame counts', () => {
    for (const s of [demo(), demo('59.94p', 30, true, '43114805'), demo('23.98p', 24, false, '00535300'), demo('29.97p', 30, false, '59041204'), demo('50p', 25, true, '15570212')]) {
      for (const p of buildPlans(s).plans) {
        const xml = buildXmeml(p);
        const blocks = [...xml.matchAll(/<string>([^<]+)<\/string>\s*<frame>(\d+)<\/frame>\s*<displayformat>(\w+)<\/displayformat>/g)];
        expect(blocks.length).toBeGreaterThan(1);
        for (const b of blocks) {
          const tc = parseTc(b[1])!;
          expect(tc.drop).toBe(b[3] === 'DF');
          expect(tcToFrames(tc, p.rate.timebase, tc.drop)).toBe(+b[2]);
        }
      }
    }
  });
  it('shows the full-rate timecode editors display for 59.94p', () => {
    // Real FX3 clip: camera label 05:48:11;03 at 30 = ;06 at 60.
    const s = demo('59.94p', 30, true, REAL.fx3_5994.start);
    expect(buildXmeml(buildPlans(s).plans[0])).toContain('<string>05:48:11;06</string>');
  });
  it('escapes Windows paths', () => {
    expect(fileUrl('D:\\Shoot\\Cam A', 'C0001.MP4')).toBe('file://localhost/D%3a/Shoot/Cam%20A/C0001.MP4');
  });
});

describe('Final Cut XML', () => {
  it('uses whole-frame rational times', () => {
    expect(fcpTime(0, { timebase: 25, ntsc: false })).toBe('0s');
    expect(fcpTime(10, { timebase: 24, ntsc: true })).toBe('10010/24000s');
    expect(fcpTime(3, { timebase: 25, ntsc: false })).toBe('300/2500s');
    const x = buildFcpxml(buildPlans(demo('23.98p', 24)).plans[0]);
    expect(x).toContain('frameDuration="1001/24000s"');
    expect(x).toContain('name="FFVideoFormat3840x2160p2398"');
    for (const m of x.matchAll(/(?:start|offset|duration)="(\d+)\/24000s"/g)) expect(+m[1] % 1001).toBe(0);
    expect(x.match(/<marker /g)!.length).toBeGreaterThanOrEqual(6);
  });
});

describe('Resolve EDL and CSV', () => {
  const result = buildPlans(demo());
  it('writes Resolve marker lines', () => {
    const edl = buildEdl(result.plans[0]);
    const lines = edl.split('\n');
    expect(lines[0]).toBe('TITLE: Dana interview / take "2" & more');
    expect(lines[1]).toBe('FCM: NON-DROP FRAME');
    expect(lines[3]).toBe('001  001      V     C        01:00:40:00 01:00:40:01 01:00:40:00 01:00:40:01  ');
    expect(lines[4]).toBe('She says "why" & laughs <big> second line |C:ResolveColorGreen |M:Great quote 1 |D:1');
    expect(edl).toContain(' |C:ResolveColorBlue |M:B-roll 2 |D:1');
  });
  it('lists every placement in the CSV', () => {
    const csv = buildCsv(result);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(1 + 2 + 1 + 2); // header + m1 on A and B, m3 on B, m2 on A and B
  });
  it('bundles all formats', () => {
    const files = buildExports(demo());
    expect(files.map((f) => f.kind)).toEqual(['premiere', 'fcp', 'edl', 'csv', 'session', 'readme']);
    expect(files[0].name).toBe('Dana interview take 2 & more - Premiere & Resolve.xml');
    const zip = buildZip(files);
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
