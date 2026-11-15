import { Link } from 'react-router';
import type { MiniatureSummary } from '@minibald/shared';
import { thumbUrl } from '../api/client.ts';
import { hash, timeAgo } from '../lib/format.ts';
import { StatusPill, statusColor } from './status.tsx';
import s from './components.module.css';

/** Placeholder for miniatures without a photo: a unique paint smear instead of a grey box. */
export function Smear({ seed, letter }: { seed: string; letter?: string }) {
  const h = hash(seed);
  const paint = (n: number) => `var(--paint-${((h >> (n * 3)) % 6) + 1})`;
  const style = {
    '--a': paint(0),
    '--b': paint(1),
    '--c': paint(2),
    '--x': `${20 + (h % 60)}%`,
    '--y': `${15 + ((h >> 6) % 55)}%`,
    '--r': `${(h >> 10) % 360}deg`,
  } as React.CSSProperties;
  return (
    <div className={s.smear} style={style} aria-hidden="true">
      {letter && <span>{letter}</span>}
    </div>
  );
}

export function Cover({ mini, width = 400 }: { mini: Pick<MiniatureSummary, 'id' | 'name' | 'coverPhotoId'>; width?: 200 | 400 | 800 | 1600 }) {
  return mini.coverPhotoId ? (
    <img src={thumbUrl(mini.coverPhotoId, width)} alt="" loading="lazy" decoding="async" />
  ) : (
    <Smear seed={`${mini.id}-${mini.name}`} letter={mini.name.trim().charAt(0).toUpperCase()} />
  );
}

export function MiniCard({ mini, index = 0 }: { mini: MiniatureSummary; index?: number }) {
  return (
    <Link
      to={`/minis/${mini.id}`}
      className={s.miniCard}
      style={{ '--c': statusColor(mini.status), '--i': Math.min(index, 12) } as React.CSSProperties}
    >
      <div className={s.miniCardMedia}>
        <Cover mini={mini} />
        {mini.quantity > 1 && <span className={s.qty}>×{mini.quantity}</span>}
      </div>
      <div className={s.miniCardBody}>
        <h3>{mini.name}</h3>
        <p className="muted">{mini.group?.name ?? 'Ungrouped'}</p>
        <StatusPill status={mini.status} />
      </div>
    </Link>
  );
}

export function MiniRow({ mini }: { mini: MiniatureSummary }) {
  return (
    <Link to={`/minis/${mini.id}`} className={s.miniRow}>
      <div className={s.miniRowThumb}>
        <Cover mini={mini} width={200} />
      </div>
      <div className={s.miniRowMain}>
        <h3>
          {mini.name}
          {mini.quantity > 1 && <small> ×{mini.quantity}</small>}
        </h3>
        <p className="muted">
          {mini.group?.name ?? 'Ungrouped'}
          {mini.tags.length > 0 && ` · ${mini.tags.join(', ')}`}
        </p>
      </div>
      <span className={`muted ${s.miniRowWhen}`}>{timeAgo(mini.updatedAt)}</span>
      <StatusPill status={mini.status} />
    </Link>
  );
}
