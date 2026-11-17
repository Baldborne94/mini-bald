import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { STATUSES, STATUS_LABELS, type MiniatureSummary, type Status } from '@minibald/shared';
import { useGroups, useMiniatures, useStartSession, useTags } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Cover } from '../../components/MiniCard.tsx';
import { StatusPill, statusColor } from '../../components/status.tsx';
import { plural } from '../../lib/format.ts';
import { groupOptions } from '../catalog/Catalog.tsx';
import s from './Motivation.module.css';

const OPEN: Status[] = STATUSES.filter((st) => st !== 'finished');

/** "What do I paint today?": a random draw among unfinished miniatures, with filters. */
export function PickPage() {
  const navigate = useNavigate();
  const start = useStartSession();
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [group, setGroup] = useState('');
  const [tag, setTag] = useState('');
  const { data: groups = [] } = useGroups();
  const { data: tags = [] } = useTags();
  const { data } = useMiniatures({ status: (statuses.length > 0 ? statuses : OPEN).join(','), group, tag });
  const pool = data?.items ?? [];

  const [shown, setShown] = useState<MiniatureSummary | null>(null);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Changing the filters clears a result that may no longer match them.
  useEffect(() => setShown(null), [statuses, group, tag]);

  const roll = () => {
    if (pool.length === 0) return;
    const winner = pool[Math.floor(Math.random() * pool.length)]!;
    if (pool.length === 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(winner);
    // Flick through candidates, slowing down, then land on the winner.
    setRolling(true);
    let step = 0;
    const flick = () => {
      step++;
      if (step >= 14) {
        setShown(winner);
        return setRolling(false);
      }
      setShown(pool[Math.floor(Math.random() * pool.length)]!);
      timer.current = setTimeout(flick, 60 + step * step * 2.2);
    };
    flick();
  };

  const toggle = (st: Status) => setStatuses((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]));

  return (
    <div className={s.pick}>
      <header>
        <h1>What do I paint today?</h1>
        <p className="muted">{data ? `${plural(pool.length, 'miniature')} in the draw.` : ' '}</p>
      </header>

      <div className={s.pickFilters}>
        {OPEN.map((st) => (
          <button key={st} type="button" className={`chip ${statuses.includes(st) ? s.chipOn : ''}`} style={{ '--c': statusColor(st) } as React.CSSProperties} aria-pressed={statuses.includes(st)} onClick={() => toggle(st)}>
            <i className={s.chipDot} />
            {STATUS_LABELS[st]}
          </button>
        ))}
      </div>
      <div className={s.formRow}>
        <select className="input" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
          <option value="">Any group</option>
          {groupOptions(groups).map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
          <option value="none">Ungrouped</option>
        </select>
        <select className="input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className={`${s.draw} ${rolling ? s.drawRolling : ''} ${shown && !rolling ? s.drawDone : ''}`}>
        {shown ? (
          <>
            <div className={s.drawMedia}>
              <Cover mini={shown} width={800} />
            </div>
            <div className={s.drawBody} aria-live="polite">
              <p className="eyebrow">{rolling ? 'Rolling…' : 'Today it is'}</p>
              <h2>{shown.name}</h2>
              <p className="muted">{shown.group?.name ?? 'Ungrouped'}</p>
              <StatusPill status={shown.status} />
            </div>
          </>
        ) : (
          <div className={s.drawEmpty}>
            <Icon name="dice" size={56} />
            <p className="muted">{pool.length === 0 && data ? 'Nothing unfinished matches these filters.' : 'Let the dice decide.'}</p>
          </div>
        )}
      </div>

      <div className={s.pickActions}>
        {shown && !rolling && (
          <>
            <button type="button" className="btn btn--primary" disabled={start.isPending} onClick={() => start.mutate(shown.id, { onSuccess: () => navigate(`/minis/${shown.id}`) })}>
              <Icon name="play" filled /> Start painting
            </button>
            <Link to={`/minis/${shown.id}`} className="btn">
              Open
            </Link>
          </>
        )}
        <button type="button" className={`btn ${shown ? '' : 'btn--primary'} ${s.rollBtn}`} disabled={rolling || pool.length === 0} onClick={roll}>
          <Icon name="dice" /> {shown ? 'Roll again' : 'Roll'}
        </button>
      </div>
    </div>
  );
}
