import { useEffect, useState } from 'react';
import { PHASE_LABELS, type Recipe } from '@minibald/shared';
import { useActiveSession, useStartSession, useStopSession, useToggleStep } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Pot } from '../../components/status.tsx';
import { formatClock } from '../../lib/format.ts';
import { useElapsed } from '../sessions/sessions.tsx';
import { PHASE_COLOR } from './recipes.tsx';
import s from './Bench.module.css';

type WakeLock = { release: () => Promise<void> };

/** Keeps the screen on while the bench view is open, where the browser allows it (HTTPS only). */
function useWakeLock(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } }).wakeLock;
    if (!api) return;
    let lock: WakeLock | null = null;
    let cancelled = false;
    const acquire = () =>
      api.request('screen').then(
        (l) => {
          if (cancelled) return void l.release();
          lock = l;
          setHeld(true);
        },
        () => setHeld(false),
      );
    // The lock is dropped whenever the tab is hidden: take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
  return held;
}

/**
 * Full-screen view of one recipe step at a time, readable from across the desk with paint on
 * your hands: big type, big buttons, the timer in sight.
 */
export function BenchMode({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const toggle = useToggleStep();
  const { data: active } = useActiveSession();
  const start = useStartSession();
  const stop = useStopSession();
  const awake = useWakeLock();
  const steps = recipe.steps;
  const firstOpen = steps.findIndex((st) => !st.doneAt);
  const [index, setIndex] = useState(firstOpen === -1 ? steps.length : firstOpen);
  const step = steps[index];
  const done = steps.filter((st) => st.doneAt).length;
  const running = active && active.miniatureId === recipe.miniatureId ? active : null;
  const elapsed = useElapsed(running?.startedAt);

  const go = (to: number) => setIndex(Math.max(0, Math.min(steps.length, to)));
  const finishStep = () => {
    if (step && !step.doneAt) toggle.mutate({ id: step.id, done: true });
    go(index + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(index + 1);
      else if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        finishStep();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={s.bench} role="dialog" aria-modal="true" aria-label={`Bench mode: ${recipe.name}`} style={{ '--c': step ? PHASE_COLOR[step.phase] : 'var(--st-finished)' } as React.CSSProperties}>
      <header>
        <div>
          <p className="eyebrow">{recipe.miniatureName ?? 'Recipe'}</p>
          <b>{recipe.name}</b>
        </div>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Leave bench mode">
          <Icon name="x" />
        </button>
      </header>

      <div className={s.strip} aria-hidden="true">
        {steps.map((st, i) => (
          <button key={st.id} type="button" tabIndex={-1} className={i === index ? s.stripNow : ''} style={{ background: PHASE_COLOR[st.phase], opacity: st.doneAt || i === index ? 1 : 0.3 }} onClick={() => go(i)} />
        ))}
      </div>

      {step ? (
        <main key={step.id} className={s.step}>
          <p className={s.count}>
            Step {index + 1} of {steps.length}
            {step.doneAt && <span className="chip chip--tag">Done</span>}
          </p>
          <p className={s.phase}>{PHASE_LABELS[step.phase]}</p>
          <h2>{step.area || step.technique || PHASE_LABELS[step.phase]}</h2>
          {step.area && step.technique && <p className={s.technique}>{step.technique}</p>}
          {step.paintLabel && (
            <p className={s.paint}>
              <Pot color={step.paint?.colorHex ?? 'var(--muted)'} filled={Boolean(step.paint?.colorHex)} size={64} />
              <span>
                {step.paintLabel}
                {!step.paint && <small>not in your inventory</small>}
                {step.paint && step.paint.stock !== 'owned' && <small>{step.paint.stock === 'low' ? 'running low' : 'empty'}</small>}
              </span>
            </p>
          )}
          {step.notes && <p className={s.notes}>{step.notes}</p>}
        </main>
      ) : (
        <main className={s.step}>
          <p className={s.phase}>All done</p>
          <h2>{done === steps.length ? 'Recipe complete.' : 'End of the recipe.'}</h2>
          <p className={s.notes}>{done === steps.length ? 'Every step is ticked. Time for a photo?' : `${steps.length - done} skipped along the way: swipe back with the arrows to revisit them.`}</p>
        </main>
      )}

      <footer>
        <div className={s.timer}>
          {running ? (
            <button type="button" className="btn" disabled={stop.isPending} onClick={() => stop.mutate()}>
              <Icon name="stop" filled size={18} /> <span className={s.clock}>{formatClock(elapsed)}</span>
            </button>
          ) : (
            recipe.miniatureId !== null && (
              <button type="button" className="btn" disabled={start.isPending} onClick={() => start.mutate(recipe.miniatureId!)}>
                <Icon name="play" filled size={18} /> Start timer
              </button>
            )
          )}
          <small className="muted">{awake ? 'Screen stays on' : 'Screen may dim'}</small>
        </div>
        <div className={s.nav}>
          <button type="button" className="btn btn--icon" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous step">
            <Icon name="left" />
          </button>
          {step ? (
            <button type="button" className={`btn btn--primary ${s.next}`} onClick={finishStep}>
              <Icon name="check" /> {step.doneAt ? 'Next' : 'Done, next'}
            </button>
          ) : (
            <button type="button" className={`btn btn--primary ${s.next}`} onClick={onClose}>
              Close
            </button>
          )}
          <button type="button" className="btn btn--icon" disabled={index >= steps.length} onClick={() => go(index + 1)} aria-label="Skip this step">
            <Icon name="right" />
          </button>
        </div>
      </footer>
    </div>
  );
}
