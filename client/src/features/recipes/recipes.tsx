import { useState } from 'react';
import { PHASE_LABELS, STOCK_LABELS, type Recipe, type RecipePhase, type RecipeStep } from '@minibald/shared';
import { useAddShopping, useDeleteRecipe, useDuplicateRecipe, useMiniatures, useRecipes, useToggleStep } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { plural } from '../../lib/format.ts';
import { RecipeEditor } from './RecipeEditor.tsx';
import s from './Recipes.module.css';

// Each phase gets one of the theme's paints, so a recipe reads as a strip of colour.
export const PHASE_COLOR: Record<RecipePhase, string> = {
  prime: 'var(--st-unassembled)',
  base: 'var(--paint-1)',
  shade: 'var(--paint-4)',
  layer: 'var(--paint-2)',
  highlight: 'var(--paint-3)',
  detail: 'var(--paint-6)',
  basing: 'var(--paint-5)',
  varnish: 'var(--st-primed)',
  other: 'var(--muted)',
};

/** Paints a step needs that are not usable right now: not in the inventory, empty or only wished for. */
const isMissing = (step: RecipeStep) => (step.paint ? step.paint.stock === 'out' || step.paint.stock === 'wanted' : Boolean(step.paintLabel));

function StepRow({ step, tickable }: { step: RecipeStep; tickable: boolean }) {
  const toggle = useToggleStep();
  const done = Boolean(step.doneAt);
  const body = (
    <>
      <span className={s.phase}>{PHASE_LABELS[step.phase]}</span>
      <span className={s.stepBody}>
        <b>{[step.area, step.technique].filter(Boolean).join(' · ') || PHASE_LABELS[step.phase]}</b>
        {step.paintLabel && (
          <span className={s.stepPaint}>
            <i style={{ background: step.paint?.colorHex ?? 'transparent' }} className={step.paint?.colorHex ? '' : s.noColor} />
            {step.paintLabel}
            {!step.paint && <em>not in inventory</em>}
            {step.paint && step.paint.stock !== 'owned' && <em>{STOCK_LABELS[step.paint.stock].toLowerCase()}</em>}
          </span>
        )}
        {step.notes && <span className={`muted ${s.stepNotes}`}>{step.notes}</span>}
      </span>
    </>
  );
  return (
    <li className={`${s.step} ${done ? s.stepDone : ''}`} style={{ '--c': PHASE_COLOR[step.phase] } as React.CSSProperties}>
      {tickable ? (
        <label>
          <input type="checkbox" checked={done} onChange={(e) => toggle.mutate({ id: step.id, done: e.target.checked })} />
          <span className={s.check}>
            <Icon name="check" size={16} />
          </span>
          {body}
        </label>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

export function RecipeCard({ recipe }: { recipe: Recipe }) {
  const remove = useDeleteRecipe();
  const duplicate = useDuplicateRecipe();
  const addShopping = useAddShopping();
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const onMini = recipe.miniatureId !== null;
  const done = recipe.steps.filter((st) => st.doneAt).length;
  const missing = recipe.steps.filter(isMissing);
  const complete = onMini && recipe.steps.length > 0 && done === recipe.steps.length;

  const addMissing = () =>
    addShopping.mutate(
      missing.map((st) => (st.paint ? { paintId: st.paint.id } : { label: st.paintLabel! })),
      { onSuccess: (items) => setSaved(`${plural(new Set(items.map((i) => i.id)).size, 'item')} on the shopping list`) },
    );

  return (
    <article className={`card ${s.recipe} ${complete ? s.recipeComplete : ''}`}>
      <header>
        <div>
          <h3>{recipe.name}</h3>
          {recipe.description && <p className="muted">{recipe.description}</p>}
        </div>
        {onMini && recipe.steps.length > 0 && (
          <span className={s.progress}>
            {done}/{recipe.steps.length}
          </span>
        )}
      </header>

      {recipe.steps.length > 0 && (
        <div className={s.strip} aria-hidden="true">
          {recipe.steps.map((st) => (
            <i key={st.id} style={{ background: PHASE_COLOR[st.phase], opacity: onMini && !st.doneAt ? 0.3 : 1 }} />
          ))}
        </div>
      )}

      {recipe.steps.length === 0 ? (
        <p className="muted">No steps yet.</p>
      ) : (
        <ol className={s.steps}>
          {recipe.steps.map((st) => (
            <StepRow key={st.id} step={st} tickable={onMini} />
          ))}
        </ol>
      )}

      {missing.length > 0 && (
        <p className={s.missing}>
          <span>
            Missing: <b>{[...new Set(missing.map((st) => st.paintLabel))].join(', ')}</b>
          </span>
          <button type="button" className="btn btn--sm" disabled={addShopping.isPending} onClick={addMissing}>
            <Icon name="cart" size={16} /> Add to shopping list
          </button>
        </p>
      )}
      {saved && <p className="muted" role="status">{saved}</p>}

      <footer>
        <button type="button" className="btn btn--sm" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> Edit
        </button>
        <button type="button" className="btn btn--sm" onClick={() => setCopying(true)}>
          <Icon name="copy" size={16} /> {onMini ? 'Copy to…' : 'Use on a miniature'}
        </button>
        {onMini && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={duplicate.isPending}
            onClick={() => duplicate.mutate({ id: recipe.id, miniatureId: null }, { onSuccess: () => setSaved('Saved to the recipe library') })}
          >
            <Icon name="book" size={16} /> Save to library
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={() => confirm(`Delete the recipe "${recipe.name}"?`) && remove.mutate(recipe.id)}>
          <Icon name="trash" size={16} />
        </button>
      </footer>

      {editing && <RecipeEditor recipe={recipe} onClose={() => setEditing(false)} />}
      {copying && <CopyRecipe recipe={recipe} onClose={() => setCopying(false)} />}
    </article>
  );
}

/** Pick the miniature that receives a fresh, un-ticked copy of the recipe. */
function CopyRecipe({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { data } = useMiniatures({ sort: 'name' });
  const duplicate = useDuplicateRecipe();
  const [target, setTarget] = useState('');
  const [name, setName] = useState(recipe.name);
  const minis = data?.items.filter((m) => m.id !== recipe.miniatureId) ?? [];

  return (
    <Modal title="Copy recipe" onClose={onClose}>
      <form
        className={s.copyForm}
        onSubmit={(e) => {
          e.preventDefault();
          duplicate.mutate({ id: recipe.id, miniatureId: Number(target), name }, { onSuccess: onClose });
        }}
      >
        <label className="field">
          <span>Miniature</span>
          <select className="input" required value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="" disabled>
              Choose…
            </option>
            {minis.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.group ? ` — ${m.group.name}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Recipe name</span>
          <input className="input" required maxLength={140} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="muted">The copy starts with every step un-ticked and can be changed without touching the original.</p>
        {duplicate.error && <p className="error-banner">{duplicate.error.message}</p>}
        <button type="submit" className="btn btn--primary" disabled={duplicate.isPending || !target}>
          Copy recipe
        </button>
      </form>
    </Modal>
  );
}

/** Recipes block on a miniature page. */
export function MiniatureRecipes({ miniatureId }: { miniatureId: number }) {
  const { data: recipes = [] } = useRecipes(miniatureId);
  const { data: library = [] } = useRecipes();
  const duplicate = useDuplicateRecipe();
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <section className={s.section}>
      <header className={s.sectionHead}>
        <h2>Recipes</h2>
        <div>
          {library.length > 0 && (
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              <Icon name="book" /> From library
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New recipe
          </button>
        </div>
      </header>
      {recipes.length === 0 && <p className={`muted ${s.none}`}>No recipe yet. Write down the scheme step by step and tick it off as you paint.</p>}
      <div className={s.list}>
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>

      {creating && <RecipeEditor miniatureId={miniatureId} onClose={() => setCreating(false)} />}
      {picking && (
        <Modal title="Recipe library" onClose={() => setPicking(false)}>
          <ul className={s.pick}>
            {library.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: r.id, miniatureId }, { onSuccess: () => setPicking(false) })}>
                  <b>{r.name}</b>
                  <span className={s.strip} aria-hidden="true">
                    {r.steps.map((st) => (
                      <i key={st.id} style={{ background: PHASE_COLOR[st.phase] }} />
                    ))}
                  </span>
                  <small className="muted">{plural(r.steps.length, 'step')}</small>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}

/** The reusable library: recipes not tied to a miniature. */
export function RecipesPage() {
  const { data: recipes, error } = useRecipes();
  const [creating, setCreating] = useState(false);
  return (
    <div className={s.page}>
      <header className={s.sectionHead}>
        <div>
          <h1>Recipes</h1>
          <p className="muted">Your reusable schemes. Using one on a miniature makes a copy you can tick off and tweak.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          <Icon name="plus" /> New recipe
        </button>
      </header>
      {error && <p className="error-banner">{error.message}</p>}
      {recipes?.length === 0 && <p className={`muted ${s.none}`}>The library is empty. Create a recipe here, or save one from a miniature with "Save to library".</p>}
      <div className={s.list}>
        {recipes?.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </div>
      {creating && <RecipeEditor miniatureId={null} onClose={() => setCreating(false)} />}
    </div>
  );
}
