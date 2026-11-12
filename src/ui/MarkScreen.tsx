import { useEffect, useRef, useState } from 'preact/hooks';
import { markerTime, uid, type Marker, type Session } from '../core/types';
import { buzz, keepAwake } from '../platform';

interface Props {
  session: Session;
  update: (s: Session) => void;
  onHome: () => void;
  onFootage: () => void;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export function clockText(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

export function MarkScreen({ session, update, onHome, onFootage }: Props) {
  const [now, setNow] = useState(Date.now());
  const [awake, setAwake] = useState(false);
  const [slate, setSlate] = useState(false);
  const [flash, setFlash] = useState(0);
  const latest = useRef(session);
  latest.current = session;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    const lock = () => { if (document.visibilityState === 'visible') void keepAwake(true).then(setAwake); };
    lock();
    document.addEventListener('visibilitychange', lock);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', lock);
      void keepAwake(false);
    };
  }, []);

  // The timestamp is taken first, before anything else can delay it.
  const mark = (tag: string, color: string) => {
    const tapMs = Date.now();
    const s = latest.current;
    const m: Marker = { id: uid(), tapMs, preRollMs: s.preRollMs, tag, color, note: '' };
    update({ ...s, markers: [...s.markers, m] });
    buzz();
    setFlash((n) => n + 1);
    if (!awake) void keepAwake(true).then(setAwake);
  };

  const edit = (id: string, note: string) =>
    update({ ...session, markers: session.markers.map((m) => (m.id === id ? { ...m, note } : m)) });
  const remove = (id: string) => update({ ...session, markers: session.markers.filter((m) => m.id !== id) });
  const recent = [...session.markers].sort((a, b) => b.tapMs - a.tapMs);

  return (
    <div class="page">
      <div key={flash} class={`flash ${flash ? 'on' : ''}`} />
      <div class="topbar">
        <button class="quiet" onClick={onHome} aria-label="Back to shoots">‹ Shoots</button>
        <span class="title" dir="auto">{session.name}</span>
        <span class="clock" aria-label="Phone time">{clockText(now)}</span>
      </div>

      <button class="markbtn" onPointerDown={(e) => { e.preventDefault(); mark('', 'red'); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mark('', 'red'); } }}>
        MARK
        <small>{session.markers.length === 0 ? 'Tap when something good happens' : `${session.markers.length} marked`}</small>
      </button>

      <div class="tags">
        {session.tags.map((t) => (
          <button key={t.label} class={`tag c-${t.color}`} onPointerDown={(e) => { e.preventDefault(); mark(t.label, t.color); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mark(t.label, t.color); } }}>
            {t.label}
          </button>
        ))}
      </div>

      <div class="row">
        <span class="label grow">Look-back: marks land this long before your tap</span>
        <div class="seg" role="group" aria-label="Look-back">
          {[0, 3, 5, 10].map((s) => (
            <button key={s} aria-pressed={session.preRollMs === s * 1000} onClick={() => update({ ...session, preRollMs: s * 1000 })}>
              {s}s
            </button>
          ))}
        </div>
      </div>

      <div class="row">
        <button class="grow" onClick={() => setSlate(true)}>Sync slate</button>
        <button class="grow primary" onClick={onFootage}>Footage &amp; export</button>
      </div>
      {!awake && <p class="muted small">Your screen may dim while you listen. Marks are saved either way; tap once to wake it.</p>}

      {recent.length > 0 && (
        <section class="card">
          <h2>Marks</h2>
          <div class="marks">
            {recent.map((m) => (
              <div class="mark" key={m.id}>
                <span class={`row c-${m.color}`} style="gap:6px">
                  <span class="dot" />
                  <span class="mono small">{clockText(markerTime(m))}</span>
                </span>
                <input id={`note-${m.id}`} type="text" dir="auto" placeholder={m.tag || 'Add a note'} value={m.note} aria-label={`Note for mark at ${clockText(markerTime(m))}`} onInput={(e) => edit(m.id, (e.target as HTMLInputElement).value)} />
                <button class="quiet" aria-label="Remove this mark" onClick={() => remove(m.id)}>✕</button>
              </div>
            ))}
          </div>
        </section>
      )}
      {slate && <Slate onClose={() => setSlate(false)} cameras={session.cameras.map((c) => c.label)} />}
    </div>
  );
}

/** Full-screen running phone clock to film with each camera: one filmed frame ties camera to phone. */
function Slate({ onClose, cameras }: { onClose: () => void; cameras: string[] }) {
  const big = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = Date.now();
      const d = new Date(t);
      if (big.current) big.current.textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
      if (bar.current) bar.current.style.width = `${d.getMilliseconds() / 10}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div class="slate" role="dialog" aria-label="Sync slate">
      <div>PHONE TIME · {new Date().toLocaleDateString()}</div>
      <div class="big" ref={big}>00:00:00.0</div>
      <div class="bar"><i ref={bar} /></div>
      <div style="max-width:34em">
        Start recording on {cameras.join(', ')} and film this screen for three seconds with each. Later, read this clock off one frame in your editor to sync that camera exactly.
      </div>
      <button onClick={onClose}>Done</button>
    </div>
  );
}
