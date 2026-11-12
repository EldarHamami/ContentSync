// Plain marker list for spreadsheets and any other tool.
import { framesToMs, framesToTcString, rateLabel } from '../timecode';
import type { PlanResult } from '../plan';
import { markerTime } from '../types';

function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function buildCsv(result: PlanResult): string {
  const rows: (string | number)[][] = [
    ['Marker', 'Name', 'Tag', 'Note', 'Phone time (marked moment)', 'Camera', 'Clip', 'Frame in clip', 'Seconds in clip', 'Source timecode', 'Timeline timecode', 'Frame rate'],
  ];
  for (const plan of result.plans) {
    const seq = new Map(plan.markers.map((m) => [m.m.marker.id, m.frame] as const));
    for (const c of plan.clips) {
      for (const mk of c.markers) {
        const drop = c.clip.dropFrame && plan.rate.ntsc && plan.rate.timebase % 30 === 0;
        const sf = seq.get(mk.m.marker.id);
        rows.push([
          mk.m.number,
          mk.m.name,
          mk.m.marker.tag,
          mk.m.marker.note,
          clock(markerTime(mk.m.marker)),
          c.camera.label,
          c.clip.fileName,
          mk.frame,
          (framesToMs(mk.frame, plan.rate) / 1000).toFixed(3),
          framesToTcString(c.clip.startFrameFull + mk.frame, plan.rate.timebase, drop),
          sf === undefined ? '' : framesToTcString(plan.startTcFrames + sf, plan.rate.timebase, plan.drop),
          rateLabel(plan.rate),
        ]);
      }
    }
  }
  for (const m of result.unplaced) {
    rows.push([m.number, m.name, m.marker.tag, m.marker.note, clock(markerTime(m.marker)), '', '(no clip was recording)', '', '', '', '', '']);
  }
  rows.sort((a, b) => (a[0] === 'Marker' ? -1 : b[0] === 'Marker' ? 1 : (a[0] as number) - (b[0] as number)));
  // BOM so Excel opens non-Latin notes correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
