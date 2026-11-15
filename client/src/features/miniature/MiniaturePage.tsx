import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Miniature, Photo } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { useDeleteMiniature, useMiniature, useSetStatus, useUploadPhotos } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { Smear } from '../../components/MiniCard.tsx';
import { StatusPill, StatusStepper, statusColor } from '../../components/status.tsx';
import { dayKey, formatDate, formatDay, plural } from '../../lib/format.ts';
import { Lightbox } from './Lightbox.tsx';
import s from './Miniature.module.css';

export function MiniaturePage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: mini, error } = useMiniature(id);
  const setStatus = useSetStatus(id);
  const remove = useDeleteMiniature();
  const [openPhoto, setOpenPhoto] = useState<number | null>(null);

  if (error) return <p className="error-banner">{error.message}</p>;
  if (!mini) return null;

  const onDelete = () => {
    if (!confirm(`Delete "${mini.name}"? Its photos are moved to the trash folder, not erased.`)) return;
    remove.mutate(id, { onSuccess: () => navigate('/minis', { replace: true }) });
  };

  return (
    <article className={s.page} style={{ '--c': statusColor(mini.status) } as React.CSSProperties}>
      <div className={s.hero}>
        <button type="button" className={s.heroMedia} onClick={() => mini.coverPhotoId && setOpenPhoto(mini.coverPhotoId)} aria-label="Open cover photo">
          {mini.coverPhotoId ? (
            <img src={thumbUrl(mini.coverPhotoId, 1600)} alt={mini.name} />
          ) : (
            <Smear seed={`${mini.id}-${mini.name}`} letter={mini.name.charAt(0).toUpperCase()} />
          )}
        </button>
        <div className={s.heroBody}>
          <Link to={mini.group ? `/minis?group=${mini.group.id}` : '/minis?group=none'} className="eyebrow">
            {mini.group?.name ?? 'Ungrouped'}
          </Link>
          <h1>{mini.name}</h1>
          <div className={s.meta}>
            <StatusPill status={mini.status} />
            {mini.quantity > 1 && <span className="chip chip--tag">{plural(mini.quantity, 'model')}</span>}
            {mini.tags.map((tag) => (
              <Link key={tag} to={`/minis?tag=${encodeURIComponent(tag)}`} className="chip chip--tag">
                #{tag}
              </Link>
            ))}
          </div>
          <div className={s.actions}>
            <Link to={`/minis/${id}/edit`} className="btn btn--sm">
              <Icon name="edit" size={16} /> Edit
            </Link>
            <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={onDelete}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </div>
        </div>
      </div>

      <section className={`card ${s.block}`}>
        <StatusStepper value={mini.status} onChange={(status) => setStatus.mutate(status)} busy={setStatus.isPending} />
        {setStatus.error && <p className="error-banner">{setStatus.error.message}</p>}
      </section>

      {(mini.description || mini.notes) && (
        <section className={s.texts}>
          {mini.description && (
            <div>
              <p className="eyebrow">Description</p>
              <p className={s.prose}>{mini.description}</p>
            </div>
          )}
          {mini.notes && (
            <div>
              <p className="eyebrow">Notes</p>
              <p className={s.prose}>{mini.notes}</p>
            </div>
          )}
        </section>
      )}

      <dl className={s.dates}>
        {mini.acquiredOn && <Fact label="Acquired" value={formatDate(mini.acquiredOn)} />}
        <Fact label="Added" value={formatDate(mini.createdAt)} />
        {mini.startedAt && <Fact label="Started" value={formatDate(mini.startedAt)} />}
        {mini.finishedAt && <Fact label="Finished" value={formatDate(mini.finishedAt)} />}
      </dl>

      <PhotoSection mini={mini} onOpen={setOpenPhoto} />

      {openPhoto !== null && <Lightbox mini={mini} photoId={openPhoto} onNavigate={setOpenPhoto} onClose={() => setOpenPhoto(null)} />}
    </article>
  );
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="eyebrow">{label}</dt>
    <dd>{value}</dd>
  </div>
);

function PhotoSection({ mini, onOpen }: { mini: Miniature; onOpen: (id: number) => void }) {
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const upload = useUploadPhotos(mini.id, (done, total) => setProgress([done, total]));
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // allow picking the same file again
    if (files.length > 0) upload.mutate(files, { onSettled: () => setProgress(null) });
  };

  // Timeline: newest day first, each day a row of shots.
  const days: { key: string; photos: Photo[] }[] = [];
  for (const photo of mini.photos) {
    const key = dayKey(photo.takenAt);
    const last = days.at(-1);
    if (last?.key === key) last.photos.push(photo);
    else days.push({ key, photos: [photo] });
  }

  return (
    <section className={s.photos}>
      <header className={s.photosHead}>
        <h2>Photo timeline</h2>
        <div className={s.photoButtons}>
          {/* `capture` opens the camera directly on phones; the second button offers the gallery. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
          <button type="button" className="btn btn--primary" disabled={upload.isPending} onClick={() => cameraRef.current?.click()}>
            <Icon name="camera" /> Take photo
          </button>
          <button type="button" className="btn" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> Upload
          </button>
        </div>
      </header>

      {progress && (
        <p className={s.uploading} role="status">
          <i /> Uploading {Math.min(progress[0] + 1, progress[1])} of {progress[1]}…
        </p>
      )}
      {upload.error && <p className="error-banner">Upload failed: {upload.error.message}</p>}

      {days.length === 0 ? (
        <p className={`muted ${s.noPhotos}`}>No photos yet. Take the "before" shot now — future you will love the comparison.</p>
      ) : (
        <ol className={s.timeline}>
          {days.map((day) => (
            <li key={day.key}>
              <p className={s.day}>{formatDay(day.photos[0]!.takenAt)}</p>
              <div className={s.shots}>
                {day.photos.map((photo) => (
                  <button
                    type="button"
                    key={photo.id}
                    className={s.shot}
                    style={{ '--c': photo.stage ? statusColor(photo.stage) : 'var(--line)' } as React.CSSProperties}
                    onClick={() => onOpen(photo.id)}
                    aria-label={`Open photo${photo.caption ? `: ${photo.caption}` : ''}`}
                  >
                    <img src={thumbUrl(photo.id, 400)} alt={photo.caption ?? ''} loading="lazy" />
                    {mini.coverPhotoId === photo.id && (
                      <span className={s.coverBadge}>
                        <Icon name="star" size={12} filled />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className={`muted ${s.folder}`}>
        On disk: <code>{mini.folder}/</code>
      </p>
    </section>
  );
}

