import { useHealth } from '../../api/hooks.ts';
import { THEMES, useTheme } from '../../themes/index.ts';
import s from './Settings.module.css';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: health } = useHealth();

  return (
    <div className={s.page}>
      <header>
        <h1>Themes</h1>
        <p className="muted">Pick the mood of your bench. The choice is remembered on this device only.</p>
      </header>

      <div className={s.themes} role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={t.id === theme} className={`${s.theme} ${t.id === theme ? s.themeOn : ''}`} onClick={() => setTheme(t.id)} style={{ background: t.swatches[0], color: t.mode === 'dark' ? '#fff' : '#111' }}>
            <span className={s.themePots}>
              {t.swatches.slice(2).map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            <span className={s.themeCard} style={{ background: t.swatches[1] }}>
              <b>{t.name}</b>
              <small>{t.blurb}</small>
            </span>
            <span className={s.themeMode}>{t.mode}</span>
          </button>
        ))}
      </div>

      <section className={`card ${s.about}`}>
        <h2>About this install</h2>
        <dl>
          <div>
            <dt className="eyebrow">Version</dt>
            <dd>{health?.version ?? '…'}</dd>
          </div>
          <div>
            <dt className="eyebrow">Database schema</dt>
            <dd>{health ? `v${health.schemaVersion}` : '…'}</dd>
          </div>
          <div>
            <dt className="eyebrow">AI assistant</dt>
            <dd>{health ? (health.aiConfigured ? 'Configured' : 'Not configured') : '…'}</dd>
          </div>
        </dl>
        <p className="muted">Everything lives in one data folder: the SQLite database plus your photos in plain, readable folders.</p>
      </section>
    </div>
  );
}
