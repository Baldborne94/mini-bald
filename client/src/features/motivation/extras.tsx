import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ActivityYear, Insights } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { useActivity, useRecap } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Smear } from '../../components/MiniCard.tsx';
import { Pot } from '../../components/status.tsx';
import { formatDate, formatDuration, plural } from '../../lib/format.ts';
import { Medal } from './celebrate.tsx';
import s from './Extras.module.css';

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat(undefined, { month: 'long' });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const noon = (day: string) => new Date(`${day}T12:00:00`);

/** Dashboard card: one paint from the inventory per day, and where it is used. */
export function ColourOfDay({ data }: { data: NonNullable<Insights['colourOfDay']> }) {
  const { paint, uses } = data;
  return (
    <div className={`card ${s.colour}`} style={{ '--c': paint.colorHex ?? 'var(--muted)' } as React.CSSProperties}>
      <span className={s.colourPot}>
        <Pot color={paint.colorHex ?? 'var(--muted)'} size={74} />
      </span>
      <div>
        <p className="eyebrow">Colour of the day</p>
        <h3>{paint.name}</h3>
        <p className="muted">{[paint.brand, paint.range, paint.type].filter((x, i, all) => x && all.indexOf(x) === i).join(' · ')}</p>
        {uses.length === 0 ? (
          <p className={s.colourHint}>Not in any of your recipes yet. Where could it go today?</p>
        ) : (
          <p className={s.colourUses}>
            In{' '}
            {uses.slice(0, 3).map((u, i) => (
              <span key={u.recipeId}>
                {i > 0 && ', '}
                {u.miniatureId ? <Link to={`/minis/${u.miniatureId}`}>{u.miniatureName}</Link> : <Link to="/recipes">{u.recipeName}</Link>}
              </span>
            ))}
            {uses.length > 3 && ` and ${uses.length - 3} more`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Dashboard card: paints you own that no recipe uses. */
export function ForgottenPaints({ data }: { data: Insights['forgotten'] }) {
  if (data.count === 0) return null;
  return (
    <Link to="/paints?unused=1" className={`card ${s.forgotten}`}>
      <span className={s.forgottenPots}>
        {data.sample.slice(0, 5).map((p) => (
          <Pot key={p.id} color={p.colorHex ?? 'var(--muted)'} size={34} />
        ))}
      </span>
      <span>
        <b>{plural(data.count, 'forgotten paint')}</b>
        <small className="muted">Owned, but not in any recipe. Like {data.sample[0]!.name}.</small>
      </span>
      <Icon name="right" />
    </Link>
  );
}

/** One line under the pile of shame: when it would be empty at the recent pace. */
export function PileZero({ data }: { data: Insights['pileZero'] }) {
  if (data.pile === 0) return null;
  if (!data.date) return <p className={s.pileZero}>Finish a model to see when the pile could be gone.</p>;
  const years = (Date.parse(data.date) - Date.now()) / (365.25 * 86_400_000);
  return (
    <p className={s.pileZero}>
      At your pace of the last 90 days ({data.modelsPerMonth} a month) the pile is gone{' '}
      <b>{years > 30 ? 'in more than 30 years' : `by ${new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(data.date))}`}</b>.
    </p>
  );
}

// Sequential scale, one hue: more time painted, more ink.
const level = (d: ActivityYear['days'][number]) => (!d.active && d.seconds === 0 ? 0 : d.seconds < 1800 ? 1 : d.seconds < 3600 ? 2 : d.seconds < 7200 ? 3 : 4);
const LEVEL_LABELS = ['No painting', 'Under 30 min', '30 to 60 min', '1 to 2 hours', 'Over 2 hours'];

/** A year of painting days as a calendar grid: weeks are columns, Monday on top. */
export function Heatmap() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = useActivity(year);
  const scroller = useRef<HTMLDivElement>(null);
  // On a phone the grid is wider than the screen: start at the most recent weeks.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [data]);
  if (!data) return null;

  const offset = (noon(`${data.year}-01-01`).getDay() + 6) % 7; // empty cells before 1 January
  const painted = data.days.filter((d) => d.active || d.seconds > 0);
  const months = Array.from({ length: 12 }, (_, m) => {
    const days = data.days.filter((d) => Number(d.day.slice(5, 7)) === m + 1);
    return { m, days: days.filter((d) => d.active || d.seconds > 0).length, seconds: days.reduce((sum, d) => sum + d.seconds, 0), any: days.length > 0 };
  });

  return (
    <section className={`card ${s.heat}`}>
      <header>
        <div>
          <h3>Painting calendar</h3>
          <p className="muted">
            {plural(painted.length, 'day')} painted in {data.year}
          </p>
        </div>
        <div className={s.years}>
          {data.years.map((y) => (
            <button key={y} type="button" className={`chip ${y === data.year ? 'chip--on' : ''}`} aria-pressed={y === data.year} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </header>
      <div className={s.heatScroll} ref={scroller}>
        <div className={s.heatMonths} aria-hidden="true">
          {months.map(({ m }) => {
            const first = noon(`${data.year}-${String(m + 1).padStart(2, '0')}-01`);
            const dayOfYear = Math.round((first.getTime() - noon(`${data.year}-01-01`).getTime()) / 86_400_000);
            return (
              <span key={m} style={{ gridColumnStart: Math.floor((dayOfYear + offset) / 7) + 1 }}>
                {MONTH.format(first)}
              </span>
            );
          })}
        </div>
        <ol className={s.heatGrid}>
          {Array.from({ length: offset }, (_, i) => (
            <li key={`pad${i}`} className={s.heatPad} aria-hidden="true" />
          ))}
          {data.days.map((d) => (
            <li key={d.day} data-level={level(d)} title={`${DAY.format(noon(d.day))}: ${d.seconds > 0 ? formatDuration(d.seconds) : d.active ? 'painted' : 'no painting'}`} />
          ))}
        </ol>
      </div>
      <footer>
        <span className={s.heatLegend}>
          Less
          {LEVEL_LABELS.map((label, i) => (
            <i key={label} data-level={i} title={label} />
          ))}
          More
        </span>
        <Link to={`/recap/${data.year}`} className="btn btn--sm btn--accent">
          {data.year} in paint <Icon name="arrow" size={16} />
        </Link>
      </footer>
      <details className={s.heatTable}>
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Days painted</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {months.filter((m) => m.any).map((m) => (
              <tr key={m.m}>
                <th scope="row">{MONTH_LONG.format(new Date(data.year, m.m, 15))}</th>
                <td>{m.days}</td>
                <td>{formatDuration(m.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** "Year in paint": the year's numbers, what got finished, favourite paints. */
export function RecapPage() {
  const navigate = useNavigate();
  const year = Number(useParams().year) || new Date().getFullYear();
  const { data: recap } = useRecap(year);
  if (!recap) return null;
  const empty = recap.sessions === 0 && recap.finishedCards === 0 && recap.daysPainted === 0;

  return (
    <div className={s.recap}>
      <header className={s.recapHero}>
        <p className="eyebrow">Year in paint</p>
        <h1>{recap.year}</h1>
        <div className={s.years}>
          {recap.years.map((y) => (
            <button key={y} type="button" className={`chip ${y === recap.year ? 'chip--on' : ''}`} aria-pressed={y === recap.year} onClick={() => navigate(`/recap/${y}`, { replace: true })}>
              {y}
            </button>
          ))}
        </div>
      </header>

      {empty ? (
        <p className={`muted ${s.recapEmpty}`}>Nothing recorded in {recap.year}. The brushes were resting.</p>
      ) : (
        <>
          <dl className={s.recapStats}>
            <div style={{ '--c': 'var(--paint-5)' } as React.CSSProperties}>
              <dd>{recap.finishedModels}</dd>
              <dt>{recap.finishedModels === 1 ? 'model finished' : 'models finished'}</dt>
            </div>
            <div style={{ '--c': 'var(--paint-1)' } as React.CSSProperties}>
              <dd>{formatDuration(recap.paintedSeconds)}</dd>
              <dt>at the brush, in {plural(recap.sessions, 'session')}</dt>
            </div>
            <div style={{ '--c': 'var(--paint-6)' } as React.CSSProperties}>
              <dd>{recap.daysPainted}</dd>
              <dt>days painted, best streak {recap.bestStreak}</dt>
            </div>
            <div style={{ '--c': 'var(--paint-2)' } as React.CSSProperties}>
              <dd>{recap.photosTaken}</dd>
              <dt>{recap.photosTaken === 1 ? 'photo taken' : 'photos taken'}</dt>
            </div>
          </dl>

          {(recap.busiestMonth || recap.longestSessionSeconds > 0) && (
            <p className={s.recapLine}>
              {recap.busiestMonth && (
                <>
                  Busiest month: <b>{MONTH_LONG.format(noon(`${recap.busiestMonth.month}-15`))}</b> with {formatDuration(recap.busiestMonth.paintedSeconds)}.{' '}
                </>
              )}
              {recap.longestSessionSeconds > 0 && (
                <>
                  Longest sitting: <b>{formatDuration(recap.longestSessionSeconds)}</b>.
                </>
              )}
            </p>
          )}

          {recap.finished.length > 0 && (
            <section>
              <h2>Off the bench</h2>
              <ul className={s.mosaic}>
                {recap.finished.map((m) => (
                  <li key={m.id}>
                    <Link to={`/minis/${m.id}`} title={`${m.name}, ${formatDate(m.finishedAt)}`}>
                      {m.coverPhotoId ? <img src={thumbUrl(m.coverPhotoId, 400)} alt={m.name} loading="lazy" /> : <Smear seed={`${m.id}-${m.name}`} letter={m.name.charAt(0).toUpperCase()} />}
                      <span>{m.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className={s.recapCols}>
            {recap.topMiniatures.length > 0 && (
              <section className={`card ${s.recapList}`}>
                <h3>Most time spent on</h3>
                <ol>
                  {recap.topMiniatures.map((m) => (
                    <li key={m.id}>
                      <Link to={`/minis/${m.id}`}>{m.name}</Link>
                      <b>{formatDuration(m.paintedSeconds)}</b>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {recap.topPaints.length > 0 && (
              <section className={`card ${s.recapList}`}>
                <h3>Paints you reached for</h3>
                <ol>
                  {recap.topPaints.map((p) => (
                    <li key={p.label}>
                      <span className={s.recapPaint}>
                        <Pot color={p.colorHex ?? 'var(--muted)'} filled={p.colorHex !== null} size={26} />
                        {p.label}
                      </span>
                      <b>{plural(p.steps, 'step')}</b>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {recap.badges.length > 0 && (
            <section>
              <h2>Badges earned</h2>
              <ul className={s.recapBadges}>
                {recap.badges.map((b) => (
                  <li key={b.key}>
                    <Medal badge={{ ...b, unlockedAt: 'yes' }} size={52} />
                    <small>{b.title}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <Link to="/goals" className="btn btn--ghost">
        <Icon name="left" size={16} /> Back to goals
      </Link>
    </div>
  );
}
