import { buildPlans, type PlanResult } from '../plan';
import { rateLabel } from '../timecode';
import type { Session } from '../types';
import { buildCsv } from './csv';
import { buildEdl } from './edl';
import { buildFcpxml } from './fcpxml';
import { buildXmeml } from './xmeml';
import { safeFileName } from './xml';

export interface ExportFile {
  name: string;
  text: string;
  mime: string;
  kind: 'premiere' | 'fcp' | 'edl' | 'csv' | 'session' | 'readme';
}

export function buildExports(session: Session, result: PlanResult = buildPlans(session)): ExportFile[] {
  const base = safeFileName(session.name);
  const files: ExportFile[] = [];
  const multi = result.plans.length > 1;
  for (const plan of result.plans) {
    const suffix = multi ? ` ${rateLabel(plan.rate)}` : '';
    files.push({ name: `${base}${suffix} - Premiere & Resolve.xml`, text: buildXmeml(plan), mime: 'application/xml', kind: 'premiere' });
    files.push({ name: `${base}${suffix} - Final Cut Pro.fcpxml`, text: buildFcpxml(plan), mime: 'application/xml', kind: 'fcp' });
    files.push({ name: `${base}${suffix} - Resolve markers.edl`, text: buildEdl(plan), mime: 'text/plain', kind: 'edl' });
  }
  files.push({ name: `${base} - markers.csv`, text: buildCsv(result), mime: 'text/csv', kind: 'csv' });
  files.push({ name: `${base} - session backup.json`, text: JSON.stringify(session, null, 1), mime: 'application/json', kind: 'session' });
  files.push({ name: 'READ ME.txt', text: README, mime: 'text/plain', kind: 'readme' });
  return files;
}

const README = `ContentSync export
==================

"... - Premiere & Resolve.xml"
  Premiere Pro: File > Import, pick this file. If clips show offline, right-click > Link Media
  and point at the folder holding that camera's clips (do one camera at a time, because every
  Sony card numbers its clips C0001, C0002, ...).
  DaVinci Resolve: File > Import > Timeline, pick this file.
  You get one timeline with each camera on its own track, in sync, with your marks as timeline
  markers and as markers on each clip.

"... - Final Cut Pro.fcpxml"
  Final Cut Pro: File > Import > XML. Use File > Relink Files if the media is offline.

"... - Resolve markers.edl"
  DaVinci Resolve: open the imported timeline (it starts at 01:00:00:00), then right-click it in
  the Media Pool > Timelines > Import > Timeline Markers from EDL.

"... - markers.csv"
  Every mark with clip name, frame and timecode. Opens in any spreadsheet.

"... - session backup.json"
  The whole session. Import it in ContentSync on another device to continue there.
`;
