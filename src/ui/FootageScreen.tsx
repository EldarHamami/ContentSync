import { useMemo, useState } from 'preact/hooks';
import { buildPlans } from '../core/plan';
import { buildExports, type ExportFile } from '../core/exports';
import { safeFileName } from '../core/exports/xml';
import { friendlyModel } from '../core/sony';
import { calibrateOffset, describeAccuracy, type CameraTiming } from '../core/sync';
import { framesToMs, formatElapsed, rateLabel } from '../core/timecode';
import { markerTime, type Camera, type Clip, type Session } from '../core/types';
import { canPickFolder, importFromFiles, importFromFolder, isAppleTouch, saveFile, saveToFolder, saveZip, type ImportResult } from '../platform';
import { newCamera } from '../store';
import { clockText } from './MarkScreen';

interface Props {
  session: Session;
  update: (s: Session) => void;
  onBack: () => void;
  onHome: () => void;
}

export function FootageScreen({ session, update, onBack, onHome }: Props) {
  const result = useMemo(() => buildPlans(session), [session]);
  const files = useMemo(() => buildExports(session, result), [session, result]);
  const [message, setMessage] = useState('');
  const [calibrating, setCalibrating] = useState<Camera | null>(null);
  const [showing, setShowing] = useState<ExportFile | null>(null);

  const placedCount = session.markers.length - result.unplaced.length;
  const hasClips = session.clips.length > 0;

  const addClips = (cameraId: string, r: ImportResult | null) => {
    if (!r) return;
    const key = (c: Clip) => `${c.cameraId}|${c.fileName}|${c.creationMs}`;
    const seen = new Set(session.clips.map(key));
    const fresh = r.clips.filter((c) => !seen.has(key(c)) && seen.add(key(c)));
    update({ ...session, clips: [...session.clips, ...fresh] });
    const cam = session.cameras.find((c) => c.id === cameraId)?.label ?? 'camera';
    const parts = [`Added ${fresh.length} clip${fresh.length === 1 ? '' : 's'} to ${cam}.`];
    if (r.clips.length > fresh.length) parts.push(`${r.clips.length - fresh.length} were already there.`);
    if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join('; ')}.`);
    if (r.clips.length === 0 && r.skipped.length === 0) parts.push('No Sony clip files found. Pick the files ending in M01.XML from PRIVATE/M4ROOT/CLIP on the card.');
    setMessage(parts.join(' '));
  };

  const setCamera = (id: string, patch: Partial<Camera>) =>
    update({ ...session, cameras: session.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const run = async (fn: () => Promise<string | void | null>) => {
    try {
      const r = await fn();
      if (typeof r === 'string') setMessage(r);
    } catch (e) {
      setMessage(`That did not work: ${e instanceof Error ? e.message : 'unknown error'}.`);
    }
  };

  const label: Record<ExportFile['kind'], [string, string]> = {
    premiere: ['Premiere Pro / DaVinci Resolve', 'Synced timeline with markers (.xml)'],
    fcp: ['Final Cut Pro', 'Synced timeline with markers (.fcpxml)'],
    edl: ['Resolve marker list', 'Timeline markers with colours (.edl)'],
    csv: ['Spreadsheet', 'Every mark with clip and timecode (.csv)'],
    session: ['Session backup', 'Continue on another device (.json)'],
    readme: ['Instructions', 'How to import each file'],
  };

  return (
    <div class="page">
      <div class="topbar">
        <button class="quiet" onClick={onBack}>‹ Mark</button>
        <span class="title" dir="auto">{session.name}</span>
        <button class="quiet" onClick={onHome}>Shoots</button>
      </div>

      <section class="card">
        <div class="row">
          <h2 class="grow">Marks on footage</h2>
          {hasClips && <span class={`pill ${result.unplaced.length ? 'warn' : 'ok'}`}>{placedCount} of {session.markers.length} placed</span>}
        </div>
        {!hasClips ? (
          <p class="muted small">
            {session.markers.length} marks saved. Add each camera's clips below to place them. You need the small files ending in <span class="mono">M01.XML</span> that sit next to every clip in <span class="mono">PRIVATE/M4ROOT/CLIP</span> on the card, not the video itself.
          </p>
        ) : (
          <Timeline result={result} session={session} />
        )}
        {hasClips && result.unplaced.length > 0 && (
          <p class="notice">
            {result.unplaced.length} mark{result.unplaced.length === 1 ? '' : 's'} fell where no camera was recording
            ({result.unplaced.slice(0, 4).map((m) => clockText(markerTime(m.marker))).join(', ')}{result.unplaced.length > 4 ? ', …' : ''}).
            If that looks wrong, a camera clock is off: adjust it under that camera.
          </p>
        )}
        {result.plans.length > 1 && <p class="notice">Your clips use {result.plans.length} different frame rates, so you get one timeline per frame rate.</p>}
        {result.slowQuickClips.length > 0 && <p class="notice">{result.slowQuickClips.length} slow-motion (S&amp;Q) clip{result.slowQuickClips.length === 1 ? ' is' : 's are'} left out: their time does not match real time.</p>}
        {message && <p class="muted small" role="status">{message}</p>}
      </section>

      {result.timings.map((cam) => (
        <CameraCard
          key={cam.camera.id}
          cam={cam}
          session={session}
          markerCount={result.plans.reduce((n, p) => n + p.clips.filter((c) => c.camera.id === cam.camera.id).reduce((k, c) => k + c.markers.length, 0), 0)}
          onClips={(r) => addClips(cam.camera.id, r)}
          onChange={(patch) => setCamera(cam.camera.id, patch)}
          onCalibrate={() => setCalibrating(cam.camera)}
          onRemoveClips={() => update({ ...session, clips: session.clips.filter((c) => c.cameraId !== cam.camera.id) })}
          onRemove={session.cameras.length > 1 ? () => update({ ...session, cameras: session.cameras.filter((c) => c.id !== cam.camera.id), clips: session.clips.filter((c) => c.cameraId !== cam.camera.id) }) : undefined}
        />
      ))}
      {session.cameras.length < 4 && (
        <button class="ghost" onClick={() => update({ ...session, cameras: [...session.cameras, newCamera(session.cameras.length)] })}>Add a camera</button>
      )}

      <section class="card">
        <h2>Export</h2>
        {!hasClips && <p class="muted small">Add clips first to get editor files. You can already save a session backup.</p>}
        <div class="exports">
          {files.filter((f) => hasClips || f.kind === 'session').map((f) => (
            <div class="stack" key={f.name} style="gap:4px">
              <button onClick={() => run(() => saveFile(f))}>
                <strong>{label[f.kind][0]}</strong>
                <span class="muted small">{label[f.kind][1]}</span>
              </button>
              <button class="quiet small" onClick={() => setShowing(f)}>Show as text</button>
            </div>
          ))}
        </div>
        {hasClips && (
          <div class="row">
            {canPickFolder && (
              <button class="primary grow" onClick={() => run(async () => { const where = await saveToFolder(files, safeFileName(session.name)); return where ? `Saved ${files.length} files to ${where}. Eject the card before removing it.` : null; })}>
                Save all to the SD card or a folder
              </button>
            )}
            <button class="grow" onClick={() => run(() => saveZip(files, `${safeFileName(session.name)} - ContentSync.zip`))}>Save all as one .zip</button>
          </div>
        )}
        <p class="muted small">
          {canPickFolder
            ? 'Pick the card (or the folder you copied it to). The files go into a ContentSync folder there, so they travel with the footage.'
            : isAppleTouch
              ? 'To put a file on the SD card: tap it, choose Save to Files, then pick the card.'
              : 'Files go to your Downloads folder. Move them next to the footage. In Chrome or Edge you can save straight to the card.'}
        </p>
      </section>

      {calibrating && <Calibrate session={session} camera={calibrating} timing={result.timings.find((t) => t.camera.id === calibrating.id)!} onClose={() => setCalibrating(null)} onApply={(offset) => { setCamera(calibrating.id, { clockOffsetMs: offset, calibrated: true }); setCalibrating(null); setMessage(`${calibrating.label} is synced to the slate.`); }} />}
      {showing && <ShowText file={showing} onClose={() => setShowing(null)} />}
    </div>
  );
}

function Timeline({ result, session }: { result: ReturnType<typeof buildPlans>; session: Session }) {
  const all = result.timings.flatMap((t) => t.clips);
  const times = [...all.flatMap((c) => [c.startMs, c.endMs]), ...session.markers.map(markerTime)];
  const min = Math.min(...times);
  const span = Math.max(1000, Math.max(...times) - min);
  const pct = (ms: number) => `${(((ms - min) / span) * 100).toFixed(3)}%`;
  return (
    <div class="timeline" role="img" aria-label="Clips and marks over time">
      {result.timings.map((cam) => (
        <div class="lane" key={cam.camera.id}>
          <span class="small" dir="auto">{cam.camera.label}</span>
          <div class="track">
            {cam.clips.map((c) => (
              <span key={c.clip.id} class="clip" style={{ left: pct(c.startMs), width: pct(c.endMs - c.startMs + min) }} title={c.clip.fileName} />
            ))}
            {session.markers.map((m) => (
              <span key={m.id} class={`tick c-${m.color}`} style={{ left: pct(markerTime(m)) }} />
            ))}
          </div>
        </div>
      ))}
      <div class="lane">
        <span />
        <div class="row small muted" style="justify-content:space-between">
          <span class="mono">{clockText(min)}</span>
          <span class="mono">{clockText(min + span)}</span>
        </div>
      </div>
    </div>
  );
}

function offsetText(ms: number): string {
  if (Math.abs(ms) < 50) return 'matches the phone';
  return `${(Math.abs(ms) / 1000).toFixed(1)} s ${ms > 0 ? 'ahead of' : 'behind'} the phone`;
}

function CameraCard(p: {
  cam: CameraTiming;
  session: Session;
  markerCount: number;
  onClips: (r: ImportResult | null) => void;
  onChange: (patch: Partial<Camera>) => void;
  onCalibrate: () => void;
  onRemoveClips: () => void;
  onRemove?: () => void;
}) {
  const { cam } = p;
  const c = cam.camera;
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const models = [...new Set(cam.clips.map((t) => friendlyModel(t.clip.model)).filter(Boolean))].join(', ');
  const bodies = new Set(cam.clips.map((t) => t.clip.bodyId).filter(Boolean));
  const load = async (fn: () => Promise<ImportResult | null>) => {
    setBusy(true);
    try {
      p.onClips(await fn());
    } finally {
      setBusy(false);
    }
  };
  const nudge = (ms: number) => p.onChange({ clockOffsetMs: c.clockOffsetMs + ms, calibrated: false });

  return (
    <section class="card">
      <div class="row">
        <input id={`cam-${c.id}`} class="grow" type="text" dir="auto" value={c.label} aria-label="Camera name" style="font-weight:600;max-width:12em" onInput={(e) => p.onChange({ label: (e.target as HTMLInputElement).value })} />
        <span class="grow muted small">{models}{cam.clips.length ? ` · ${cam.clips.length} clip${cam.clips.length === 1 ? '' : 's'} · ${p.markerCount} mark${p.markerCount === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div class="row">
        <label class="btn grow">
          {busy ? 'Reading…' : 'Add clip files'}
          <input id={`files-${c.id}`} type="file" multiple disabled={busy} onChange={(e) => { const el = e.target as HTMLInputElement; const list = Array.from(el.files ?? []); el.value = ''; void load(() => importFromFiles(list, c.id)); }} />
        </label>
        {canPickFolder && <button class="grow" disabled={busy} onClick={() => load(() => importFromFolder(c.id))}>Pick this camera's card</button>}
      </div>
      {bodies.size > 1 && <p class="notice">These clips come from {bodies.size} different camera bodies. Keep one camera per card here, or the sync will be wrong.</p>}

      {cam.clips.length > 0 && (
        <>
          <div class="stack" style="gap:4px">
            <span class="label">Camera clock</span>
            <div class="row">
              <span class="grow">{offsetText(c.clockOffsetMs)}</span>
              <span class={`pill ${c.calibrated ? 'ok' : ''}`}>{c.calibrated ? 'Slate-synced' : cam.freeRun ? 'Free-run timecode' : 'Camera clock'}</span>
            </div>
            <p class="muted small">{describeAccuracy(cam)}</p>
            <div class="row">
              <button onClick={() => nudge(-1000)} aria-label="Camera clock 1 second earlier">−1 s</button>
              <button onClick={() => nudge(-100)} aria-label="Camera clock a tenth earlier">−0.1</button>
              <button onClick={() => nudge(100)} aria-label="Camera clock a tenth later">+0.1</button>
              <button onClick={() => nudge(1000)} aria-label="Camera clock 1 second later">+1 s</button>
            </div>
            <button onClick={p.onCalibrate}>Sync from slate</button>
          </div>
          <button class="quiet" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Hide clips' : 'Show clips and options'}</button>
          {more && (
            <div class="stack">
              {cam.clips.map((t) => (
                <div class="cliprow" key={t.clip.id}>
                  <span class="mono">{t.clip.fileName}</span>
                  <span class="muted mono">{clockText(t.startMs)} · {formatElapsed(framesToMs(t.clip.durationFrames, t.clip.rate))} · {rateLabel(t.clip.rate)}{t.clip.slowQuick ? ' · S&Q' : ''}</span>
                </div>
              ))}
              <label class="stack">
                <span class="label">Folder for these clips on your edit computer (optional)</span>
                <input id={`path-${c.id}`} type="text" placeholder="/Volumes/Edit SSD/Shoot/Cam A" value={c.mediaPath} onInput={(e) => p.onChange({ mediaPath: (e.target as HTMLInputElement).value })} />
                <span class="muted small">With this set, the editor finds the clips by itself. Without it you relink once.</span>
              </label>
              <div class="row">
                <button class="danger" onClick={p.onRemoveClips}>Remove these clips</button>
                {p.onRemove && <button class="danger" onClick={p.onRemove}>Remove camera</button>}
              </div>
            </div>
          )}
        </>
      )}
      {cam.clips.length === 0 && p.onRemove && <button class="quiet danger" onClick={p.onRemove}>Remove camera</button>}
    </section>
  );
}

function Calibrate(p: { session: Session; camera: Camera; timing: CameraTiming; onClose: () => void; onApply: (offsetMs: number) => void }) {
  const clips = p.timing.clips.filter((t) => !t.clip.slowQuick);
  const [clipId, setClipId] = useState(clips[0]?.clip.id ?? '');
  const [min, setMin] = useState('0');
  const [sec, setSec] = useState('0');
  const [frm, setFrm] = useState('0');
  const [slate, setSlate] = useState('');
  const t = clips.find((x) => x.clip.id === clipId);

  let preview: { offset: number } | { error: string } | null = null;
  const m = /^\s*(\d{1,2})[:.](\d{1,2})[:.](\d{1,2})(?:[.,](\d))?\s*$/.exec(slate);
  if (t && slate.trim()) {
    if (!m) preview = { error: 'Type the slate time like 14:03:20.4' };
    else {
      const frame = Math.round(((+min || 0) * 60 + (+sec || 0)) * t.clip.rate.timebase + (+frm || 0));
      if (frame < 0 || frame >= t.clip.durationFrames) preview = { error: 'That position is outside this clip.' };
      else {
        // The slate shows phone local time; pick the day that puts it nearest the clip.
        const guess = new Date(t.startMs);
        const base = new Date(guess.getFullYear(), guess.getMonth(), guess.getDate(), +m[1], +m[2], +m[3], (+(m[4] ?? 0)) * 100 + 50).getTime();
        const slateMs = [base - 86400000, base, base + 86400000].sort((a, b) => Math.abs(a - t.startMs) - Math.abs(b - t.startMs))[0];
        preview = { offset: calibrateOffset(p.session, t.clip, frame, slateMs) };
      }
    }
  }

  return (
    <div class="modal" role="dialog" aria-label={`Sync ${p.camera.label} from the slate`}>
      <div class="sheet">
        <h2>Sync {p.camera.label} from the slate</h2>
        <p class="muted small">Open the clip where you filmed the sync slate in your editor or any player. Pause on a frame where the phone clock is sharp.</p>
        <label class="stack">
          <span class="label">Clip</span>
          <select id="cal-clip" value={clipId} onChange={(e) => setClipId((e.target as HTMLSelectElement).value)}>
            {clips.map((x) => (<option key={x.clip.id} value={x.clip.id}>{x.clip.fileName} · {clockText(x.startMs)}</option>))}
          </select>
        </label>
        <div class="stack">
          <span class="label">How far into the clip is that frame?</span>
          <div class="grid3">
            <label class="stack"><span class="small muted">minutes</span><input id="cal-min" type="number" inputMode="numeric" min="0" value={min} onInput={(e) => setMin((e.target as HTMLInputElement).value)} /></label>
            <label class="stack"><span class="small muted">seconds</span><input id="cal-sec" type="number" inputMode="numeric" min="0" max="59" value={sec} onInput={(e) => setSec((e.target as HTMLInputElement).value)} /></label>
            <label class="stack"><span class="small muted">frames</span><input id="cal-frm" type="number" inputMode="numeric" min="0" value={frm} onInput={(e) => setFrm((e.target as HTMLInputElement).value)} /></label>
          </div>
        </div>
        <label class="stack">
          <span class="label">What does the phone clock show on that frame?</span>
          <input id="cal-slate" type="text" inputMode="decimal" placeholder="14:03:20.4" value={slate} onInput={(e) => setSlate((e.target as HTMLInputElement).value)} />
        </label>
        {preview && 'error' in preview && <p class="notice">{preview.error}</p>}
        {preview && 'offset' in preview && <p>This camera's clock is {offsetText(preview.offset)}.</p>}
        <div class="row">
          <button class="grow" onClick={p.onClose}>Cancel</button>
          <button class="grow primary" disabled={!preview || !('offset' in preview)} onClick={() => preview && 'offset' in preview && p.onApply(preview.offset)}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function ShowText({ file, onClose }: { file: ExportFile; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.text);
      setCopied('Copied.');
    } catch {
      (document.getElementById('export-text') as HTMLTextAreaElement | null)?.select();
      setCopied('Select all and copy.');
    }
  };
  return (
    <div class="modal" role="dialog" aria-label={file.name}>
      <div class="sheet">
        <h2 dir="auto">{file.name}</h2>
        <textarea id="export-text" class="copy" readOnly value={file.text} />
        <div class="row">
          <button class="grow" onClick={onClose}>Close</button>
          <button class="grow primary" onClick={copy}>Copy</button>
          <span class="muted small" role="status">{copied}</span>
        </div>
      </div>
    </div>
  );
}
