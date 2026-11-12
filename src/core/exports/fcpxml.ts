// FCPXML 1.9 for Final Cut Pro. Final Cut reads Sony XAVC S MP4 clips as starting at 00:00:00:00,
// so every time here is counted from the first frame of the file, not from camera timecode.
import type { Plan } from '../plan';
import type { Rate } from '../timecode';
import { esc } from './xml';

/** n frames as an FCPXML rational time. */
export function fcpTime(frames: number, r: Rate): string {
  if (frames === 0) return '0s';
  return r.ntsc ? `${frames * 1001}/${r.timebase * 1000}s` : `${frames * 100}/${r.timebase * 100}s`;
}

function formatName(w: number, h: number, r: Rate): string | null {
  const suffix: Record<string, string> = { '24n': '2398', '24': '24', '25': '25', '30n': '2997', '30': '30', '50': '50', '60n': '5994', '60': '60' };
  const s = suffix[`${r.timebase}${r.ntsc ? 'n' : ''}`];
  if (!s) return null;
  if (w === 1920 && h === 1080) return `FFVideoFormat1080p${s}`;
  if ((w === 3840 || w === 4096) && h === 2160) return `FFVideoFormat${w}x2160p${s}`;
  return null;
}

export function buildFcpxml(plan: Plan): string {
  const { rate } = plan;
  const T = (f: number) => fcpTime(f, rate);
  const one = T(1);
  const fname = formatName(plan.width, plan.height, rate);
  const tcFormat = plan.drop ? 'DF' : 'NDF';
  const marker = (name: string, note: string, frame: number, ind: string) =>
    `${ind}<marker start="${T(frame)}" duration="${one}" value="${esc(name)}"${note ? ` note="${esc(note)}"` : ''}/>\n`;

  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9">\n  <resources>\n`;
  x += `    <format id="r1"${fname ? ` name="${fname}"` : ''} frameDuration="${one}" width="${plan.width}" height="${plan.height}"/>\n`;
  plan.clips.forEach((c, i) => {
    const folder = c.camera.mediaPath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const src = folder
      ? (/^\//.test(folder) || /^[A-Za-z]:/.test(folder) ? 'file:///' : './') +
        [...folder.split('/').filter(Boolean), c.clip.fileName].map(encodeURIComponent).join('/')
      : './' + encodeURIComponent(c.clip.fileName);
    x +=
      `    <asset id="a${i + 1}" name="${esc(c.clip.fileName.replace(/\.[^.]+$/, ''))}" start="0s" duration="${T(c.clip.durationFrames)}" ` +
      `hasVideo="1" format="r1" hasAudio="1" videoSources="1" audioSources="1" audioChannels="2" audioRate="48000">\n` +
      `      <media-rep kind="original-media" src="${esc(src)}"/>\n    </asset>\n`;
  });
  x += `  </resources>\n  <library>\n    <event name="${esc(plan.name)}">\n`;
  plan.clips.forEach((c, i) => {
    x += `      <asset-clip ref="a${i + 1}" name="${esc(`${c.camera.label} ${c.clip.fileName.replace(/\.[^.]+$/, '')}`)}" start="0s" duration="${T(c.clip.durationFrames)}" format="r1" tcFormat="${tcFormat}">\n`;
    for (const mk of c.markers) x += marker(mk.m.name, mk.m.marker.note, mk.frame, '        ');
    x += `      </asset-clip>\n`;
  });
  x += `      <project name="${esc(plan.name)} - synced">\n`;
  x += `        <sequence format="r1" duration="${T(plan.durationFrames)}" tcStart="0s" tcFormat="${tcFormat}" audioLayout="stereo" audioRate="48k">\n          <spine>\n`;
  // One gap spans the whole timeline; every camera's clips hang off it on their own lane.
  x += `            <gap name="Timeline" offset="0s" start="0s" duration="${T(plan.durationFrames)}">\n`;
  plan.clips.forEach((c, i) => {
    x += `              <asset-clip ref="a${i + 1}" lane="${c.track + 1}" name="${esc(`${c.camera.label} ${c.clip.fileName.replace(/\.[^.]+$/, '')}`)}" offset="${T(c.seqStart)}" start="0s" duration="${T(c.clip.durationFrames)}" tcFormat="${tcFormat}">\n`;
    for (const mk of c.markers) x += marker(mk.m.name, mk.m.marker.note, mk.frame, '                ');
    x += `              </asset-clip>\n`;
  });
  for (const mk of plan.markers) x += marker(mk.m.name, mk.m.marker.note, mk.frame, '              ');
  x += `            </gap>\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n`;
  return x;
}
