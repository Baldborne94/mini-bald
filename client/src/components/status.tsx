import { STATUSES, STATUS_LABELS, type Status, type StatusCounts } from '@minibald/shared';
import s from './components.module.css';

export const statusColor = (status: Status) => `var(--st-${status})`;

/** A dropper bottle: the app's recurring shape for "a status is a paint". */
export function Pot({ color, filled = true, size = 28 }: { color: string; filled?: boolean; size?: number }) {
  return (
    <svg width={size * (2 / 3)} height={size} viewBox="0 0 32 48" aria-hidden="true" className={s.pot}>
      <rect x="11" y="1.5" width="10" height="10" rx="2.5" fill="var(--text)" opacity={filled ? 0.9 : 0.35} />
      <path
        d="M9 13h14v4c3.4 2 5 5.2 5 9.2V41a5.5 5.5 0 0 1-5.5 5.5h-13A5.5 5.5 0 0 1 4 41V26.2c0-4 1.6-7.2 5-9.2z"
        fill={filled ? color : 'transparent'}
        stroke={filled ? color : 'var(--muted)'}
        strokeWidth="2"
        strokeDasharray={filled ? undefined : '3 3'}
      />
      {filled && <rect x="8" y="27" width="16" height="9" rx="2" fill="#000" opacity="0.22" />}
    </svg>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={s.pill} style={{ '--c': statusColor(status) } as React.CSSProperties}>
      <i />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** The five statuses as a rack of bottles; tapping one moves the miniature there. */
export function StatusStepper({ value, onChange, busy }: { value: Status; onChange: (s: Status) => void; busy?: boolean }) {
  const current = STATUSES.indexOf(value);
  return (
    <div className={s.stepper} role="radiogroup" aria-label="Status">
      {STATUSES.map((status, i) => (
        <button
          key={status}
          type="button"
          role="radio"
          aria-checked={status === value}
          disabled={busy}
          className={`${s.step} ${i <= current ? s.stepReached : ''} ${status === value ? s.stepCurrent : ''}`}
          style={{ '--c': statusColor(status) } as React.CSSProperties}
          onClick={() => status !== value && onChange(status)}
        >
          <Pot color={statusColor(status)} filled={i <= current} size={40} />
          <span>{STATUS_LABELS[status]}</span>
        </button>
      ))}
    </div>
  );
}

/** Stacked bar: one segment per status, sized by number of models. */
export function StatusBar({ counts, height = 14 }: { counts: StatusCounts; height?: number }) {
  const total = STATUSES.reduce((sum, st) => sum + counts[st], 0);
  return (
    <div className={s.bar} style={{ height }} role="img" aria-label={STATUSES.map((st) => `${STATUS_LABELS[st]}: ${counts[st]}`).join(', ')}>
      {total > 0 &&
        STATUSES.filter((st) => counts[st] > 0).map((st) => (
          <i key={st} style={{ flexGrow: counts[st], background: statusColor(st) }} title={`${STATUS_LABELS[st]}: ${counts[st]}`} />
        ))}
    </div>
  );
}

export const percentFinished = (counts: StatusCounts) => {
  const total = STATUSES.reduce((sum, st) => sum + counts[st], 0);
  return total === 0 ? 0 : Math.round((counts.finished / total) * 100);
};
