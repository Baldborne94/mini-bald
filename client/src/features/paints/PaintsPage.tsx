import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { PAINT_STOCKS, STOCK_LABELS, paintLabel, type Paint, type PaintStock } from '@minibald/shared';
import { useAddShopping, useDeletePaint, useDeleteShopping, usePaints, useSavePaint, useShopping, useUpdateShopping } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Pot } from '../../components/status.tsx';
import { plural } from '../../lib/format.ts';
import s from './Paints.module.css';

const BRANDS = ['Citadel', 'Vallejo', 'The Army Painter', 'AK Interactive', 'Scale75', 'Pro Acryl', 'Two Thin Coats', 'Green Stuff World'];
const TYPES = ['Base', 'Layer', 'Shade', 'Contrast', 'Dry', 'Technical', 'Metallic', 'Ink', 'Wash', 'Glaze', 'Air', 'Speedpaint', 'Primer', 'Varnish'];
const STOCK_COLOR: Record<PaintStock, string> = { owned: 'var(--st-finished)', low: 'var(--st-assembled)', out: 'var(--danger)', wanted: 'var(--st-primed)' };
// One tap on a pot's stock badge steps through the states you change while painting.
const NEXT_STOCK: Record<PaintStock, PaintStock> = { owned: 'low', low: 'out', out: 'owned', wanted: 'owned' };

export function PaintsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'shopping' ? 'shopping' : 'inventory';
  const { data: shopping = [] } = useShopping();
  const open = shopping.filter((i) => !i.boughtAt).length;

  return (
    <div className={s.page}>
      <header>
        <h1>Paints</h1>
        <div className={s.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'inventory'} className={`chip ${tab === 'inventory' ? 'chip--on' : ''}`} onClick={() => setParams({}, { replace: true })}>
            <Icon name="drop" size={16} /> Inventory
          </button>
          <button type="button" role="tab" aria-selected={tab === 'shopping'} className={`chip ${tab === 'shopping' ? 'chip--on' : ''}`} onClick={() => setParams({ tab: 'shopping' }, { replace: true })}>
            <Icon name="cart" size={16} /> Shopping list {open > 0 && <b className={s.count}>{open}</b>}
          </button>
        </div>
      </header>
      {tab === 'inventory' ? <Inventory /> : <ShoppingList />}
    </div>
  );
}

function Inventory() {
  const { data: paints, error } = usePaints();
  const save = useSavePaint();
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [stock, setStock] = useState<PaintStock | ''>('');
  const [editing, setEditing] = useState<Paint | 'new' | null>(null);

  const brands = useMemo(() => [...new Set((paints ?? []).map((p) => p.brand))], [paints]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (paints ?? []).filter(
      (p) =>
        (!brand || p.brand === brand) &&
        (!stock || p.stock === stock) &&
        (!needle || `${p.brand} ${p.range} ${p.name} ${p.type ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [paints, q, brand, stock]);

  // Shelves: one per brand and range, like the racks on a real bench.
  const shelves = useMemo(() => {
    const map = new Map<string, Paint[]>();
    for (const p of visible) {
      const key = p.range ? `${p.brand} · ${p.range}` : p.brand;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <>
      <div className={s.toolbar}>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search paints…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search paints" />
        </label>
        <select className="input" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Add paint
        </button>
      </div>
      <div className={s.stocks}>
        {PAINT_STOCKS.map((st) => (
          <button key={st} type="button" className={`chip ${stock === st ? s.stockOn : ''}`} style={{ '--c': STOCK_COLOR[st] } as React.CSSProperties} aria-pressed={stock === st} onClick={() => setStock(stock === st ? '' : st)}>
            <i className={s.dot} />
            {STOCK_LABELS[st]} <span className="muted">{paints?.filter((p) => p.stock === st).length ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <p className="error-banner">{error.message}</p>}
      {paints?.length === 0 && (
        <div className={s.empty}>
          <h2>No paints yet.</h2>
          <p className="muted">Add what is on your bench: recipes will suggest them, and the shopping list fills itself when a pot runs low.</p>
        </div>
      )}
      {paints && paints.length > 0 && visible.length === 0 && <p className={`muted ${s.empty}`}>No paint matches these filters.</p>}

      {shelves.map(([name, items]) => (
        <section key={name} className={s.shelf}>
          <h2>
            {name} <small className="muted">{items.length}</small>
          </h2>
          <div className={s.rack}>
            {items.map((p) => (
              <div key={p.id} className={s.paint} style={{ '--c': STOCK_COLOR[p.stock] } as React.CSSProperties}>
                <button type="button" className={s.paintMain} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                  <Pot color={p.colorHex ?? 'var(--muted)'} size={46} />
                  <b>{p.name}</b>
                  {p.type && <small className="muted">{p.type}</small>}
                </button>
                <button type="button" className={s.stockBadge} onClick={() => save.mutate({ id: p.id, stock: NEXT_STOCK[p.stock] })} title="Tap to change stock">
                  <i className={s.dot} />
                  {STOCK_LABELS[p.stock]}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && <PaintForm paint={editing === 'new' ? undefined : editing} paints={paints ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function PaintForm({ paint, paints, onClose }: { paint?: Paint; paints: Paint[]; onClose: () => void }) {
  const save = useSavePaint();
  const remove = useDeletePaint();
  const blank = { brand: paints.at(-1)?.brand ?? '', range: '', name: '', type: '', colorHex: '#888888', hasColor: false, stock: 'owned' as PaintStock, notes: '' };
  const [form, setForm] = useState(
    paint
      ? { brand: paint.brand, range: paint.range, name: paint.name, type: paint.type ?? '', colorHex: paint.colorHex ?? '#888888', hasColor: paint.colorHex !== null, stock: paint.stock, notes: paint.notes ?? '' }
      : blank,
  );
  const [added, setAdded] = useState(0);
  const patch = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));

  const submit = (another: boolean) => (e: FormEvent) => {
    e.preventDefault();
    // "Save & add another" is a plain button, so run the form's own validation by hand.
    if (!(e.target as HTMLElement).closest('form')?.reportValidity()) return;
    save.mutate(
      { id: paint?.id, brand: form.brand, range: form.range, name: form.name, type: form.type, colorHex: form.hasColor ? form.colorHex : null, stock: form.stock, notes: form.notes },
      {
        onSuccess: () => {
          if (!another) return onClose();
          // Entering a whole rack: keep brand, range and type, clear the rest.
          setAdded((n) => n + 1);
          setForm((f) => ({ ...f, name: '', notes: '', hasColor: false, stock: 'owned' }));
          document.getElementById('paint-name')?.focus();
        },
      },
    );
  };

  return (
    <Modal title={paint ? 'Edit paint' : 'Add paint'} onClose={onClose}>
      <form className={s.form} onSubmit={submit(false)}>
        <div className={s.formRow}>
          <label className="field">
            <span>Brand</span>
            <input className="input" required maxLength={60} list="paint-brands" value={form.brand} onChange={(e) => patch({ brand: e.target.value })} autoFocus={!paint && !form.brand} />
            <datalist id="paint-brands">
              {[...new Set([...paints.map((p) => p.brand), ...BRANDS])].map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Range</span>
            <input className="input" maxLength={60} list="paint-ranges" value={form.range} onChange={(e) => patch({ range: e.target.value })} placeholder="Base, Game Color…" />
            <datalist id="paint-ranges">
              {[...new Set(paints.filter((p) => p.range && (!form.brand || p.brand === form.brand)).map((p) => p.range))].map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>
        <label className="field">
          <span>Name</span>
          <input id="paint-name" className="input" required maxLength={100} value={form.name} onChange={(e) => patch({ name: e.target.value })} autoFocus={!paint && Boolean(form.brand)} />
        </label>
        <div className={s.formRow}>
          <label className="field">
            <span>Type</span>
            <input className="input" maxLength={40} list="paint-types" value={form.type} onChange={(e) => patch({ type: e.target.value })} placeholder="Base, Shade, Contrast…" />
            <datalist id="paint-types">
              {TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Colour</span>
            <span className={s.colorField}>
              <input type="color" value={form.colorHex} onChange={(e) => patch({ colorHex: e.target.value, hasColor: true })} aria-label="Paint colour" />
              <Pot color={form.hasColor ? form.colorHex : 'var(--muted)'} filled={form.hasColor} size={40} />
            </span>
          </label>
        </div>
        <div className="field">
          <span>Stock</span>
          <div className={s.stockPick}>
            {PAINT_STOCKS.map((st) => (
              <button type="button" key={st} className={`chip ${form.stock === st ? 'chip--on' : ''}`} aria-pressed={form.stock === st} onClick={() => patch({ stock: st })}>
                {STOCK_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Notes</span>
          <input className="input" maxLength={1000} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Thin 1:1, dries glossy…" />
        </label>
        {paint && paint.usedInSteps > 0 && <p className="muted">Used in {plural(paint.usedInSteps, 'recipe step')}.</p>}
        {added > 0 && <p className="muted" role="status">{plural(added, 'paint')} added. Keep going.</p>}
        {(save.error || remove.error) && <p className="error-banner">{(save.error ?? remove.error)!.message}</p>}
        <footer className={s.formActions}>
          {paint && (
            <button type="button" className="btn btn--ghost btn--danger" onClick={() => confirm(`Remove ${paintLabel(paint)} from the inventory?`) && remove.mutate(paint.id, { onSuccess: onClose })}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          {!paint && (
            <button type="button" className="btn" disabled={save.isPending} onClick={submit(true)}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {paint ? 'Save' : 'Add paint'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ShoppingList() {
  const { data: items = [], error } = useShopping();
  const add = useAddShopping();
  const update = useUpdateShopping();
  const remove = useDeleteShopping();
  const [label, setLabel] = useState('');
  const open = items.filter((i) => !i.boughtAt);
  const bought = items.filter((i) => i.boughtAt);

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (label.trim()) add.mutate([{ label }], { onSuccess: () => setLabel('') });
  };

  const row = (item: (typeof items)[number]) => (
    <li key={item.id} className={`${s.item} ${item.boughtAt ? s.itemBought : ''}`}>
      <label>
        <input type="checkbox" checked={Boolean(item.boughtAt)} onChange={(e) => update.mutate({ id: item.id, bought: e.target.checked })} />
        <span className={s.check}>
          <Icon name="check" size={16} />
        </span>
        {item.paint && <Pot color={item.paint.colorHex ?? 'var(--muted)'} size={30} />}
        <span className={s.itemText}>
          <b>{item.paint ? item.paint.name : item.label}</b>
          {item.paint && (
            <small className="muted">
              {item.paint.brand}
              {item.paint.range && ` · ${item.paint.range}`}
              {!item.boughtAt && ` · ${STOCK_LABELS[item.paint.stock]}`}
            </small>
          )}
        </span>
      </label>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => remove.mutate(item.id)} aria-label="Remove from list">
        <Icon name="x" size={16} />
      </button>
    </li>
  );

  return (
    <>
      <form className={s.addItem} onSubmit={onAdd}>
        <input className="input" value={label} maxLength={140} onChange={(e) => setLabel(e.target.value)} placeholder="Add anything: brushes, glue, basing sand…" aria-label="New item" />
        <button type="submit" className="btn btn--primary" disabled={!label.trim() || add.isPending}>
          <Icon name="plus" /> Add
        </button>
      </form>
      {error && <p className="error-banner">{error.message}</p>}
      {items.length === 0 && (
        <p className={`muted ${s.empty}`}>Nothing to buy. Paints marked as running low, empty or wishlist land here by themselves.</p>
      )}
      <ul className={s.items}>{open.map(row)}</ul>
      {bought.length > 0 && (
        <>
          <header className={s.boughtHead}>
            <h2>Bought</h2>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => remove.mutate('bought')}>
              Clear
            </button>
          </header>
          <ul className={s.items}>{bought.map(row)}</ul>
        </>
      )}
    </>
  );
}
