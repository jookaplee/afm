import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Languages, Lock } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';
import { sealedDataset, unlockWithPassword, unlockWithSavedKey } from '../standalone/unlock.ts';
import type { SealedDataset } from '../../../shared/dataset-crypto.ts';

/**
 * Shows the app only once a password-protected prospect list has been opened.
 * Pages without one render straight away.
 */
export function DatasetGate({ children }: { children: ReactNode }) {
  const sealed = useMemo(sealedDataset, []);
  const [state, setState] = useState<'checking' | 'locked' | 'open'>(sealed ? 'checking' : 'open');

  useEffect(() => {
    if (!sealed) return;
    let live = true;
    unlockWithSavedKey(sealed).then(
      (ok) => live && setState(ok ? 'open' : 'locked'),
      () => live && setState('locked'),
    );
    return () => {
      live = false;
    };
  }, [sealed]);

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <div className="lock-screen" aria-busy="true" />;
  return <LockScreen sealed={sealed!} onOpen={() => setState('open')} />;
}

function LockScreen({ sealed, onOpen }: { sealed: SealedDataset; onOpen: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `JOOSONS · ${t('lock.title')}`;
  }, [t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await unlockWithPassword(sealed, password, remember)) {
        onOpen();
        return;
      }
      setError(t('lock.wrong'));
    } catch {
      setError(t('lock.unsupported'));
    }
    setBusy(false);
  };

  return (
    <main className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <span className="lock-icon" aria-hidden>
          <Lock aria-hidden />
        </span>
        <h1>JOOSONS</h1>
        <p className="muted">{t('lock.intro')}</p>
        {/* Lets Safari's password manager offer to save and fill the password. */}
        <input type="text" name="username" autoComplete="username" value="JOOSONS" readOnly hidden />
        <label htmlFor="lock-password" className="sr-only">
          {t('lock.password')}
        </label>
        <input
          id="lock-password"
          className="input"
          type="password"
          name="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t('lock.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'lock-error' : undefined}
          autoFocus
        />
        {error && (
          <p id="lock-error" className="lock-error" role="alert">
            {error}
          </p>
        )}
        <label className="lock-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('lock.remember')}
        </label>
        <button className="btn primary lock-submit" type="submit" disabled={busy || !password.trim()}>
          {busy ? t('lock.opening') : t('lock.open')}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => setLang(lang === 'ms' ? 'en' : 'ms')} title={t('lang.switch')}>
          <Languages aria-hidden />
          {lang === 'ms' ? 'English' : 'Bahasa Malaysia'}
        </button>
      </form>
    </main>
  );
}
