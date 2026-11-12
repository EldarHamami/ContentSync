import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Session } from '../core/types';
import { deleteSession, importSessionJson, listSessions, loadSession, newSession, saveSession, type SessionSummary } from '../store';
import { askPersistence, isAppleTouch, isStandalone } from '../platform';
import { MarkScreen } from './MarkScreen';
import { FootageScreen } from './FootageScreen';

type View = 'home' | 'mark' | 'footage';

function defaultName(): string {
  const d = new Date();
  return `Interview ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function App() {
  const [view, setView] = useState<View>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const update = useCallback((next: Session) => {
    setSession(next);
    setSaveFailed(!saveSession(next));
  }, []);

  const open = (s: Session, v: View) => {
    update(s);
    setView(v);
    askPersistence();
  };

  if (!session || view === 'home') {
    return <Home onOpen={open} />;
  }
  return (
    <>
      {saveFailed && (
        <div class="page" style="padding-bottom:0">
          <div class="notice">This browser is not saving your marks (private window or storage is full). Export a backup before closing.</div>
        </div>
      )}
      {view === 'mark' ? (
        <MarkScreen session={session} update={update} onHome={() => setView('home')} onFootage={() => setView('footage')} />
      ) : (
        <FootageScreen session={session} update={update} onBack={() => setView('mark')} onHome={() => setView('home')} />
      )}
    </>
  );
}

function Home({ onOpen }: { onOpen: (s: Session, v: View) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>(listSessions);
  const [name, setName] = useState(defaultName);
  const [cams, setCams] = useState(2);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => setSessions(listSessions()), []);

  const importBackup = async (files: FileList | null) => {
    if (!files?.[0]) return;
    try {
      onOpen(importSessionJson(await files[0].text()), 'footage');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <div class="page">
      <header class="stack">
        <h1>ContentSync</h1>
        <p class="muted">Tap your phone when something good happens. Afterwards your marks land on the footage from every camera.</p>
      </header>

      <section class="card">
        <h2>New shoot</h2>
        <label class="stack">
          <span class="label">Name</span>
          <input id="new-name" type="text" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} dir="auto" />
        </label>
        <div class="stack">
          <span class="label">Cameras rolling</span>
          <div class="seg" role="group" aria-label="Number of cameras">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} aria-pressed={cams === n} onClick={() => setCams(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <button class="primary" onClick={() => onOpen(newSession(name, cams), 'mark')}>
          Start marking
        </button>
      </section>

      {sessions.length > 0 && (
        <section class="card">
          <h2>Your shoots</h2>
          {sessions.map((s) => {
            const full = () => loadSession(s.id);
            return (
              <div class="cliprow" key={s.id}>
                <div class="stack" style="gap:2px">
                  <strong dir="auto">{s.name}</strong>
                  <span class="muted small">
                    {new Date(s.createdMs).toLocaleDateString()} · {s.markers} marks · {s.clips} clips
                  </span>
                </div>
                <div class="row">
                  <button onClick={() => { const x = full(); if (x) onOpen(x, 'mark'); }}>Mark</button>
                  <button onClick={() => { const x = full(); if (x) onOpen(x, 'footage'); }}>Footage</button>
                  {confirmDelete === s.id ? (
                    <button class="danger" onClick={() => { deleteSession(s.id); setSessions(listSessions()); setConfirmDelete(null); }}>
                      Delete for good
                    </button>
                  ) : (
                    <button class="quiet" aria-label={`Delete ${s.name}`} onClick={() => setConfirmDelete(s.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section class="card">
        <h2>Continue on this device</h2>
        <p class="muted small">Marked on your phone and editing on a computer? Save a session backup on the phone (Footage), send it to yourself, and open it here.</p>
        <label class="btn">
          Open a session backup
          <input id="import-backup" type="file" onChange={(e) => importBackup((e.target as HTMLInputElement).files)} />
        </label>
        {error && <p class="notice">{error}</p>}
      </section>

      {isAppleTouch && !isStandalone && (
        <p class="notice">
          Before a shoot, add ContentSync to your Home Screen (Share, then Add to Home Screen). Safari can clear data from websites you have not opened for a week; the Home Screen app keeps it.
        </p>
      )}

      <section class="card">
        <h2>How it works</h2>
        <ol class="steps muted small">
          <li>Set each camera's clock to match your phone (Sony Creators' App does this, or set it by hand).</li>
          <li>For tight sync: tap Sync cameras, point your phone at each camera's screen while it records, freeze, and type the timecode you see.</li>
          <li>During the interview, tap MARK or a tag. The app saves the exact moment, minus a few seconds of look-back.</li>
          <li>Afterwards, give the app the small XML files Sony writes next to each clip on the card. It places every mark on the right clip and frame.</li>
          <li>Export an XML for Premiere Pro, DaVinci Resolve or Final Cut Pro, and save it next to the footage.</li>
        </ol>
      </section>
      <p class="muted small">Works offline. Nothing leaves this device.</p>
    </div>
  );
}
