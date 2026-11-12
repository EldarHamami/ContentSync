import { useEffect, useRef, useState } from 'preact/hooks';
import { applyTcAnchors, offsetFromTcAnchor } from '../core/sync';
import { parseTc } from '../core/timecode';
import type { Session } from '../core/types';

interface Props {
  session: Session;
  update: (s: Session) => void;
  onClose: () => void;
  onSlate: () => void;
}

/**
 * Sync by showing the phone the camera's running timecode: freeze a frame of the camera's screen,
 * type the timecode it shows. The freeze moment is the phone time that timecode belongs to.
 */
export function SyncSheet({ session, update, onClose, onSlate }: Props) {
  const [camId, setCamId] = useState(session.cameras[0]?.id ?? '');
  const [shot, setShot] = useState<number | null>(null);
  const [tc, setTc] = useState('');
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<'starting' | 'on' | 'off'>('starting');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        if (dead) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
        setLive('on');
      } catch {
        setLive('off');
      }
    })();
    return () => {
      dead = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const freeze = () => {
    const at = Date.now();
    video.current?.pause();
    setShot(at);
    setStatus('');
  };
  const retake = () => {
    setShot(null);
    setTc('');
    void video.current?.play().catch(() => undefined);
  };
  const cam = session.cameras.find((c) => c.id === camId);
  const valid = !!parseTc(tc);

  const save = () => {
    if (!cam || shot === null || !valid) return;
    const anchor = { phoneMs: shot, tc: tc.trim() };
    const next = applyTcAnchors({ ...session, cameras: session.cameras.map((c) => (c.id === cam.id ? { ...c, tcAnchor: anchor } : c)) });
    update(next);
    const hasClips = session.clips.some((c) => c.cameraId === cam.id);
    const r = hasClips ? offsetFromTcAnchor(next, cam.id, anchor) : null;
    setStatus(r && 'error' in r ? `${cam.label}: saved, but ${r.error}` : hasClips ? `${cam.label} is synced.` : `${cam.label}: saved. It is applied when you add this camera's clips.`);
    retake();
  };

  return (
    <div class="modal" role="dialog" aria-label="Sync cameras">
      <div class="sheet">
        <div class="row">
          <h2 class="grow">Sync a camera</h2>
          <button class="quiet" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p class="muted small">Start recording, then point your phone at the camera's screen so its timecode is readable. Freeze, and type the timecode you see.</p>
        {session.cameras.length > 1 && (
          <div class="seg" role="group" aria-label="Camera">
            {session.cameras.map((c) => (
              <button key={c.id} aria-pressed={c.id === camId} onClick={() => setCamId(c.id)}>
                {c.label}{c.tcAnchor ? ' ✓' : ''}
              </button>
            ))}
          </div>
        )}
        <div class="viewfinder">
          <video ref={video} playsInline muted />
          {live === 'off' && <p class="muted small">No camera access here. Look at the camera's screen, tap Freeze, and type the timecode you saw at that instant.</p>}
        </div>
        {shot === null ? (
          <button class="primary" onPointerDown={(e) => { e.preventDefault(); freeze(); }} onClick={() => shot === null && freeze()}>Freeze</button>
        ) : (
          <>
            <label class="stack">
              <span class="label">Timecode on the camera's screen</span>
              <input id="tc-entry" type="text" inputMode="numeric" placeholder="01:23:45:10" class="mono" value={tc}
                onInput={(e) => {
                  // Let people type digits only; colons are filled in.
                  const raw = (e.target as HTMLInputElement).value;
                  const d = raw.replace(/\D/g, '').slice(0, 8);
                  setTc(/[:;]/.test(raw) && raw.length >= tc.length ? raw : (d.match(/.{1,2}/g) ?? []).join(':'));
                }} />
            </label>
            <div class="row">
              <button class="grow" onClick={retake}>Retake</button>
              <button class="grow primary" disabled={!valid} onClick={save}>Save</button>
            </div>
          </>
        )}
        {status && <p class="small" role="status">{status}</p>}
        <button class="ghost" onClick={onSlate}>Or film the phone's clock instead</button>
      </div>
    </div>
  );
}
