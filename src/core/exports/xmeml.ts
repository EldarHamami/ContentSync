// Final Cut Pro 7 XML (xmeml v4) in the shape Premiere Pro itself exports. Opens in Premiere Pro
// and DaVinci Resolve: one timeline with every camera on its own track, placed in sync, with
// timeline markers and per-clip markers.
import { framesToTcString } from '../timecode';
import type { Plan, PlanClip } from '../plan';
import { esc, fileUrl } from './xml';

function rateXml(timebase: number, ntsc: boolean, ind: string): string {
  return `${ind}<rate>\n${ind}  <timebase>${timebase}</timebase>\n${ind}  <ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc>\n${ind}</rate>\n`;
}

function markerXml(name: string, comment: string, frame: number, ind: string): string {
  return (
    `${ind}<marker>\n${ind}  <comment>${esc(comment)}</comment>\n${ind}  <name>${esc(name)}</name>\n` +
    `${ind}  <in>${frame}</in>\n${ind}  <out>-1</out>\n${ind}</marker>\n`
  );
}

export function buildXmeml(plan: Plan): string {
  const { rate } = plan;
  const R = (ind: string) => rateXml(rate.timebase, rate.ntsc, ind);
  const trackIdx = [...new Set(plan.clips.map((c) => c.track))].sort((a, b) => a - b);
  const byTrack = trackIdx.map((t) => plan.clips.filter((c) => c.track === t).sort((a, b) => a.seqStart - b.seqStart));

  // Stable ids: clip n -> video clipitem-(3n+1), audio clipitem-(3n+2), clipitem-(3n+3).
  const order: PlanClip[] = byTrack.flat();
  const num = new Map(order.map((c, i) => [c.clip.id, i] as const));
  const pos = new Map<string, { v: number; ci: number }>();
  byTrack.forEach((list, v) => list.forEach((c, ci) => pos.set(c.clip.id, { v, ci })));

  const links = (c: PlanClip, ind: string): string => {
    const n = num.get(c.clip.id)!;
    const p = pos.get(c.clip.id)!;
    const link = (id: number, type: string, track: number, group: boolean) =>
      `${ind}<link>\n${ind}  <linkclipref>clipitem-${id}</linkclipref>\n${ind}  <mediatype>${type}</mediatype>\n` +
      `${ind}  <trackindex>${track}</trackindex>\n${ind}  <clipindex>${p.ci + 1}</clipindex>\n` +
      (group ? `${ind}  <groupindex>1</groupindex>\n` : '') +
      `${ind}</link>\n`;
    return (
      link(3 * n + 1, 'video', p.v + 1, false) +
      link(3 * n + 2, 'audio', 2 * p.v + 1, true) +
      link(3 * n + 3, 'audio', 2 * p.v + 2, true)
    );
  };

  const common = (c: PlanClip, ind: string): string =>
    `${ind}<masterclipid>masterclip-${num.get(c.clip.id)! + 1}</masterclipid>\n` +
    `${ind}<name>${esc(c.clip.fileName)}</name>\n${ind}<enabled>TRUE</enabled>\n` +
    `${ind}<duration>${c.clip.durationFrames}</duration>\n` +
    R(ind) +
    `${ind}<start>${c.seqStart}</start>\n${ind}<end>${c.seqStart + c.clip.durationFrames}</end>\n` +
    `${ind}<in>0</in>\n${ind}<out>${c.clip.durationFrames}</out>\n`;

  const fileXml = (c: PlanClip, ind: string): string => {
    const n = num.get(c.clip.id)! + 1;
    const drop = c.clip.dropFrame && rate.ntsc && rate.timebase % 30 === 0;
    let s = `${ind}<file id="file-${n}">\n${ind}  <name>${esc(c.clip.fileName)}</name>\n`;
    if (c.camera.mediaPath.trim()) s += `${ind}  <pathurl>${esc(fileUrl(c.camera.mediaPath.trim(), c.clip.fileName))}</pathurl>\n`;
    s += R(ind + '  ') + `${ind}  <duration>${c.clip.durationFrames}</duration>\n`;
    s +=
      `${ind}  <timecode>\n` +
      R(ind + '    ') +
      `${ind}    <string>${framesToTcString(c.clip.startFrameFull, rate.timebase, drop)}</string>\n` +
      `${ind}    <frame>${c.clip.startFrameFull}</frame>\n` +
      `${ind}    <displayformat>${drop ? 'DF' : 'NDF'}</displayformat>\n${ind}  </timecode>\n`;
    s +=
      `${ind}  <media>\n${ind}    <video>\n${ind}      <samplecharacteristics>\n` +
      R(ind + '        ') +
      `${ind}        <width>${c.clip.width}</width>\n${ind}        <height>${c.clip.height}</height>\n` +
      `${ind}        <anamorphic>FALSE</anamorphic>\n${ind}        <pixelaspectratio>square</pixelaspectratio>\n` +
      `${ind}        <fielddominance>none</fielddominance>\n${ind}      </samplecharacteristics>\n${ind}    </video>\n` +
      `${ind}    <audio>\n${ind}      <samplecharacteristics>\n${ind}        <depth>16</depth>\n` +
      `${ind}        <samplerate>48000</samplerate>\n${ind}      </samplecharacteristics>\n` +
      `${ind}      <channelcount>2</channelcount>\n${ind}    </audio>\n${ind}  </media>\n${ind}</file>\n`;
    return s;
  };

  let x = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">\n`;
  x += `  <sequence id="sequence-1" explodedTracks="true">\n    <duration>${plan.durationFrames}</duration>\n`;
  x += R('    ') + `    <name>${esc(plan.name)}</name>\n    <media>\n      <video>\n        <format>\n          <samplecharacteristics>\n`;
  x +=
    R('            ') +
    `            <width>${plan.width}</width>\n            <height>${plan.height}</height>\n` +
    `            <anamorphic>FALSE</anamorphic>\n            <pixelaspectratio>square</pixelaspectratio>\n` +
    `            <fielddominance>none</fielddominance>\n            <colordepth>24</colordepth>\n` +
    `          </samplecharacteristics>\n        </format>\n`;

  for (const list of byTrack) {
    x += `        <track>\n`;
    for (const c of list) {
      const n = num.get(c.clip.id)!;
      x += `          <clipitem id="clipitem-${3 * n + 1}">\n` + common(c, '            ');
      x += `            <alphatype>none</alphatype>\n            <pixelaspectratio>square</pixelaspectratio>\n            <anamorphic>FALSE</anamorphic>\n`;
      x += fileXml(c, '            ');
      for (const mk of c.markers) x += markerXml(mk.m.name, mk.m.marker.note, mk.frame, '            ');
      x += links(c, '            ') + `          </clipitem>\n`;
    }
    x += `          <enabled>TRUE</enabled>\n          <locked>FALSE</locked>\n        </track>\n`;
  }
  x += `      </video>\n      <audio>\n        <numOutputChannels>2</numOutputChannels>\n        <format>\n          <samplecharacteristics>\n`;
  x += `            <depth>16</depth>\n            <samplerate>48000</samplerate>\n          </samplecharacteristics>\n        </format>\n`;
  x += `        <outputs>\n`;
  for (const ch of [1, 2]) {
    x += `          <group>\n            <index>${ch}</index>\n            <numchannels>1</numchannels>\n            <downmix>0</downmix>\n`;
    x += `            <channel>\n              <index>${ch}</index>\n            </channel>\n          </group>\n`;
  }
  x += `        </outputs>\n`;
  for (const list of byTrack) {
    for (const ch of [0, 1]) {
      x += `        <track currentExplodedTrackIndex="${ch}" totalExplodedTrackCount="2" premiereTrackType="Stereo">\n`;
      for (const c of list) {
        const n = num.get(c.clip.id)!;
        x += `          <clipitem id="clipitem-${3 * n + 2 + ch}" premiereChannelType="stereo">\n` + common(c, '            ');
        x += `            <file id="file-${n + 1}"/>\n            <sourcetrack>\n              <mediatype>audio</mediatype>\n`;
        x += `              <trackindex>${ch + 1}</trackindex>\n            </sourcetrack>\n`;
        x += links(c, '            ') + `          </clipitem>\n`;
      }
      x += `          <enabled>TRUE</enabled>\n          <locked>FALSE</locked>\n          <outputchannelindex>${ch + 1}</outputchannelindex>\n        </track>\n`;
    }
  }
  x += `      </audio>\n    </media>\n    <timecode>\n` + R('      ');
  x += `      <string>${framesToTcString(plan.startTcFrames, rate.timebase, plan.drop)}</string>\n`;
  x += `      <frame>${plan.startTcFrames}</frame>\n      <displayformat>${plan.drop ? 'DF' : 'NDF'}</displayformat>\n    </timecode>\n`;
  for (const mk of plan.markers) x += markerXml(mk.m.name, mk.m.marker.note, mk.frame, '    ');
  x += `  </sequence>\n</xmeml>\n`;
  return x;
}
