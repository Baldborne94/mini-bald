import { useRef, useState, type FormEvent } from 'react';
import { PHASE_LABELS, RECIPE_PHASES, paintLabel, type Recipe, type RecipePhase } from '@minibald/shared';
import { usePaints, useSaveRecipe } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { PHASE_COLOR } from './recipes.tsx';
import s from './Recipes.module.css';

const TECHNIQUES = ['Basecoat', 'Layer', 'Wash', 'Recess wash', 'Drybrush', 'Glaze', 'Edge highlight', 'Stipple', 'Wet blend', 'Contrast', 'Airbrush', 'Sponge', 'Dot highlight'];

interface Draft {
  key: number;
  id?: number;
  phase: RecipePhase;
  area: string;
  paint: string;
  technique: string;
  notes: string;
}

/** Create a recipe (for `miniatureId`, or the library when null) or edit an existing one. */
export function RecipeEditor({ recipe, miniatureId, onClose }: { recipe?: Recipe; miniatureId?: number | null; onClose: () => void }) {
  const { data: paints = [] } = usePaints();
  const save = useSaveRecipe();
  const nextKey = useRef(0);
  const blank = (phase: RecipePhase = 'base'): Draft => ({ key: nextKey.current++, phase, area: '', paint: '', technique: '', notes: '' });

  const [name, setName] = useState(recipe?.name ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [steps, setSteps] = useState<Draft[]>(() =>
    recipe && recipe.steps.length > 0
      ? recipe.steps.map((st) => ({ key: nextKey.current++, id: st.id, phase: st.phase, area: st.area ?? '', paint: st.paintLabel ?? '', technique: st.technique ?? '', notes: st.notes ?? '' }))
      : [blank()],
  );

  const patch = (key: number, changes: Partial<Draft>) => setSteps((list) => list.map((st) => (st.key === key ? { ...st, ...changes } : st)));
  const move = (index: number, by: -1 | 1) =>
    setSteps((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  // A new step continues with the phase after the last one: base → shade → layer → highlight…
  const addStep = () =>
    setSteps((list) => {
      const last = list.at(-1)?.phase ?? 'prime';
      const following = RECIPE_PHASES[Math.min(RECIPE_PHASES.indexOf(last) + 1, RECIPE_PHASES.indexOf('detail'))]!;
      return [...list, blank(RECIPE_PHASES.indexOf(last) >= RECIPE_PHASES.indexOf('detail') ? last : following)];
    });

  // The paint field is free text with the inventory as suggestions: an exact match links the step to that paint.
  const byLabel = new Map(paints.map((p) => [paintLabel(p).toLowerCase(), p]));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const payload = steps
      .filter((st) => st.area || st.paint || st.technique || st.notes)
      .map((st) => {
        const paint = byLabel.get(st.paint.trim().toLowerCase());
        return { id: st.id, phase: st.phase, area: st.area, technique: st.technique, notes: st.notes, paintId: paint?.id ?? null, paintLabel: paint ? null : st.paint };
      });
    save.mutate(
      recipe ? { id: recipe.id, name, description, steps: payload } : { name, description, miniatureId: miniatureId ?? null, steps: payload },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title={recipe ? 'Edit recipe' : 'New recipe'} onClose={onClose} wide>
      <form className={s.editor} onSubmit={onSubmit}>
        <div className={s.editorTop}>
          <label className="field">
            <span>Name</span>
            <input className="input" required maxLength={140} autoFocus={!recipe} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ultramarine blue armour" />
          </label>
          <label className="field">
            <span>Description</span>
            <input className="input" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional: the look you are going for" />
          </label>
        </div>

        <ol className={s.drafts}>
          {steps.map((st, i) => {
            const linked = byLabel.get(st.paint.trim().toLowerCase());
            return (
              <li key={st.key} style={{ '--c': PHASE_COLOR[st.phase] } as React.CSSProperties}>
                <span className={s.draftNo}>{i + 1}</span>
                <select className="input" value={st.phase} onChange={(e) => patch(st.key, { phase: e.target.value as RecipePhase })} aria-label={`Step ${i + 1} phase`}>
                  {RECIPE_PHASES.map((ph) => (
                    <option key={ph} value={ph}>
                      {PHASE_LABELS[ph]}
                    </option>
                  ))}
                </select>
                <input className="input" maxLength={80} value={st.area} onChange={(e) => patch(st.key, { area: e.target.value })} placeholder="Area (armour, cloak…)" aria-label={`Step ${i + 1} area`} />
                <span className={s.draftPaint}>
                  <i style={{ background: linked?.colorHex ?? 'transparent' }} className={linked?.colorHex ? '' : s.noColor} />
                  <input className="input" maxLength={140} list="recipe-paints" value={st.paint} onChange={(e) => patch(st.key, { paint: e.target.value })} placeholder="Paint" aria-label={`Step ${i + 1} paint`} />
                </span>
                <input className={`input ${s.draftTech}`} maxLength={80} list="recipe-techniques" value={st.technique} onChange={(e) => patch(st.key, { technique: e.target.value })} placeholder="Technique" aria-label={`Step ${i + 1} technique`} />
                <input className={`input ${s.draftNotes}`} maxLength={1000} value={st.notes} onChange={(e) => patch(st.key, { notes: e.target.value })} placeholder="Notes (ratio, where to stop…)" aria-label={`Step ${i + 1} notes`} />
                <span className={s.draftTools}>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <Icon name="down" size={16} />
                  </button>
                  <button type="button" className="btn btn--ghost btn--icon btn--sm btn--danger" onClick={() => setSteps((list) => list.filter((x) => x.key !== st.key))} aria-label="Remove step">
                    <Icon name="x" size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <datalist id="recipe-paints">
          {paints.map((p) => (
            <option key={p.id} value={paintLabel(p)}>
              {[p.range, p.type].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
        <datalist id="recipe-techniques">
          {TECHNIQUES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <button type="button" className={`btn ${s.addStep}`} onClick={addStep}>
          <Icon name="plus" /> Add step
        </button>

        {save.error && <p className="error-banner">{save.error.message}</p>}
        <footer className={s.editorActions}>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            Save recipe
          </button>
        </footer>
      </form>
    </Modal>
  );
}
