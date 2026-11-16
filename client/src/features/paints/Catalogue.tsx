import { useMemo, useState } from 'react';
import type { CatalogEntry, PaintStock } from '@minibald/shared';
import { useAddPaints, useCatalog } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Pot } from '../../components/status.tsx';
import { plural } from '../../lib/format.ts';
import s from './Paints.module.css';

const keyOf = (e: CatalogEntry) => `${e.brand}|${e.range}|${e.name}`;
// Rendering thousands of pots at once is slow on a phone; one brand at a time never gets there,
// and a search across every brand is capped.
const MAX_SHOWN = 600;

/** Reference lists of paints: tick what you own and add it to the inventory in one go. */
export function Catalogue() {
  const { data: catalogue, error } = useCatalog();
  const add = useAddPaints();
  const [brand, setBrand] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hideOwned, setHideOwned] = useState(false);
  const [picked, setPicked] = useState<Map<string, CatalogEntry>>(new Map());
  const [result, setResult] = useState<string | null>(null);

  const brands = useMemo(() => {
    const counts = new Map<string, { total: number; owned: number }>();
    for (const e of catalogue ?? []) {
      const c = counts.get(e.brand) ?? { total: 0, owned: 0 };
      c.total++;
      if (e.paintId !== null) c.owned++;
      counts.set(e.brand, c);
    }
    return [...counts.entries()];
  }, [catalogue]);
  const activeBrand = brand ?? brands[0]?.[0] ?? '';

  const needle = q.trim().toLowerCase();
  const matches = useMemo(
    () =>
      (catalogue ?? []).filter(
        (e) =>
          // A search looks through every brand; otherwise one brand is shown at a time.
          (needle ? `${e.brand} ${e.range} ${e.name}`.toLowerCase().includes(needle) : e.brand === activeBrand) &&
          (!hideOwned || e.paintId === null),
      ),
    [catalogue, needle, activeBrand, hideOwned],
  );
  const shelves = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const e of matches.slice(0, MAX_SHOWN)) {
      const name = needle ? `${e.brand} · ${e.range}` : e.range || e.brand;
      map.set(name, [...(map.get(name) ?? []), e]);
    }
    return [...map.entries()];
  }, [matches, needle]);

  const toggle = (entries: CatalogEntry[], on?: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const e of entries) {
        if (e.paintId !== null) continue;
        const k = keyOf(e);
        if (on ?? !next.has(k)) next.set(k, e);
        else next.delete(k);
      }
      return next;
    });

  const addPicked = (stock: PaintStock) =>
    add.mutate(
      [...picked.values()].map((e) => ({ brand: e.brand, range: e.range, name: e.name, type: e.type, colorHex: e.hex, stock })),
      {
        onSuccess: (r) => {
          setResult(`${plural(r.added, 'paint')} added to ${stock === 'wanted' ? 'your wishlist' : 'your inventory'}.`);
          setPicked(new Map());
        },
      },
    );

  if (error) return <p className="error-banner">{error.message}</p>;
  if (catalogue?.length === 0) {
    return (
      <p className={`muted ${s.empty}`}>
        No catalogue files found. Drop a JSON list into <code>data/catalogs/</code> (see <code>server/catalog/README.md</code>).
      </p>
    );
  }

  return (
    <>
      <div className={s.stocks}>
        {brands.map(([name, c]) => (
          <button key={name} type="button" className={`chip ${!needle && name === activeBrand ? 'chip--on' : ''}`} aria-pressed={!needle && name === activeBrand} onClick={() => { setBrand(name); setQ(''); }}>
            {name}{' '}
            <span className="muted">
              {c.owned}/{c.total}
            </span>
          </button>
        ))}
      </div>
      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search every brand…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the catalogue" />
        </label>
        <button type="button" className={`chip ${hideOwned ? 'chip--on' : ''}`} aria-pressed={hideOwned} onClick={() => setHideOwned((v) => !v)}>
          Hide what I own
        </button>
      </div>
      <p className="muted">Tap the paints you have, then add them all at once. Colours are screen approximations.</p>
      {result && <p role="status"><b>{result}</b></p>}
      {add.error && <p className="error-banner">{add.error.message}</p>}
      {matches.length === 0 && <p className={`muted ${s.empty}`}>Nothing matches.</p>}
      {matches.length > MAX_SHOWN && <p className="muted">Showing the first {MAX_SHOWN} of {matches.length}. Narrow the search to see the rest.</p>}

      {shelves.map(([name, entries]) => {
        const free = entries.filter((e) => e.paintId === null);
        const allOn = free.length > 0 && free.every((e) => picked.has(keyOf(e)));
        return (
          <section key={name} className={s.shelf}>
            <header className={s.shelfHead}>
              <h2>
                {name} <small className="muted">{entries.length}</small>
              </h2>
              {free.length > 0 && (
                <button type="button" onClick={() => toggle(free, !allOn)}>
                  {allOn ? 'Clear' : `Select all ${free.length}`}
                </button>
              )}
            </header>
            <div className={s.rack}>
              {entries.map((e) => {
                const on = picked.has(keyOf(e));
                return (
                  <button key={keyOf(e)} type="button" className={`${s.pick} ${on ? s.pickOn : ''}`} disabled={e.paintId !== null} aria-pressed={on} onClick={() => toggle([e])} title={e.paintId !== null ? 'Already in your inventory' : undefined}>
                    <Pot color={e.hex ?? 'var(--muted)'} filled={e.hex !== null} size={42} />
                    <b>{e.name}</b>
                    {e.type && e.type !== e.range && <small className="muted">{e.type}</small>}
                    {(on || e.paintId !== null) && (
                      <span className={s.pickMark}>
                        <Icon name="check" size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {picked.size > 0 && (
        <div className={s.selection}>
          <b>{picked.size} selected</b>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicked(new Map())}>
            Clear
          </button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={add.isPending} onClick={() => addPicked('wanted')}>
            Wishlist
          </button>
          <button type="button" className="btn btn--sm btn--primary" disabled={add.isPending} onClick={() => addPicked('owned')}>
            <Icon name="plus" size={16} /> I own these
          </button>
        </div>
      )}
    </>
  );
}
