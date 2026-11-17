import { useEffect, useState, type FormEvent } from 'react';
import { PHASE_LABELS, STOCK_LABELS, type AiRun, type Miniature } from '@minibald/shared';
import { thumbUrl } from '../../api/client.ts';
import { useAiRuns, useAiStatus, useAskAi, useDeleteAiRun, useSaveAiRecipe } from '../../api/hooks.ts';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { Pot, statusColor } from '../../components/status.tsx';
import { formatDate } from '../../lib/format.ts';
import { PHASE_COLOR } from '../recipes/recipes.tsx';
import s from './Ai.module.css';

type Kind = AiRun['kind'];
const MODES: { kind: Kind; label: string; icon: IconName; blurb: string; cta: string }[] = [
  { kind: 'recipe', label: 'How do I paint it?', icon: 'spark', blurb: 'A step-by-step recipe built around the paints you own.', cta: 'Suggest a recipe' },
  { kind: 'feedback', label: 'Give me feedback', icon: 'eye', blurb: 'An honest look at a work-in-progress photo, with concrete fixes.', cta: 'Review this photo' },
  { kind: 'tutorials', label: 'Find tutorials', icon: 'link', blurb: 'Guides, videos and painted examples for this model from the web.', cta: 'Search the web' },
];
const WAITING = ['Laying out the paints…', 'Studying the sculpt…', 'Thinning with a drop of water…', 'Checking the wet palette…', 'Picking the right brush…'];

/** The three AI helpers on a miniature page, plus the answers given so far. */
export function Assistant({ mini }: { mini: Miniature }) {
  const { data: status } = useAiStatus();
  const { data: runs = [] } = useAiRuns(mini.id);
  const ask = useAskAi();
  const [kind, setKind] = useState<Kind>('recipe');
  const [text, setText] = useState('');
  const [photoId, setPhotoId] = useState<number | null>(mini.photos[0]?.id ?? null);
  const [openId, setOpenId] = useState<number | null>(null);
  const mode = MODES.find((m) => m.kind === kind)!;

  // The suggested photo follows the newest upload until the user picks one.
  useEffect(() => {
    setPhotoId((current) => (current !== null && mini.photos.some((p) => p.id === current) ? current : (mini.photos[0]?.id ?? null)));
  }, [mini.photos]);

  const needsPhoto = kind === 'feedback';
  const usesPhoto = kind !== 'tutorials';
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask.mutate(
      {
        kind,
        miniatureId: mini.id,
        ...(usesPhoto && photoId !== null && { photoId }),
        ...(text.trim() && { [kind === 'recipe' ? 'scheme' : kind === 'feedback' ? 'focus' : 'query']: text }),
      },
      {
        onSuccess: (run) => {
          setOpenId(run.id);
          setText('');
        },
      },
    );
  };

  if (!status) return null;
  return (
    <section className={s.section}>
      <header>
        <h2>
          <Icon name="spark" /> Assistant
        </h2>
      </header>

      {!status.configured ? (
        <p className={s.off}>
          The assistant is switched off. Add <code>ANTHROPIC_API_KEY</code> to your <code>.env</code> file and restart the container to get painting recipes, feedback on your photos and tutorial searches. Everything else works without it.
        </p>
      ) : (
        <form className={`card ${s.form}`} onSubmit={onSubmit}>
          <div className={s.modes} role="tablist">
            {MODES.map((m) => (
              <button key={m.kind} type="button" role="tab" aria-selected={m.kind === kind} className={`${s.mode} ${m.kind === kind ? s.modeOn : ''}`} disabled={ask.isPending} onClick={() => { setKind(m.kind); ask.reset(); }}>
                <Icon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <p className="muted">{mode.blurb}</p>

          {ask.isPending ? (
            <Waiting />
          ) : (
            <>
              <label className="field">
                <span>{kind === 'recipe' ? 'The scheme you have in mind (optional)' : kind === 'feedback' ? 'Anything to look at in particular? (optional)' : 'Narrow it down (optional)'}</span>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={kind === 'tutorials' ? 300 : kind === 'feedback' ? 1000 : 2000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={kind === 'recipe' ? 'e.g. dark green armour, bone cloak, weathered and gritty' : kind === 'feedback' ? 'e.g. are the highlights on the cloak too stark?' : 'e.g. non-metallic metal, beginner friendly, video'}
                />
              </label>

              {usesPhoto &&
                (mini.photos.length === 0 ? (
                  <p className="muted">{needsPhoto ? 'Add a photo below first: feedback is based on what the model can see.' : 'No photos yet. A photo helps, but is not required.'}</p>
                ) : (
                  <div className="field">
                    <span>{needsPhoto ? 'Photo to review' : 'Photo to show (optional)'}</span>
                    <div className={s.photos} role="radiogroup">
                      {!needsPhoto && (
                        <button type="button" role="radio" aria-checked={photoId === null} className={`${s.photo} ${s.noPhoto} ${photoId === null ? s.photoOn : ''}`} onClick={() => setPhotoId(null)}>
                          No photo
                        </button>
                      )}
                      {mini.photos.slice(0, 12).map((p) => (
                        <button key={p.id} type="button" role="radio" aria-checked={photoId === p.id} aria-label={`Photo from ${formatDate(p.takenAt)}`} className={`${s.photo} ${photoId === p.id ? s.photoOn : ''}`} onClick={() => setPhotoId(p.id)}>
                          <img src={thumbUrl(p.id, 200)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {ask.error && <p className="error-banner">{ask.error.message}</p>}
              <footer>
                <button type="submit" className="btn btn--primary" disabled={needsPhoto && photoId === null}>
                  <Icon name={mode.icon} /> {mode.cta}
                </button>
                <small className="muted">
                  Sends this miniature's details{kind === 'recipe' && ', your paint list'}
                  {usesPhoto && photoId !== null && ' and the selected photo'} to {status.provider} ({status.model}).
                </small>
              </footer>
            </>
          )}
        </form>
      )}

      {runs.length > 0 && (
        <ul className={s.runs}>
          {runs.map((run) => (
            <RunCard key={run.id} run={run} open={openId === run.id} onToggle={() => setOpenId(openId === run.id ? null : run.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Waiting() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((n) => n + 1), 2600);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={s.waiting} role="status">
      <div className={s.waitingPots} aria-hidden="true">
        {(['assembled', 'primed', 'in_progress', 'finished'] as const).map((st, n) => (
          <span key={st} style={{ '--i': n } as React.CSSProperties}>
            <Pot color={statusColor(st)} size={44} />
          </span>
        ))}
      </div>
      <b>{WAITING[i % WAITING.length]}</b>
      <small className="muted">A thoughtful answer can take up to a minute. You can keep this page open and wait.</small>
    </div>
  );
}

function RunCard({ run, open, onToggle }: { run: AiRun; open: boolean; onToggle: () => void }) {
  const remove = useDeleteAiRun();
  const mode = MODES.find((m) => m.kind === run.kind)!;
  const title = run.kind === 'recipe' ? run.output.name : run.kind === 'feedback' ? 'Feedback' : 'Tutorials';
  return (
    <li className={`card ${s.run} ${open ? s.runOpen : ''}`}>
      <button type="button" className={s.runHead} onClick={onToggle} aria-expanded={open}>
        <Icon name={mode.icon} />
        <span>
          <b>{title}</b>
          <small className="muted">
            {formatDate(run.createdAt)}
            {run.prompt && ` · “${run.prompt}”`}
          </small>
        </span>
        {run.kind === 'recipe' && run.savedRecipeId !== null && <span className="chip chip--tag">Saved</span>}
        <Icon name={open ? 'up' : 'down'} size={18} />
      </button>
      {open && (
        <div className={s.runBody}>
          {run.kind === 'recipe' ? <RecipeResult run={run} /> : run.kind === 'feedback' ? <FeedbackResult run={run} /> : <TutorialsResult run={run} />}
          <footer className={s.runFoot}>
            <small className="muted">
              {run.model}
              {run.inputTokens !== null && ` · ${run.inputTokens.toLocaleString()} in / ${(run.outputTokens ?? 0).toLocaleString()} out tokens`}
            </small>
            <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={() => confirm('Delete this answer?') && remove.mutate(run.id)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          </footer>
        </div>
      )}
    </li>
  );
}

function RecipeResult({ run }: { run: Extract<AiRun, { kind: 'recipe' }> }) {
  const save = useSaveAiRecipe();
  const { output } = run;
  const toBuy = [...new Set(output.steps.filter((st) => st.paint && (!st.paintRef || st.paintRef.stock === 'out' || st.paintRef.stock === 'wanted')).map((st) => st.paint!))];
  return (
    <>
      <p>{output.summary}</p>
      <div className={s.strip} aria-hidden="true">
        {output.steps.map((st, i) => (
          <i key={i} style={{ background: PHASE_COLOR[st.phase] }} />
        ))}
      </div>
      <ol className={s.steps}>
        {output.steps.map((st, i) => (
          <li key={i} style={{ '--c': PHASE_COLOR[st.phase] } as React.CSSProperties}>
            <span className={s.phase}>{PHASE_LABELS[st.phase]}</span>
            <span className={s.stepBody}>
              <b>{[st.area, st.technique].filter(Boolean).join(' · ')}</b>
              {st.paint && (
                <span className={s.paint}>
                  <i style={{ background: st.paintRef?.colorHex ?? 'transparent' }} className={st.paintRef?.colorHex ? '' : s.noColor} />
                  {st.paint}
                  {!st.paintRef ? <em>not in your paints</em> : st.paintRef.stock !== 'owned' && <em>{STOCK_LABELS[st.paintRef.stock].toLowerCase()}</em>}
                </span>
              )}
              {st.alternative && !st.paintRef && <span className={s.alt}>From your paints instead: {st.alternative}</span>}
              {st.notes && <span className="muted">{st.notes}</span>}
            </span>
          </li>
        ))}
      </ol>
      {toBuy.length > 0 && (
        <p className={s.missing}>
          Paints you do not have: <b>{toBuy.join(', ')}</b>. After saving, the recipe card offers to add them to the shopping list.
        </p>
      )}
      {output.tips.length > 0 && (
        <ul className={s.tips}>
          {output.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
      {save.error && <p className="error-banner">{save.error.message}</p>}
      {run.savedRecipeId !== null ? (
        <p className={s.saved} role="status">
          <Icon name="check" /> Saved to this miniature's recipes, ready to tick off.
        </p>
      ) : (
        <button type="button" className="btn btn--primary" disabled={save.isPending} onClick={() => save.mutate(run.id)}>
          <Icon name="book" /> Save as recipe
        </button>
      )}
    </>
  );
}

function FeedbackResult({ run }: { run: Extract<AiRun, { kind: 'feedback' }> }) {
  const { output } = run;
  return (
    <div className={s.feedback}>
      {run.photoId !== null && <img className={s.reviewed} src={thumbUrl(run.photoId, 400)} alt="The photo that was reviewed" loading="lazy" />}
      <div>
        <p className={s.overall}>{output.overall}</p>
        {output.strengths.length > 0 && (
          <>
            <p className="eyebrow">What works</p>
            <ul className={s.strengths}>
              {output.strengths.map((x) => (
                <li key={x}>
                  <Icon name="check" size={16} /> {x}
                </li>
              ))}
            </ul>
          </>
        )}
        {output.improvements.length > 0 && (
          <>
            <p className="eyebrow">What to improve</p>
            <ol className={s.improvements}>
              {output.improvements.map((x, i) => (
                <li key={i}>
                  <b>{x.area}</b>
                  <span>{x.issue}</span>
                  <span className={s.how}>{x.how}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className={s.next}>
          <span className="eyebrow">Next session</span>
          {output.nextStep}
        </p>
      </div>
    </div>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function TutorialsResult({ run }: { run: Extract<AiRun, { kind: 'tutorials' }> }) {
  const { output } = run;
  return (
    <>
      {output.summary && <p className={s.summary}>{output.summary}</p>}
      {output.links.length === 0 ? (
        <p className="muted">The search returned no links.</p>
      ) : (
        <ul className={s.links}>
          {output.links.map((link) => (
            <li key={link.url}>
              {/* Links come from the search results only; they open outside the app. */}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <b>{link.title}</b>
                <small className="muted">{host(link.url)}</small>
                {link.snippet && <span className="muted">“{link.snippet}”</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
