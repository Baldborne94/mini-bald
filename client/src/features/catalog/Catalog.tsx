import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { STATUSES, STATUS_LABELS, type Group } from '@minibald/shared';
import { useGroups, useMiniatures, useTags } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { MiniCard, MiniRow } from '../../components/MiniCard.tsx';
import { statusColor } from '../../components/status.tsx';
import { plural } from '../../lib/format.ts';
import s from './Catalog.module.css';

const VIEW_KEY = 'minibald.view';
type View = 'grid' | 'list';

/** Top-level groups followed by their children, for nested <select> options. */
export function groupOptions(groups: Group[]) {
  return groups
    .filter((g) => g.parentId === null)
    .flatMap((parent) => [
      { id: parent.id, label: parent.name },
      ...groups.filter((g) => g.parentId === parent.id).map((g) => ({ id: g.id, label: `  └ ${g.name}` })),
    ]);
}

export function Catalog() {
  // Filters live in the URL, so a filtered view can be bookmarked and survives a reload.
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    group: params.get('group') ?? '',
    tag: params.get('tag') ?? '',
    sort: params.get('sort') ?? '',
  };
  const set = (key: keyof typeof filters, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // The search box is debounced so typing does not fire a request per keystroke.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => search !== filters.q && set('q', search), 250);
    return () => clearTimeout(timer);
  });

  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'));
  const changeView = (v: View) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const { data, error } = useMiniatures(filters);
  const { data: groups = [] } = useGroups();
  const { data: tags = [] } = useTags();

  const active = filters.status ? filters.status.split(',') : [];
  const toggleStatus = (st: string) =>
    set('status', (active.includes(st) ? active.filter((a) => a !== st) : [...active, st]).join(','));
  const filtered = Boolean(filters.q || filters.status || filters.group || filters.tag);

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1>Miniatures</h1>
          <p className="muted">{data ? `${plural(data.total, 'card')}${filtered ? ' match' : ''}` : ' '}</p>
        </div>
        <div className={s.viewToggle} role="group" aria-label="View">
          <button type="button" className={`btn btn--sm btn--icon ${view === 'grid' ? 'btn--accent' : 'btn--ghost'}`} onClick={() => changeView('grid')} aria-label="Grid view" aria-pressed={view === 'grid'}>
            <Icon name="grid" size={18} />
          </button>
          <button type="button" className={`btn btn--sm btn--icon ${view === 'list' ? 'btn--accent' : 'btn--ghost'}`} onClick={() => changeView('list')} aria-label="List view" aria-pressed={view === 'list'}>
            <Icon name="list" size={18} />
          </button>
        </div>
      </header>

      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search name, notes, tags…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        </label>
        <select className="input" value={filters.group} onChange={(e) => set('group', e.target.value)} aria-label="Group">
          <option value="">All groups</option>
          {groupOptions(groups).map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
          <option value="none">Ungrouped</option>
        </select>
        <select className="input" value={filters.tag} onChange={(e) => set('tag', e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name} ({t.miniCount})
            </option>
          ))}
        </select>
        <select className="input" value={filters.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="">Recently touched</option>
          <option value="created">Newest</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </select>
      </div>

      <div className={s.statuses}>
        {STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            className={`chip ${active.includes(st) ? s.statusOn : ''}`}
            style={{ '--c': statusColor(st) } as React.CSSProperties}
            aria-pressed={active.includes(st)}
            onClick={() => toggleStatus(st)}
          >
            <i className={s.dot} />
            {STATUS_LABELS[st]}
          </button>
        ))}
        {filtered && (
          <button type="button" className="chip" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>
            <Icon name="x" size={14} /> Clear
          </button>
        )}
      </div>

      {error && <p className="error-banner">{error.message}</p>}

      {data?.items.length === 0 ? (
        <div className={s.empty}>
          <h2>{filtered ? 'Nothing matches these filters.' : 'No miniatures yet.'}</h2>
          {!filtered && (
            <Link to="/minis/new" className="btn btn--primary">
              <Icon name="plus" /> Add miniature
            </Link>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className={s.grid}>{data?.items.map((mini, i) => <MiniCard key={mini.id} mini={mini} index={i} />)}</div>
      ) : (
        <div className={s.list}>{data?.items.map((mini) => <MiniRow key={mini.id} mini={mini} />)}</div>
      )}
    </div>
  );
}
