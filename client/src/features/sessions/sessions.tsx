import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useActiveSession, useDeleteSession, useLogSession, useSessions, useStartSession, useStopSession, useUpdateSession } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { formatClock, formatDate, formatDuration } from '../../lib/format.ts';
import s from './Sessions.module.css';

/** Seconds since `startedAt`, re-rendering every second while a timer runs. */
function useElapsed(startedAt: string | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt ? (now - Date.parse(startedAt)) / 1000 : 0;
}

/** Floating pill shown on every page while a session is running. */
export function ActiveTimer() {
  const { data: session } = useActiveSession();
  const stop = useStopSession();
  const elapsed = useElapsed(session?.startedAt);
  if (!session) return null;
  return (
    <div className={s.pill} role="timer" aria-label="Painting session">
      <i className={s.pulse} />
      <b>{formatClock(elapsed)}</b>
      {session.miniatureId ? (
        <Link to={`/minis/${session.miniatureId}`}>{session.miniatureName}</Link>
      ) : (
        <span>Painting</span>
      )}
      <button type="button" className="btn btn--sm btn--icon" disabled={stop.isPending} onClick={() => stop.mutate()} aria-label="Stop the timer">
        <Icon name="stop" size={16} filled />
      </button>
    </div>
  );
}

/** Timer and history on a miniature page. */
export function SessionPanel({ miniatureId, totalSeconds }: { miniatureId: number; totalSeconds: number }) {
  const { data: active } = useActiveSession();
  const { data: sessions = [] } = useSessions(miniatureId);
  const start = useStartSession();
  const stop = useStopSession();
  const log = useLogSession();
  const update = useUpdateSession();
  const remove = useDeleteSession();
  const [showAll, setShowAll] = useState(false);
  const [minutes, setMinutes] = useState('');

  const running = active?.miniatureId === miniatureId ? active : null;
  const elapsed = useElapsed(running?.startedAt);
  const finished = sessions.filter((x) => x.endedAt);
  const shown = showAll ? finished : finished.slice(0, 4);

  const onLog = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(minutes);
    if (value > 0) log.mutate({ miniatureId, minutes: value }, { onSuccess: () => setMinutes('') });
  };
  const editNote = (id: number, current: string | null) => {
    const notes = prompt('What did you get done in this session?', current ?? '');
    if (notes !== null) update.mutate({ id, notes });
  };

  return (
    <section className={`card ${s.panel} ${running ? s.panelRunning : ''}`}>
      <div className={s.clock}>
        <p className="eyebrow">{running ? 'Painting now' : 'Time at the brush'}</p>
        <p className={s.time}>{running ? formatClock(elapsed) : formatDuration(totalSeconds)}</p>
        {running && <p className="muted">{formatDuration(totalSeconds + elapsed)} in total</p>}
        {!running && active && <p className="muted">A timer is running on {active.miniatureName ?? 'another session'}; starting here stops it.</p>}
      </div>
      {running ? (
        <button type="button" className={`btn ${s.big}`} disabled={stop.isPending} onClick={() => stop.mutate()}>
          <Icon name="stop" filled /> Stop
        </button>
      ) : (
        <button type="button" className={`btn btn--primary ${s.big}`} disabled={start.isPending} onClick={() => start.mutate(miniatureId)}>
          <Icon name="play" filled /> Start painting
        </button>
      )}

      {(finished.length > 0 || !running) && (
        <div className={s.history}>
          <ul>
            {shown.map((x) => (
              <li key={x.id}>
                <span className={s.when}>{formatDate(x.startedAt)}</span>
                <b>{formatDuration(x.durationSec ?? 0)}</b>
                <button type="button" className={s.note} onClick={() => editNote(x.id, x.notes)}>
                  {x.notes ?? <span className="muted">Add a note</span>}
                </button>
                <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => confirm('Delete this session?') && remove.mutate(x.id)} aria-label="Delete session">
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className={s.historyFoot}>
            {finished.length > 4 && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `All ${finished.length} sessions`}
              </button>
            )}
            <form onSubmit={onLog} className={s.log}>
              <input className="input" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min" aria-label="Minutes to log" />
              <button type="submit" className="btn btn--sm" disabled={!minutes || log.isPending}>
                <Icon name="clock" size={16} /> Log time
              </button>
            </form>
          </div>
        </div>
      )}
      {(start.error || stop.error || log.error) && <p className="error-banner">{(start.error ?? stop.error ?? log.error)!.message}</p>}
    </section>
  );
}
