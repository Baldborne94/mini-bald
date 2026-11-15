import { useState } from 'react';
import type { Miniature } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { Modal } from '../../components/Modal.tsx';
import { formatDate } from '../../lib/format.ts';
import s from './Miniature.module.css';

/** Before/after slider between any two photos; defaults to the oldest and the newest. */
export function Compare({ mini, onClose }: { mini: Miniature; onClose: () => void }) {
  const photos = mini.photos; // newest first
  const [beforeId, setBeforeId] = useState(photos.at(-1)!.id);
  const [afterId, setAfterId] = useState(photos[0]!.id);
  const [pos, setPos] = useState(50);
  const before = photos.find((p) => p.id === beforeId)!;
  const after = photos.find((p) => p.id === afterId)!;

  const picker = (label: string, value: number, onChange: (id: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[...photos].reverse().map((p, i) => (
          <option key={p.id} value={p.id}>
            {i + 1}. {formatDate(p.takenAt)}
            {p.caption ? ` — ${p.caption}` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal title="Before / after" onClose={onClose} wide>
      <div className={s.compare}>
        <div className={s.compareStage} style={{ '--pos': `${pos}%` } as React.CSSProperties}>
          <img src={thumbUrl(after.id, 1600)} alt={`After, ${formatDate(after.takenAt)}`} />
          <img src={thumbUrl(before.id, 1600)} alt={`Before, ${formatDate(before.takenAt)}`} className={s.compareBefore} />
          <span className={s.compareLine} aria-hidden="true" />
          <span className={`${s.compareTag} ${s.compareTagBefore}`}>Before</span>
          <span className={`${s.compareTag} ${s.compareTagAfter}`}>After</span>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Slide between before and after" />
        </div>
        <div className={s.comparePickers}>
          {picker('Before', beforeId, setBeforeId)}
          {picker('After', afterId, setAfterId)}
        </div>
      </div>
    </Modal>
  );
}
