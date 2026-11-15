import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { STATUSES, STATUS_LABELS, type Status } from '@minibald/shared';
import { useGroups, useMiniature, useSaveMiniature, useTags } from '../../api/hooks.ts';
import { TagInput } from '../../components/TagInput.tsx';
import { groupOptions } from '../catalog/Catalog.tsx';
import s from './Miniature.module.css';

const blank = { name: '', groupId: '', status: 'unassembled' as Status, quantity: 1, description: '', notes: '', acquiredOn: '', tags: [] as string[] };

export function MiniatureForm() {
  const params = useParams();
  const id = params.id ? Number(params.id) : undefined;
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const { data: existing } = useMiniature(id);
  const { data: groups = [] } = useGroups();
  const { data: tags = [] } = useTags();
  const save = useSaveMiniature();
  const [form, setForm] = useState({ ...blank, groupId: query.get('group') ?? '' });
  const patch = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));

  // Fill the form once when editing; later refetches must not overwrite what is being typed.
  const loadedId = existing && id === existing.id ? existing.id : undefined;
  useEffect(() => {
    if (!existing || loadedId === undefined) return;
    setForm({
      name: existing.name,
      groupId: existing.group ? String(existing.group.id) : '',
      status: existing.status,
      quantity: existing.quantity,
      description: existing.description ?? '',
      notes: existing.notes ?? '',
      acquiredOn: existing.acquiredOn ?? '',
      tags: existing.tags,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        id,
        name: form.name,
        groupId: form.groupId ? Number(form.groupId) : null,
        quantity: form.quantity,
        description: form.description,
        notes: form.notes,
        acquiredOn: form.acquiredOn || null,
        tags: form.tags,
        // Status is only set here on creation; afterwards it changes through the bottle rack.
        ...(id === undefined && { status: form.status }),
      },
      { onSuccess: (mini) => navigate(`/minis/${mini.id}`, { replace: true }) },
    );
  };

  return (
    <form className={s.form} onSubmit={onSubmit}>
      <header>
        <p className="eyebrow">{id ? 'Editing' : 'New miniature'}</p>
        <h1>{id ? existing?.name ?? ' ' : 'What did you get?'}</h1>
      </header>

      <label className="field">
        <span>Name</span>
        <input className="input" required maxLength={160} autoFocus={!id} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Intercessor Squad, Gloomspite Loonboss…" />
      </label>

      <div className={s.formRow}>
        <label className="field">
          <span>Group</span>
          <select className="input" value={form.groupId} onChange={(e) => patch({ groupId: e.target.value })}>
            <option value="">Ungrouped</option>
            {groupOptions(groups).map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Models in this card</span>
          <input className="input" type="number" min={1} max={999} required value={form.quantity} onChange={(e) => patch({ quantity: Number(e.target.value) })} />
        </label>
      </div>

      {id === undefined && (
        <fieldset className={s.statusPick}>
          <legend>Where is it now?</legend>
          {STATUSES.map((st) => (
            <label key={st} className={`chip ${form.status === st ? 'chip--on' : ''}`}>
              <input type="radio" name="status" value={st} checked={form.status === st} onChange={() => patch({ status: st })} />
              {STATUS_LABELS[st]}
            </label>
          ))}
        </fieldset>
      )}

      <div className="field">
        <span>Tags</span>
        <TagInput value={form.tags} onChange={(next) => patch({ tags: next })} suggestions={tags.map((t) => t.name)} />
      </div>

      <label className="field">
        <span>Description</span>
        <textarea className="input" value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Kit, loadout, conversions…" />
      </label>

      <label className="field">
        <span>Notes</span>
        <textarea className="input" value={form.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Ideas for the scheme, things to fix, basing plans…" />
      </label>

      <label className="field">
        <span>Acquired on</span>
        <input className="input" type="date" value={form.acquiredOn} onChange={(e) => patch({ acquiredOn: e.target.value })} />
      </label>

      {save.error && <p className="error-banner">{save.error.message}</p>}

      <footer className={s.formActions}>
        <Link to={id ? `/minis/${id}` : '/minis'} className="btn btn--ghost">
          Cancel
        </Link>
        <button type="submit" className="btn btn--primary" disabled={save.isPending}>
          {id ? 'Save changes' : 'Add to the collection'}
        </button>
      </footer>
    </form>
  );
}
