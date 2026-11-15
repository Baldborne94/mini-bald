import { useEffect, useState } from 'react';
import { STATUS_LABELS, type Miniature } from '@minibald/shared';
import { photoUrl } from '../../api/client.ts';
import { useDeletePhoto, useSetCover, useUpdatePhoto } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Modal } from '../../components/Modal.tsx';
import { StatusPill } from '../../components/status.tsx';
import { formatDate } from '../../lib/format.ts';
import s from './Miniature.module.css';

export function Lightbox({ mini, photoId, onNavigate, onClose }: { mini: Miniature; photoId: number; onNavigate: (id: number) => void; onClose: () => void }) {
  const index = mini.photos.findIndex((p) => p.id === photoId);
  const photo = mini.photos[index];
  const update = useUpdatePhoto();
  const remove = useDeletePhoto();
  const setCover = useSetCover(mini.id);
  const [caption, setCaption] = useState(photo?.caption ?? '');
  useEffect(() => setCaption(photo?.caption ?? ''), [photo?.id, photo?.caption]);

  // The timeline is newest-first, so "previous" (older) is the next index.
  const older = mini.photos[index + 1];
  const newer = mini.photos[index - 1];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' && older) onNavigate(older.id);
      if (e.key === 'ArrowRight' && newer) onNavigate(newer.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!photo) return null;
  const isCover = mini.hasExplicitCover && mini.coverPhotoId === photo.id;

  const onDelete = () => {
    if (!confirm('Delete this photo? The file is moved to the trash folder.')) return;
    const fallback = newer ?? older;
    remove.mutate(photo.id, { onSuccess: () => (fallback ? onNavigate(fallback.id) : onClose()) });
  };

  return (
    <Modal title={`${index + 1} / ${mini.photos.length}`} onClose={onClose} wide>
      <div className={s.lightbox}>
        <div className={s.lightboxStage}>
          <img key={photo.id} src={photoUrl(photo.id)} alt={photo.caption ?? mini.name} />
          {older && (
            <button type="button" className={`btn btn--icon ${s.navPrev}`} onClick={() => onNavigate(older.id)} aria-label="Older photo">
              <Icon name="left" />
            </button>
          )}
          {newer && (
            <button type="button" className={`btn btn--icon ${s.navNext}`} onClick={() => onNavigate(newer.id)} aria-label="Newer photo">
              <Icon name="right" />
            </button>
          )}
        </div>
        <div className={s.lightboxSide}>
          <div className={s.meta}>
            <span className="chip chip--tag">{formatDate(photo.takenAt)}</span>
            {photo.stage && <StatusPill status={photo.stage} />}
          </div>
          <label className="field">
            <span>Caption</span>
            <input
              className="input"
              value={caption}
              placeholder={photo.stage ? `e.g. ${STATUS_LABELS[photo.stage]}, first glaze on the cloak` : 'What does this shot show?'}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => caption !== (photo.caption ?? '') && update.mutate({ id: photo.id, caption })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
          <div className={s.lightboxActions}>
            <button type="button" className={`btn btn--sm ${isCover ? 'btn--accent' : ''}`} onClick={() => setCover.mutate(isCover ? null : photo.id)}>
              <Icon name="star" size={16} filled={isCover} /> {isCover ? 'Cover photo' : 'Use as cover'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={onDelete}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
