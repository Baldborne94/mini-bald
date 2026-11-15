import { useState } from 'react';
import { Icon } from './Icon.tsx';
import s from './components.module.css';

export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('');
  const has = (tag: string) => value.some((v) => v.toLowerCase() === tag.toLowerCase());

  const commit = (raw: string) => {
    const added = raw.split(',').map((t) => t.trim()).filter((t) => t && !has(t));
    if (added.length > 0) onChange([...value, ...added]);
    setDraft('');
  };

  return (
    <div className={s.tagInput}>
      {value.map((tag) => (
        <button type="button" key={tag} className="chip chip--tag" onClick={() => onChange(value.filter((t) => t !== tag))} aria-label={`Remove tag ${tag}`}>
          {tag} <Icon name="x" size={12} />
        </button>
      ))}
      <input
        value={draft}
        list="tag-suggestions"
        placeholder={value.length === 0 ? 'Add tags (Enter or comma)' : 'Add…'}
        onChange={(e) => (e.target.value.includes(',') ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
      />
      <datalist id="tag-suggestions">
        {suggestions.filter((t) => !has(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
