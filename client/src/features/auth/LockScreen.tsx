import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useUnlock } from '../../api/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import s from './Auth.module.css';

/** Shown instead of the app while a PIN is set and this device has not entered it. */
export function LockScreen() {
  const unlock = useUnlock();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (unlock.error) {
      setPin('');
      setShake((n) => n + 1);
    }
  }, [unlock.error]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pin) unlock.mutate(pin);
  };
  const throttled = unlock.error instanceof ApiError && unlock.error.status === 429;

  return (
    <main className={s.lock}>
      <form key={shake} className={`${s.lockCard} ${unlock.error ? s.shake : ''}`} onSubmit={onSubmit}>
        <span className={s.lockIcon}>
          <Icon name="lock" size={30} />
        </span>
        <h1>
          mini<b>bald</b>
        </h1>
        <p className="muted">Enter the PIN to open the bench.</p>
        <input
          className={`input ${s.pin}`}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          maxLength={64}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          aria-label="PIN"
          aria-invalid={Boolean(unlock.error)}
        />
        {unlock.error && (
          <p className="error-banner" role="alert">
            {unlock.error.message}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={!pin || unlock.isPending || throttled}>
          Unlock
        </button>
      </form>
    </main>
  );
}
