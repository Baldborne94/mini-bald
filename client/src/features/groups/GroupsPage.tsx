import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { STATUSES, emptyCounts, type Group } from '@minibald/shared';
import { useDeleteGroup, useGroups, useSaveGroup } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { StatusBar, percentFinished } from '../../components/status.tsx';
import { plural } from '../../lib/format.ts';
import s from './Groups.module.css';

const KINDS = ['Game system', 'Faction', 'Army', 'Project', 'Showcase', 'Warband'];
// A fixed, theme-independent set so a group keeps its colour whatever theme is active.
const COLORS = ['#ff3d8b', '#f0432c', '#ff6a1f', '#ffb020', '#a6f04b', '#2c9a3e', '#2ee6d6', '#0d8fd1', '#2b3fe0', '#7b5cff', '#b0703c', '#8b84a3'];

type Editing = { group?: Group; parentId?: number };

export function GroupsPage() {
  const { data: groups, error } = useGroups();
  const [editing, setEditing] = useState<Editing | null>(null);
  const top = groups?.filter((g) => g.parentId === null) ?? [];

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1>Groups</h1>
          <p className="muted">Factions, game systems, projects, display shelves — organise however you like.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({})}>
          <Icon name="plus" /> New group
        </button>
      </header>

      {error && <p className="error-banner">{error.message}</p>}
      {groups?.length === 0 && <p className={`muted ${s.empty}`}>No groups yet. Create one for a faction, a game system or a project.</p>}

      <div className={s.grid}>
        {top.map((group, i) => {
          const children = groups!.filter((g) => g.parentId === group.id);
          // A parent's progress includes everything filed under its sub-groups.
          const total = emptyCounts();
          for (const g of [group, ...children]) for (const st of STATUSES) total[st] += g.counts[st];
          const models = STATUSES.reduce((sum, st) => sum + total[st], 0);
          return (
            <section key={group.id} className={`card ${s.group}`} style={{ '--c': group.color ?? 'var(--muted)', '--i': i } as React.CSSProperties}>
              <header>
                <Link to={`/minis?group=${group.id}`} className={s.groupTitle}>
                  {group.kind && <span className="eyebrow">{group.kind}</span>}
                  <h2>{group.name}</h2>
                </Link>
                <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setEditing({ group })} aria-label={`Edit ${group.name}`}>
                  <Icon name="edit" size={16} />
                </button>
              </header>
              {group.description && <p className="muted">{group.description}</p>}
              <div className={s.progress}>
                <b>{percentFinished(total)}%</b>
                <span className="muted">{plural(models, 'model')} · {total.finished} finished</span>
              </div>
              <StatusBar counts={total} />
              {children.length > 0 && (
                <ul className={s.children}>
                  {children.map((child) => (
                    <li key={child.id} style={{ '--c': child.color ?? group.color ?? 'var(--muted)' } as React.CSSProperties}>
                      <Link to={`/minis?group=${child.id}`}>
                        <i />
                        <span>{child.name}</span>
                        <small className="muted">{percentFinished(child.counts)}%</small>
                      </Link>
                      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setEditing({ group: child })} aria-label={`Edit ${child.name}`}>
                        <Icon name="edit" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <footer>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing({ parentId: group.id })}>
                  <Icon name="plus" size={14} /> Sub-group
                </button>
                <Link to={`/minis/new?group=${group.id}`} className="btn btn--sm">
                  <Icon name="plus" size={14} /> Miniature
                </Link>
              </footer>
            </section>
          );
        })}
      </div>

      {editing && <GroupForm editing={editing} groups={groups ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GroupForm({ editing, groups, onClose }: { editing: Editing; groups: Group[]; onClose: () => void }) {
  const { group } = editing;
  const save = useSaveGroup();
  const remove = useDeleteGroup();
  const [form, setForm] = useState({
    name: group?.name ?? '',
    kind: group?.kind ?? '',
    description: group?.description ?? '',
    color: group?.color ?? COLORS[groups.length % COLORS.length]!,
    parentId: String(group?.parentId ?? editing.parentId ?? ''),
  });
  const patch = (changes: Partial<typeof form>) => setForm((f) => ({ ...f, ...changes }));
  const hasChildren = group ? groups.some((g) => g.parentId === group.id) : false;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: group?.id, name: form.name, kind: form.kind, description: form.description, color: form.color, parentId: form.parentId ? Number(form.parentId) : null },
      { onSuccess: onClose },
    );
  };
  const onDelete = () => {
    if (!group || !confirm(`Delete the group "${group.name}"? Its miniatures are kept and become ungrouped.`)) return;
    remove.mutate(group.id, { onSuccess: onClose });
  };

  return (
    <Modal title={group ? 'Edit group' : 'New group'} onClose={onClose}>
      <form className={s.form} onSubmit={onSubmit}>
        <label className="field">
          <span>Name</span>
          <input className="input" required maxLength={120} autoFocus value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Ultramarines, Kill Team, Display cabinet" />
        </label>
        <label className="field">
          <span>Kind (free text)</span>
          <input className="input" list="group-kinds" maxLength={60} value={form.kind} onChange={(e) => patch({ kind: e.target.value })} placeholder="Faction, game system, project…" />
        </label>
        <datalist id="group-kinds">
          {KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        {!hasChildren && (
          <label className="field">
            <span>Inside</span>
            <select className="input" value={form.parentId} onChange={(e) => patch({ parentId: e.target.value })}>
              <option value="">— Top level —</option>
              {groups
                .filter((g) => g.parentId === null && g.id !== group?.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Colour</span>
          <div className={s.colors}>
            {COLORS.map((c) => (
              <button type="button" key={c} className={c === form.color ? s.colorOn : ''} style={{ background: c }} onClick={() => patch({ color: c })} aria-label={`Colour ${c}`} aria-pressed={c === form.color} />
            ))}
            <input type="color" value={form.color} onChange={(e) => patch({ color: e.target.value })} aria-label="Custom colour" />
          </div>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea className="input" value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        {(save.error || remove.error) && <p className="error-banner">{(save.error ?? remove.error)!.message}</p>}
        <footer className={s.formActions}>
          {group && (
            <button type="button" className="btn btn--ghost btn--danger" onClick={onDelete}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {group ? 'Save' : 'Create group'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
