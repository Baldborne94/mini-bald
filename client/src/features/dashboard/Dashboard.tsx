import { Link } from 'react-router';
import { STATUSES, STATUS_LABELS } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { useAchievements, useChallenges, useDashboard, useInsights, useStreak } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Cover, MiniCard } from '../../components/MiniCard.tsx';
import { Pot, StatusBar, StatusPill, percentFinished, statusColor } from '../../components/status.tsx';
import { formatDuration, plural, timeAgo } from '../../lib/format.ts';
import { Medal } from '../motivation/celebrate.tsx';
import { ColourOfDay, ForgottenPaints, PileZero } from '../motivation/extras.tsx';
import { ChallengeCard, StreakCard } from '../motivation/GoalsPage.tsx';
import s from './Dashboard.module.css';

export function Dashboard() {
  const { data, error } = useDashboard();
  const { data: streak } = useStreak();
  const { data: insights } = useInsights();
  const { data: challenges = [] } = useChallenges();
  const { data: achievements = [] } = useAchievements();
  const active = challenges.filter((c) => c.state === 'active').slice(0, 2);
  const latest = achievements
    .filter((a) => a.unlockedAt)
    .sort((a, b) => b.unlockedAt!.localeCompare(a.unlockedAt!))
    .slice(0, 5);
  if (error) return <p className="error-banner">Could not load the dashboard: {error.message}</p>;
  if (!data) return null;

  if (data.cards === 0) {
    return (
      <section className={s.empty}>
        <div className={s.emptyPots}>
          {STATUSES.map((st, i) => (
            <span key={st} style={{ '--i': i } as React.CSSProperties}>
              <Pot color={statusColor(st)} size={64} />
            </span>
          ))}
        </div>
        <h1>The bench is empty.</h1>
        <p className="muted">Add your first miniature, snap a photo, and start tracking the journey from sprue to showcase.</p>
        <Link to="/minis/new" className="btn btn--primary">
          <Icon name="plus" /> Add your first miniature
        </Link>
      </section>
    );
  }

  const { continueWith: next } = data;
  return (
    <div className={s.page}>
      <section className={s.hero}>
        <div className={s.pile}>
          <p className="eyebrow">Pile of shame</p>
          <p className={s.pileNumber}>{data.pile}</p>
          <p className="muted">
            {data.pile === 0 ? 'Nothing left to paint. Legendary.' : `${plural(data.pile, 'model')} waiting for paint, out of ${data.totalModels}`}
          </p>
          {insights && <PileZero data={insights.pileZero} />}
        </div>
        <div className={s.rack}>
          <StatusBar counts={data.models} height={22} />
          <ul className={s.legend}>
            {STATUSES.map((st) => (
              <li key={st}>
                <Link to={`/minis?status=${st}`}>
                  <Pot color={statusColor(st)} size={30} />
                  <b>{data.models[st]}</b>
                  <span>{STATUS_LABELS[st]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={s.tiles}>
          <div className={s.tile} style={{ '--c': 'var(--st-finished)' } as React.CSSProperties}>
            <b>{data.finishedThisMonth}</b>
            <span>finished this month</span>
          </div>
          <div className={s.tile} style={{ '--c': 'var(--paint-4)' } as React.CSSProperties}>
            <b>{formatDuration(data.paintedSecondsThisMonth)}</b>
            <span>at the brush this month</span>
          </div>
          <div className={s.tile} style={{ '--c': 'var(--st-in_progress)' } as React.CSSProperties}>
            <b>{data.models.in_progress}</b>
            <span>on the bench now</span>
          </div>
          <div className={s.tile} style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
            <b>{percentFinished(data.models)}%</b>
            <span>of the collection painted</span>
          </div>
        </div>
      </section>

      {next && (
        <section>
          <Link to={`/minis/${next.id}`} className={s.continue}>
            <div className={s.continueMedia}>
              <Cover mini={next} width={800} />
            </div>
            <div className={s.continueBody}>
              <p className="eyebrow">Pick up where you left off</p>
              <h2>{next.name}</h2>
              <p className="muted">
                {next.group?.name ?? 'Ungrouped'} · touched {timeAgo(next.updatedAt)}
              </p>
              <StatusPill status={next.status} />
              <span className={`btn btn--primary ${s.continueCta}`}>
                Back to the brush <Icon name="arrow" />
              </span>
            </div>
          </Link>
        </section>
      )}

      <section className={s.push}>
        {streak && <StreakCard streak={streak} />}
        <Link to="/pick" className={`card ${s.pickCard}`}>
          <Icon name="dice" size={34} />
          <span>
            <b>What do I paint today?</b>
            <small className="muted">Let the dice pick from the pile.</small>
          </span>
          <Icon name="right" />
        </Link>
        {active.map((c) => (
          <Link key={c.id} to="/goals" className={s.challengeLink}>
            <ChallengeCard challenge={c} compact />
          </Link>
        ))}
        {insights?.colourOfDay && <ColourOfDay data={insights.colourOfDay} />}
        {insights && <ForgottenPaints data={insights.forgotten} />}
        <Link to="/goals" className={`card ${s.medals}`}>
          {latest.length > 0 ? (
            <span className={s.medalRow}>
              {latest.map((a) => (
                <Medal key={a.key} badge={a} size={40} />
              ))}
            </span>
          ) : (
            <Icon name="trophy" size={30} />
          )}
          <span>
            <b>
              {achievements.filter((a) => a.unlockedAt).length} of {achievements.length} badges
            </b>
            <small className="muted">{active.length === 0 ? 'Set a challenge, see your statistics.' : 'Goals and statistics.'}</small>
          </span>
          <Icon name="right" />
        </Link>
      </section>

      {data.inProgress.length > 1 && (
        <section>
          <header className={s.sectionHead}>
            <h2>On the bench</h2>
            <Link to="/minis?status=in_progress" className="muted">
              See all
            </Link>
          </header>
          <div className={s.strip}>
            {data.inProgress.map((mini, i) => (
              <MiniCard key={mini.id} mini={mini} index={i} />
            ))}
          </div>
        </section>
      )}

      <section>
        <header className={s.sectionHead}>
          <h2>Progress by group</h2>
          <Link to="/groups" className="muted">
            Manage groups
          </Link>
        </header>
        <ul className={s.groups}>
          {data.groups.map((g) => (
            <li key={g.id ?? 'none'}>
              <Link to={`/minis?group=${g.id ?? 'none'}`} style={{ '--c': g.color ?? 'var(--muted)' } as React.CSSProperties}>
                <span className={s.groupName}>
                  <i />
                  {g.name}
                </span>
                <span className={s.groupPct}>{percentFinished(g.counts)}%</span>
                <StatusBar counts={g.counts} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {data.recentPhotos.length > 0 && (
        <section>
          <header className={s.sectionHead}>
            <h2>Fresh off the camera</h2>
          </header>
          <div className={s.photos}>
            {data.recentPhotos.map((p) => (
              <Link key={p.id} to={`/minis/${p.miniatureId}`} title={p.miniatureName}>
                <img src={thumbUrl(p.id, 400)} alt={p.miniatureName} loading="lazy" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
