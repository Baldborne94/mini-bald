import { useEffect, useState, type FormEvent } from 'react';
import { useAiStatus, useAuthStatus, useBackupInfo, useChangePin, useHealth, useLock } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { formatDate, plural } from '../../lib/format.ts';
import { THEMES, useTheme } from '../../themes/index.ts';
import s from './Settings.module.css';

const megabytes = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`);

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { data: health } = useHealth();
  const { data: ai } = useAiStatus();

  return (
    <div className={s.page}>
      <header>
        <h1>Settings</h1>
      </header>

      <section className={s.block}>
        <h2>Theme</h2>
        <p className="muted">Pick the mood of your bench. The choice is remembered on this device only.</p>
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
      </section>

      <PinSection />
      <InstallSection https={health?.https ?? false} />
      <BackupSection />

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
            <dt className="eyebrow">Connection</dt>
            <dd>{health ? (health.https ? 'HTTPS' : 'HTTP') : '…'}</dd>
          </div>
          <div>
            <dt className="eyebrow">AI assistant</dt>
            <dd>{ai ? (ai.configured ? `${ai.provider} · ${ai.model}` : 'Not configured') : '…'}</dd>
          </div>
        </dl>
        <p className="muted">Everything lives in one data folder: the SQLite database plus your photos in plain, readable folders.</p>
      </section>
    </div>
  );
}

function PinSection() {
  const { data: auth } = useAuthStatus();
  const change = useChangePin();
  const lock = useLock();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ currentPin: '', newPin: '', repeat: '' });
  const [done, setDone] = useState<string | null>(null);
  if (!auth) return null;

  const mismatch = form.newPin !== '' && form.repeat !== '' && form.newPin !== form.repeat;
  const finish = (message: string) => {
    setDone(message);
    setEditing(false);
    setForm({ currentPin: '', newPin: '', repeat: '' });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    change.mutate({ currentPin: form.currentPin || undefined, newPin: form.newPin }, { onSuccess: () => finish(auth.pinEnabled ? 'PIN changed. Other devices have been signed out.' : 'PIN set. Other devices will be asked for it.') });
  };
  const onRemove = () => {
    const currentPin = prompt('Enter the current PIN to remove it');
    if (currentPin) change.mutate({ currentPin, newPin: null }, { onSuccess: () => finish('PIN removed.') });
  };

  return (
    <section className={`card ${s.panel}`}>
      <header>
        <Icon name="lock" size={24} />
        <div>
          <h2>PIN lock</h2>
          <p className="muted">
            {auth.pinEnabled
              ? 'On. Each device enters the PIN once and stays unlocked for 30 days.'
              : 'Off. Anyone on your network who opens this address can use the app.'}
          </p>
        </div>
      </header>
      {done && <p role="status"><b>{done}</b></p>}
      {change.error && <p className="error-banner">{change.error.message}</p>}

      {editing ? (
        <form className={s.pinForm} onSubmit={onSubmit}>
          {auth.pinEnabled && (
            <label className="field">
              <span>Current PIN</span>
              <input className="input" type="password" inputMode="numeric" autoComplete="current-password" required value={form.currentPin} onChange={(e) => setForm({ ...form, currentPin: e.target.value })} />
            </label>
          )}
          <label className="field">
            <span>New PIN (at least 4 characters)</span>
            <input className="input" type="password" inputMode="numeric" autoComplete="new-password" required minLength={4} maxLength={64} value={form.newPin} onChange={(e) => setForm({ ...form, newPin: e.target.value })} />
          </label>
          <label className="field">
            <span>Repeat it</span>
            <input className="input" type="password" inputMode="numeric" autoComplete="new-password" required value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} aria-invalid={mismatch} />
          </label>
          {mismatch && <p className="error-banner">The two PINs do not match.</p>}
          <div className={s.actions}>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={change.isPending || mismatch}>
              Save PIN
            </button>
          </div>
        </form>
      ) : (
        <div className={s.actions}>
          <button type="button" className="btn btn--primary" onClick={() => { setDone(null); change.reset(); setEditing(true); }}>
            {auth.pinEnabled ? 'Change PIN' : 'Set a PIN'}
          </button>
          {auth.pinEnabled && (
            <>
              <button type="button" className="btn" onClick={() => lock.mutate()}>
                <Icon name="lock" size={16} /> Lock this device now
              </button>
              <button type="button" className="btn btn--ghost btn--danger" onClick={onRemove}>
                Remove PIN
              </button>
            </>
          )}
        </div>
      )}
      <p className={`muted ${s.fine}`}>
        The PIN keeps other people on your network out. It does not encrypt anything: over plain HTTP it travels unprotected, and the data folder itself is not locked. Forgotten it? Start the container once with <code>RESET_PIN=true</code>.
      </p>
    </section>
  );
}

type InstallEvent = Event & { prompt: () => Promise<unknown> };
const installHolder = window as unknown as { minibaldInstall?: InstallEvent };

function InstallSection({ https }: { https: boolean }) {
  const [canInstall, setCanInstall] = useState(Boolean(installHolder.minibaldInstall));
  useEffect(() => {
    const onReady = () => setCanInstall(true);
    window.addEventListener('minibald:installable', onReady);
    return () => window.removeEventListener('minibald:installable', onReady);
  }, []);
  const standalone = matchMedia('(display-mode: standalone)').matches;
  const secure = window.isSecureContext;

  const install = async () => {
    await installHolder.minibaldInstall?.prompt();
    installHolder.minibaldInstall = undefined;
    setCanInstall(false);
  };

  return (
    <section className={`card ${s.panel}`}>
      <header>
        <Icon name="download" size={24} />
        <div>
          <h2>Install as an app</h2>
          <p className="muted">
            {standalone
              ? 'You are using the installed app.'
              : secure
                ? 'This connection is secure, so MiniBald can be installed on this device and opened from the home screen.'
                : 'Browsers only allow installation over HTTPS. The app works fully in the browser meanwhile.'}
          </p>
        </div>
      </header>
      {!standalone && secure && (
        <div className={s.actions}>
          {canInstall ? (
            <button type="button" className="btn btn--primary" onClick={install}>
              <Icon name="download" size={16} /> Install MiniBald
            </button>
          ) : (
            <p className="muted">Use your browser's menu: "Install app" in Chrome or Edge, "Add to Home Screen" from the share menu in Safari.</p>
          )}
        </div>
      )}
      {!secure && (
        <p className={`muted ${s.fine}`}>
          To switch HTTPS on, put a certificate in <code>data/certs/</code> (<code>cert.pem</code> and <code>key.pem</code>) and restart: the steps are in <code>docs/deploy.md</code>.{https ? '' : ' Until then, adding this page to the home screen as a bookmark works too.'}
        </p>
      )}
    </section>
  );
}

function BackupSection() {
  const { data: info } = useBackupInfo();
  return (
    <section className={`card ${s.panel}`}>
      <header>
        <Icon name="upload" size={24} />
        <div>
          <h2>Backups and export</h2>
          <p className="muted">
            {info
              ? `Database ${megabytes(info.databaseBytes)}, ${plural(info.photos.count, 'photo')} (${megabytes(info.photos.bytes)}).`
              : ' '}
          </p>
        </div>
      </header>
      <div className={s.downloads}>
        <a className="btn btn--primary" href="/api/backup/full" download>
          <Icon name="download" size={16} /> Full backup (.zip)
        </a>
        <a className="btn" href="/api/backup/database" download>
          <Icon name="download" size={16} /> Database only
        </a>
        <a className="btn btn--ghost" href="/api/miniatures/export.csv" download>
          Miniatures (.csv)
        </a>
        <a className="btn btn--ghost" href="/api/paints/export.csv" download>
          Paints (.csv)
        </a>
      </div>
      {info && (
        <p className="muted">
          {info.keep === 0
            ? 'Automatic backups are off (BACKUP_KEEP=0).'
            : info.automatic.length === 0
              ? `A database snapshot is saved every day in data/backups/auto, keeping the last ${info.keep}.`
              : `Daily database snapshots: ${info.automatic.length} kept in data/backups/auto, latest ${formatDate(`${info.automatic[0]!.day}T12:00:00`)}.`}
        </p>
      )}
      <p className={`muted ${s.fine}`}>
        The full backup holds the database, every photo and your extra catalogues. To restore, stop the container, unzip it into an empty data folder and start again. Daily snapshots cover the database only: photos are ordinary files, so include the data folder in your NAS backups.
      </p>
    </section>
  );
}
