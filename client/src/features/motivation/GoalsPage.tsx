import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CHALLENGE_KINDS, CHALLENGE_KIND_LABELS, type Challenge, type ChallengeKind, type Stats, type Streak } from '@minibald/shared';
import { useAchievements, useChallenges, useCreateChallenge, useDeleteChallenge, useGroups, useMiniatures, useStats, useStreak, useUpdateChallenge } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { formatDate, formatDuration, plural } from '../../lib/format.ts';
import { groupOptions } from '../catalog/Catalog.tsx';
import { Medal } from './celebrate.tsx';
import s from './Motivation.module.css';

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const localDate = (day: string) => new Date(`${day}T12:00:00`);

/** Flame, count and the last two weeks as dots. Used on the dashboard and the goals page. */
export function StreakCard({ streak }: { streak: Streak }) {
  const alive = streak.current > 0;
  return (
    <div className={`card ${s.streak} ${alive ? s.streakAlive : ''}`}>
      <span className={s.flame}>
        <Icon name="flame" size={30} filled={alive} />
      </span>
      <div>
        <p className={s.streakCount}>
          {streak.current} <small>{streak.current === 1 ? 'day' : 'days'} in a row</small>
        </p>
        <p className="muted">
          {streak.paintedToday ? 'Painted today. The streak is safe.' : alive ? 'Paint today to keep it going.' : 'Paint today to start a streak.'}
          {streak.best > streak.current && ` Best: ${streak.best}.`}
        </p>
      </div>
      <ol className={s.dots} aria-label="Last 14 days">
        {streak.recent.map((d) => (
          <li key={d.day} className={d.active ? s.dotOn : ''} title={`${formatDate(localDate(d.day).toISOString())}${d.active ? ': painted' : ''}`}>
            <span>{WEEKDAY.format(localDate(d.day))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const UNIT = { models: 'model', hours: 'hour', days: 'day' } as const;

export function ChallengeCard({ challenge, compact }: { challenge: Challenge; compact?: boolean }) {
  const update = useUpdateChallenge();
  const remove = useDeleteChallenge();
  const { current, target, unit } = challenge.progress;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <article className={`card ${s.challenge} ${s[challenge.state]}`}>
      <header>
        <div>
          <h3>{challenge.title}</h3>
          {!compact && challenge.description && <p className="muted">{challenge.description}</p>}
        </div>
        <span className={`chip chip--tag ${s.state}`}>
          {challenge.state === 'active'
            ? challenge.daysLeft === null
              ? 'No deadline'
              : challenge.daysLeft <= 1
                ? 'Last day'
                : `${challenge.daysLeft} days left`
            : challenge.state === 'completed'
              ? 'Completed'
              : challenge.state === 'missed'
                ? 'Missed'
                : 'Set aside'}
        </span>
      </header>
      <div className={s.meter} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(current, target)}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className={s.meterLabel}>
        <b>
          {current} / {target}
        </b>{' '}
        {UNIT[unit]}
        {target === 1 ? '' : 's'}
        {challenge.group && ` in ${challenge.group.name}`}
        {challenge.dueOn && ` · by ${formatDate(localDate(challenge.dueOn).toISOString())}`}
      </p>
      {!compact && challenge.miniatures.length > 0 && (
        <ul className={s.targets}>
          {challenge.miniatures.map((m) => (
            <li key={m.id}>
              <Link to={`/minis/${m.id}`} className={`chip chip--tag ${m.status === 'finished' ? s.targetDone : ''}`}>
                {m.status === 'finished' && <Icon name="check" size={12} />} {m.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <footer>
          {(challenge.state === 'active' || challenge.state === 'abandoned') && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => update.mutate({ id: challenge.id, abandoned: challenge.state === 'active' })}>
              {challenge.state === 'active' ? 'Set aside' : 'Pick up again'}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={() => confirm(`Delete the challenge "${challenge.title}"?`) && remove.mutate(challenge.id)}>
            <Icon name="trash" size={16} />
          </button>
        </footer>
      )}
    </article>
  );
}

const endOfMonth = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
};

function ChallengeForm({ onClose }: { onClose: () => void }) {
  const create = useCreateChallenge();
  const { data: groups = [] } = useGroups();
  const { data: minis } = useMiniatures({ status: 'unassembled,assembled,primed,in_progress', sort: 'name' });
  const [form, setForm] = useState({ title: '', kind: 'finish_miniatures' as ChallengeKind, target: 5, groupId: '', dueOn: endOfMonth(), description: '', picked: [] as number[] });
  const patch = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));
  const toggle = (id: number) => patch({ picked: form.picked.includes(id) ? form.picked.filter((x) => x !== id) : [...form.picked, id] });

  const suggested = {
    finish_miniatures: form.picked.length > 0 ? `Finish ${plural(form.picked.length, 'miniature')}` : 'Finish these miniatures',
    finish_count: `Finish ${plural(form.target, 'model')}`,
    paint_hours: `Paint for ${plural(form.target, 'hour')}`,
    streak_days: `Paint ${form.target} days in a row`,
  }[form.kind];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        title: form.title.trim() || suggested,
        description: form.description,
        kind: form.kind,
        dueOn: form.dueOn || null,
        ...(form.kind === 'finish_miniatures' ? { miniatureIds: form.picked } : { target: form.target }),
        ...(form.kind === 'finish_count' && form.groupId && { groupId: Number(form.groupId) }),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="New challenge" onClose={onClose}>
      <form className={s.form} onSubmit={onSubmit}>
        <label className="field">
          <span>What is the challenge?</span>
          <select className="input" value={form.kind} onChange={(e) => patch({ kind: e.target.value as ChallengeKind })}>
            {CHALLENGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {CHALLENGE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {form.kind === 'finish_miniatures' ? (
          <div className="field">
            <span>Miniatures ({form.picked.length} chosen)</span>
            <ul className={s.pickList}>
              {minis?.items.map((m) => (
                <li key={m.id}>
                  <label>
                    <input type="checkbox" checked={form.picked.includes(m.id)} onChange={() => toggle(m.id)} />
                    <span>
                      {m.name}
                      <small className="muted">{m.group?.name ?? 'Ungrouped'}</small>
                    </span>
                  </label>
                </li>
              ))}
              {minis?.items.length === 0 && <li className="muted">Nothing unfinished to pick from.</li>}
            </ul>
          </div>
        ) : (
          <div className={s.formRow}>
            <label className="field">
              <span>{form.kind === 'finish_count' ? 'Models' : form.kind === 'paint_hours' ? 'Hours' : 'Days in a row'}</span>
              <input className="input" type="number" min={1} max={10000} required value={form.target} onChange={(e) => patch({ target: Number(e.target.value) })} />
            </label>
            {form.kind === 'finish_count' && (
              <label className="field">
                <span>Only from</span>
                <select className="input" value={form.groupId} onChange={(e) => patch({ groupId: e.target.value })}>
                  <option value="">Any group</option>
                  {groupOptions(groups).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <div className={s.formRow}>
          <label className="field">
            <span>Deadline (optional)</span>
            <input className="input" type="date" value={form.dueOn} onChange={(e) => patch({ dueOn: e.target.value })} />
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" maxLength={140} value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder={suggested} />
          </label>
        </div>
        <p className="muted">It starts today: only what you do from now on counts.</p>
        {create.error && <p className="error-banner">{create.error.message}</p>}
        <button type="submit" className="btn btn--primary" disabled={create.isPending || (form.kind === 'finish_miniatures' && form.picked.length === 0)}>
          Start the challenge
        </button>
      </form>
    </Modal>
  );
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/**
 * Twelve months of one measure. One series, so one colour and no legend: the title names it.
 * Each bar shows its value on hover or focus; the tallest and the current month are labelled.
 */
function MonthBars({ title, months, value, format, color }: { title: string; months: Stats['months']; value: (m: Stats['months'][number]) => number; format: (n: number) => string; color: string }) {
  const values = months.map(value);
  const max = Math.max(...values, 0);
  const peak = values.indexOf(max);
  return (
    <figure className={`card ${s.chart}`}>
      <figcaption>
        <h3>{title}</h3>
        <span className="muted">last 12 months</span>
      </figcaption>
      {max === 0 ? (
        <p className={`muted ${s.chartEmpty}`}>Nothing recorded yet.</p>
      ) : (
        <ol className={s.bars} style={{ '--c': color } as React.CSSProperties}>
          {months.map((m, i) => {
            const date = new Date(`${m.month}-15T12:00:00`);
            const labelled = values[i]! > 0 && (i === peak || i === months.length - 1);
            return (
              <li key={m.month} tabIndex={0} aria-label={`${MONTH_LONG.format(date)}: ${format(values[i]!)}`}>
                <span className={s.barTrack}>
                  {labelled && <b style={{ bottom: `calc(${(values[i]! / max) * 100}% + 4px)` }}>{format(values[i]!)}</b>}
                  <i style={{ height: `${(values[i]! / max) * 100}%` }} />
                </span>
                <small>{MONTH.format(date).slice(0, 3)}</small>
                <span className={s.tip} role="tooltip">
                  {MONTH_LONG.format(date)}
                  <b>{format(values[i]!)}</b>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <details className={s.table}>
        <summary>Show as a table</summary>
        <table>
          <tbody>
            {months.map((m, i) => (
              <tr key={m.month}>
                <th scope="row">{MONTH_LONG.format(new Date(`${m.month}-15T12:00:00`))}</th>
                <td>{format(values[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function GoalsPage() {
  const { data: streak } = useStreak();
  const { data: achievements = [] } = useAchievements();
  const { data: challenges = [] } = useChallenges();
  const { data: stats } = useStats();
  const [creating, setCreating] = useState(false);
  const unlocked = achievements.filter((a) => a.unlockedAt);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1>Goals</h1>
          <p className="muted">Streaks, challenges and badges: a little push to pick up the brush.</p>
        </div>
        <Link to="/pick" className="btn btn--accent">
          <Icon name="dice" /> What do I paint today?
        </Link>
      </header>

      {streak && <StreakCard streak={streak} />}

      <section className={s.block}>
        <header className={s.blockHead}>
          <h2>Challenges</h2>
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New challenge
          </button>
        </header>
        {challenges.length === 0 ? (
          <p className={`muted ${s.none}`}>No challenges yet. Set yourself one: a unit by the end of the month, five hours this week, a week-long streak.</p>
        ) : (
          <div className={s.challenges}>
            {challenges.map((c) => (
              <ChallengeCard key={c.id} challenge={c} />
            ))}
          </div>
        )}
      </section>

      <section className={s.block}>
        <header className={s.blockHead}>
          <h2>Badges</h2>
          <span className="muted">
            {unlocked.length} of {achievements.length}
          </span>
        </header>
        <ul className={s.badges}>
          {achievements.map((a) => (
            <li key={a.key} className={a.unlockedAt ? '' : s.badgeLocked}>
              <Medal badge={a} />
              <b>{a.title}</b>
              <small className="muted">{a.description}</small>
              {a.unlockedAt ? (
                <small className={s.badgeDate}>{formatDate(a.unlockedAt)}</small>
              ) : (
                <span className={s.badgeProgress} title={`${a.progress.current} of ${a.progress.target}`}>
                  <i style={{ width: `${(a.progress.current / a.progress.target) * 100}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {stats && (
        <section className={s.block}>
          <header className={s.blockHead}>
            <h2>Statistics</h2>
          </header>
          <dl className={s.totals}>
            <div>
              <dt>Models finished</dt>
              <dd>{stats.totals.finishedModels}</dd>
            </div>
            <div>
              <dt>Time at the brush</dt>
              <dd>{formatDuration(stats.totals.paintedSeconds)}</dd>
            </div>
            <div>
              <dt>Sessions</dt>
              <dd>{stats.totals.sessions}</dd>
            </div>
            <div>
              <dt>Average session</dt>
              <dd>{formatDuration(stats.totals.averageSessionSeconds)}</dd>
            </div>
            <div>
              <dt>Longest session</dt>
              <dd>{formatDuration(stats.totals.longestSessionSeconds)}</dd>
            </div>
            <div>
              <dt>Photos taken</dt>
              <dd>{stats.totals.photos}</dd>
            </div>
          </dl>
          <div className={s.charts}>
            <MonthBars title="Models finished" months={stats.months} value={(m) => m.finishedModels} format={(n) => String(n)} color="var(--st-finished)" />
            <MonthBars title="Time at the brush" months={stats.months} value={(m) => m.paintedSeconds} format={formatDuration} color="var(--primary)" />
          </div>
          {stats.topMiniatures.length > 0 && (
            <div className={`card ${s.top}`}>
              <h3>Where the hours went</h3>
              <ol>
                {stats.topMiniatures.map((m) => (
                  <li key={m.id}>
                    <Link to={`/minis/${m.id}`}>{m.name}</Link>
                    <span className={s.topBar}>
                      <i style={{ width: `${(m.paintedSeconds / stats.topMiniatures[0]!.paintedSeconds) * 100}%` }} />
                    </span>
                    <b>{formatDuration(m.paintedSeconds)}</b>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {creating && <ChallengeForm onClose={() => setCreating(false)} />}
    </div>
  );
}
