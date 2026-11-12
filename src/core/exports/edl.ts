// DaVinci Resolve marker EDL ("Timelines > Import > Timeline Markers from EDL").
// Timecodes are timeline timecodes; they line up with the exported timeline, which starts at 01:00:00:00.
import { framesToTcString } from '../timecode';
import type { Plan } from '../plan';

const RESOLVE_COLORS: Record<string, string> = {
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  yellow: 'Yellow',
  purple: 'Purple',
  cyan: 'Cyan',
  pink: 'Pink',
};

function clean(s: string): string {
  return s.replace(/[|\r\n\t]+/g, ' ').trim();
}

export function buildEdl(plan: Plan): string {
  const tc = (f: number) => framesToTcString(plan.startTcFrames + f, plan.rate.timebase, plan.drop);
  let out = `TITLE: ${clean(plan.name)}\nFCM: ${plan.drop ? 'DROP FRAME' : 'NON-DROP FRAME'}\n\n`;
  plan.markers.slice(0, 999).forEach((mk, i) => {
    const a = tc(mk.frame);
    const b = tc(mk.frame + 1);
    let name = clean(mk.m.name);
    if (/^\d/.test(name)) name = '_' + name;
    const color = RESOLVE_COLORS[mk.m.marker.color] ?? 'Blue';
    out += `${String(i + 1).padStart(3, '0')}  001      V     C        ${a} ${b} ${a} ${b}  \n`;
    out += `${clean(mk.m.marker.note)} |C:ResolveColor${color} |M:${name} |D:1\n\n`;
  });
  return out;
}
