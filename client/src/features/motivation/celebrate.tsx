import { useEffect, useRef, useState } from 'react';
import type { Achievement, Miniature } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { useAchievements, useMarkAchievementsSeen } from '../../api/hooks.ts';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { formatDuration } from '../../lib/format.ts';
import s from './Motivation.module.css';

type Finished = Pick<Miniature, 'id' | 'name' | 'coverPhotoId' | 'paintedSeconds' | 'quantity'>;

// The miniature page announces a finished model here; the overlay mounted in the app shell listens.
let onFinished: ((mini: Finished) => void) | null = null;
export const celebrateFinished = (mini: Finished) => onFinished?.(mini);

/** A short burst of paint-coloured confetti on a canvas. Skipped when the user prefers reduced motion. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const css = getComputedStyle(document.documentElement);
    const colors = [1, 2, 3, 4, 5, 6].map((n) => css.getPropertyValue(`--paint-${n}`).trim() || '#ff3d8b');
    const ratio = Math.min(devicePixelRatio, 2);
    const w = (canvas.width = innerWidth * ratio);
    const h = (canvas.height = innerHeight * ratio);
    const pieces = Array.from({ length: 140 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.42,
      vx: (Math.random() - 0.5) * 22 * ratio,
      vy: (-Math.random() * 20 - 6) * ratio,
      size: (5 + Math.random() * 7) * ratio,
      spin: Math.random() * 6,
      vs: (Math.random() - 0.5) * 0.4,
      color: colors[i % colors.length]!,
      round: i % 3 === 0,
    }));
    const started = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const age = t - started;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1800) / 900);
      for (const p of pieces) {
        p.vy += 0.5 * ratio;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.vs;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (age < 2700) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} className={s.confetti} aria-hidden="true" />;
}

export function Medal({ badge, size = 64 }: { badge: Pick<Achievement, 'icon' | 'paint' | 'unlockedAt'>; size?: number }) {
  return (
    <span className={`${s.medal} ${badge.unlockedAt ? '' : s.medalLocked}`} style={{ '--c': `var(--paint-${badge.paint})`, width: size, height: size } as React.CSSProperties}>
      <Icon name={badge.icon as IconName} size={size * 0.45} />
    </span>
  );
}

/**
 * Mounted once in the app shell. Shows the "finished" moment and any badge that has just been
 * earned, one after the other, then records the badges as seen so they celebrate only once.
 */
export function Celebrations() {
  const { data: achievements } = useAchievements();
  const markSeen = useMarkAchievementsSeen();
  const [finished, setFinished] = useState<Finished | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    onFinished = setFinished;
    return () => {
      onFinished = null;
    };
  }, []);

  const fresh = achievements?.find((a) => a.unlockedAt && !a.seen && !dismissed.has(a.key));
  // The finished moment goes first; badges earned by it follow.
  const badge = finished ? undefined : fresh;
  if (!finished && !badge) return null;

  const close = () => {
    if (finished) return setFinished(null);
    if (badge) {
      setDismissed((prev) => new Set(prev).add(badge.key));
      markSeen.mutate([badge.key]);
    }
  };

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={finished ? 'Miniature finished' : 'Badge unlocked'} onClick={close}>
      <Confetti key={finished ? `m${finished.id}` : badge!.key} />
      <div className={s.party} onClick={(e) => e.stopPropagation()}>
        {finished ? (
          <>
            <p className="eyebrow">Off the bench</p>
            {finished.coverPhotoId && <img className={s.partyPhoto} src={thumbUrl(finished.coverPhotoId, 800)} alt="" />}
            <h2>{finished.name} is finished!</h2>
            <p className="muted">
              {finished.quantity > 1 ? `${finished.quantity} models off the pile of shame.` : 'One less on the pile of shame.'}
              {finished.paintedSeconds >= 60 && ` ${formatDuration(finished.paintedSeconds)} at the brush.`}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">Badge unlocked</p>
            <span className={s.partyMedal}>
              <Medal badge={badge!} size={112} />
            </span>
            <h2>{badge!.title}</h2>
            <p className="muted">{badge!.description}</p>
          </>
        )}
        <button type="button" className="btn btn--primary" autoFocus onClick={close}>
          {finished ? 'Nice' : 'Collect'}
        </button>
      </div>
    </div>
  );
}
