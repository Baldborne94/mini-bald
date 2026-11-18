import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { PAINT_STOCKS, STOCK_LABELS, paintLabel, type Paint, type PaintStock } from '@minibald/shared';
import { useAddPaints, useAddShopping, useCatalog, useDeletePaint, useFillPaintColours, useDeleteShopping, usePaints, useSavePaint, useShopping, useUpdateShopping } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { Pot } from '../../components/status.tsx';
import { csvToPaints } from '../../lib/csv.ts';
import { plural } from '../../lib/format.ts';
import { Catalogue } from './Catalogue.tsx';
import s from './Paints.module.css';

const BRANDS = ['Citadel', 'The Army Painter', 'AK Interactive', 'Vallejo', 'Scale75', 'Pro Acryl', 'Two Thin Coats', 'Green Stuff World'];
const TYPES = ['Base', 'Layer', 'Shade', 'Contrast', 'Dry', 'Technical', 'Metallic', 'Ink', 'Wash', 'Glaze', 'Air', 'Speedpaint', 'Primer', 'Varnish'];
const STOCK_COLOR: Record<PaintStock, string> = { owned: 'var(--st-finished)', low: 'var(--st-assembled)', out: 'var(--danger)', wanted: 'var(--st-primed)' };
// One tap on a pot's stock badge steps through the states you change while painting.
const NEXT_STOCK: Record<PaintStock, PaintStock> = { owned: 'low', low: 'out', out: 'owned', wanted: 'owned' };

export function PaintsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['catalogue', 'shopping'] as const).find((t) => t === params.get('tab')) ?? 'inventory';
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
          <button type="button" role="tab" aria-selected={tab === 'catalogue'} className={`chip ${tab === 'catalogue' ? 'chip--on' : ''}`} onClick={() => setParams({ tab: 'catalogue' }, { replace: true })}>
            <Icon name="book" size={16} /> Catalogue
          </button>
          <button type="button" role="tab" aria-selected={tab === 'shopping'} className={`chip ${tab === 'shopping' ? 'chip--on' : ''}`} onClick={() => setParams({ tab: 'shopping' }, { replace: true })}>
            <Icon name="cart" size={16} /> Shopping {open > 0 && <b className={s.count}>{open}</b>}
          </button>
        </div>
      </header>
      {tab === 'inventory' ? <Inventory /> : tab === 'catalogue' ? <Catalogue /> : <ShoppingList />}
    </div>
  );
}

function Inventory() {
  const { data: paints, error } = usePaints();
  const save = useSavePaint();
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const [stock, setStock] = useState<PaintStock | ''>('');
  // "Forgotten" paints: owned, but no recipe step uses them. The dashboard links here with ?unused=1.
  const [params] = useSearchParams();
  const [unused, setUnused] = useState(params.get('unused') === '1');
  const isUnused = (p: Paint) => p.usedInSteps === 0 && (p.stock === 'owned' || p.stock === 'low');
  const [editing, setEditing] = useState<Paint | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const fill = useFillPaintColours();
  const colourless = paints?.filter((p) => p.colorHex === null).length ?? 0;

  const brands = useMemo(() => [...new Set((paints ?? []).map((p) => p.brand))], [paints]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (paints ?? []).filter(
      (p) =>
        (!brand || p.brand === brand) &&
        (!stock || p.stock === stock) &&
        (!unused || isUnused(p)) &&
        (!needle || `${p.brand} ${p.range} ${p.name} ${p.type ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [paints, q, brand, stock, unused]);

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
        <div className={s.toolbarButtons}>
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            <Icon name="upload" /> Import
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Add paint
          </button>
        </div>
      </div>
      <div className={s.stocks}>
        {PAINT_STOCKS.map((st) => (
          <button key={st} type="button" className={`chip ${stock === st ? s.stockOn : ''}`} style={{ '--c': STOCK_COLOR[st] } as React.CSSProperties} aria-pressed={stock === st} onClick={() => setStock(stock === st ? '' : st)}>
            <i className={s.dot} />
            {STOCK_LABELS[st]} <span className="muted">{paints?.filter((p) => p.stock === st).length ?? 0}</span>
          </button>
        ))}
        <button type="button" className={`chip ${unused ? 'chip--on' : ''}`} aria-pressed={unused} onClick={() => setUnused((v) => !v)}>
          Never used <span className="muted">{paints?.filter(isUnused).length ?? 0}</span>
        </button>
      </div>
      {(colourless > 0 || fill.data) && (
        <p className={s.fill}>
          {fill.data ? (
            <span role="status">
              {fill.data.filled > 0 ? `${plural(fill.data.filled, 'paint')} coloured from the catalogue.` : 'No matching colours in the catalogue.'}
              {fill.data.stillMissing > 0 && ` ${fill.data.stillMissing} still have none: set them by hand.`}
            </span>
          ) : (
            <span className="muted">{plural(colourless, 'paint')} without a colour.</span>
          )}
          {colourless > 0 && !fill.data && (
            <button type="button" className="btn btn--sm" disabled={fill.isPending} onClick={() => fill.mutate()}>
              <Icon name="drop" size={16} /> Fill missing colours
            </button>
          )}
        </p>
      )}
      {fill.error && <p className="error-banner">{fill.error.message}</p>}
      {unused && visible.length > 0 && <p className="muted">These are in your inventory but in none of your recipes. Pick one and give it a job.</p>}

      {error && <p className="error-banner">{error.message}</p>}
      {paints?.length === 0 && (
        <div className={s.empty}>
          <h2>No paints yet.</h2>
          <p className="muted">Pick what is on your bench from the Catalogue tab, import a list, or add paints one by one. Recipes will suggest them, and the shopping list fills itself when a pot runs low.</p>
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
      {importing && <ImportPaints onClose={() => setImporting(false)} />}
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

  // Typing a name the catalogue knows fills in range, type and colour.
  const { data: catalogue = [] } = useCatalog();
  const known = catalogue.filter((e) => e.brand.toLowerCase() === form.brand.trim().toLowerCase());
  const onName = (name: string) => {
    const match = known.find((e) => e.name.toLowerCase() === name.trim().toLowerCase());
    patch(match ? { name: match.name, range: match.range, type: match.type ?? form.type, ...(match.hex && { colorHex: match.hex, hasColor: true }) } : { name });
  };

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
              {[...new Set([...paints.map((p) => p.brand), ...catalogue.map((e) => e.brand), ...BRANDS])].map((b) => (
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
          <input id="paint-name" className="input" required maxLength={100} list="paint-names" value={form.name} onChange={(e) => onName(e.target.value)} autoFocus={!paint && Boolean(form.brand)} />
          <datalist id="paint-names">
            {known.slice(0, 1500).map((e) => (
              <option key={`${e.range}|${e.name}`} value={e.name}>
                {e.range}
              </option>
            ))}
          </datalist>
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

/** Import from a CSV file or pasted text; export the inventory the same way. */
function ImportPaints({ onClose }: { onClose: () => void }) {
  const add = useAddPaints();
  const [text, setText] = useState('');
  const [brand, setBrand] = useState('');
  const parsed = useMemo(() => csvToPaints(text, brand), [text, brand]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  };

  return (
    <Modal title="Import paints" onClose={onClose}>
      <div className={s.form}>
        {add.data ? (
          <>
            <p role="status">
              <b>{plural(add.data.added, 'paint')} added.</b>
              {add.data.skipped > 0 && ` ${add.data.skipped} already in the inventory, left as they were.`}
            </p>
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              A CSV file or pasted lines. With a header row the columns can be in any order: <code>brand, range, name, type, color, stock, notes</code>. Without one they are read as brand, range, name, type, colour — or as plain names, one per line.
            </p>
            <label className="field">
              <span>CSV file</span>
              <input className="input" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
            </label>
            <label className="field">
              <span>…or paste here</span>
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Citadel,Base,Macragge Blue,Base,#0d407f\nCitadel,Shade,Nuln Oil'} spellCheck={false} />
            </label>
            <label className="field">
              <span>Default brand (for rows without one)</span>
              <input className="input" maxLength={60} list="paint-brands-import" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <datalist id="paint-brands-import">
                {BRANDS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            {text.trim() && (
              <div className={s.importPreview} role="status">
                <b>{plural(parsed.items.length, 'paint')} ready to import</b>
                {parsed.items.slice(0, 3).map((p) => (
                  <span key={`${p.brand}${p.range}${p.name}`} className="muted">
                    {p.brand}
                    {p.range && ` · ${p.range}`} · {p.name}
                  </span>
                ))}
                {parsed.problems.length > 0 && (
                  <details>
                    <summary>{plural(parsed.problems.length, 'row')} skipped</summary>
                    <ul>
                      {parsed.problems.slice(0, 50).map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {add.error && <p className="error-banner">{add.error.message}</p>}
            <footer className={s.formActions}>
              <a className="btn btn--ghost" href="/api/paints/export.csv" download style={{ marginRight: 'auto' }}>
                Export my inventory
              </a>
              <button type="button" className="btn btn--primary" disabled={parsed.items.length === 0 || add.isPending} onClick={() => add.mutate(parsed.items)}>
                Import {parsed.items.length > 0 ? parsed.items.length : ''}
              </button>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}
