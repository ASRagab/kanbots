import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Logo } from '../Logo.js';
import { getBridge } from '../../desktop-bridge.js';
import type { CloudStatusPayload } from '../../desktop-bridge.js';

export interface CloudSettingsModalProps {
  onClose: () => void;
  onChanged?: (status: CloudStatusPayload) => void;
}

type LoginState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | {
      kind: 'awaiting';
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresAt: number;
      intervalMs: number;
    }
  | { kind: 'error'; message: string };

const DEFAULT_BASE_URL = 'https://app.kanbots.dev';

const CheckIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

const ErrIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

const CloudIcon = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 19h11.5z" />
  </svg>
);

const ExternalIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14 4h6v6" />
    <path d="M10 14L21 3" />
    <path d="M19 14v6H4V5h6" />
  </svg>
);

export function CloudSettingsModal({ onClose, onChanged }: CloudSettingsModalProps) {
  const [status, setStatus] = useState<CloudStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState>({ kind: 'idle' });
  const [signingOut, setSigningOut] = useState(false);
  const pollHandle = useRef<number | null>(null);

  function clearPoll(): void {
    if (pollHandle.current !== null) {
      window.clearTimeout(pollHandle.current);
      pollHandle.current = null;
    }
  }

  const refresh = useCallback(async (): Promise<CloudStatusPayload | null> => {
    const bridge = getBridge();
    if (!bridge) {
      setLoadError('Desktop bridge unavailable.');
      setLoading(false);
      return null;
    }
    try {
      const next = await bridge.cloudAuthStatus();
      setStatus(next);
      setLoadError(null);
      onChanged?.(next);
      return next;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [onChanged]);

  useEffect(() => {
    void refresh();
    return () => {
      clearPoll();
    };
  }, [refresh]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function stopInner(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  const schedulePoll = useCallback(
    (intervalMs: number) => {
      clearPoll();
      pollHandle.current = window.setTimeout(async () => {
        const bridge = getBridge();
        if (!bridge) return;
        try {
          const result = await bridge.cloudLoginPoll();
          if (result.status === 'pending') {
            schedulePoll(intervalMs);
            return;
          }
          if (result.status === 'approved') {
            setLogin({ kind: 'idle' });
            await refresh();
            return;
          }
          if (result.status === 'idle') {
            setLogin({ kind: 'idle' });
            return;
          }
          if (result.status === 'error') {
            setLogin({ kind: 'error', message: result.error });
            return;
          }
          setLogin({
            kind: 'error',
            message:
              result.status === 'expired'
                ? 'Code expired. Try signing in again.'
                : result.status === 'consumed'
                  ? 'This sign-in code was already used.'
                  : 'Sign-in cancelled.',
          });
        } catch (err) {
          setLogin({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }, intervalMs);
    },
    [refresh],
  );

  async function handleSignIn(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      setLogin({ kind: 'error', message: 'Desktop bridge unavailable.' });
      return;
    }
    setLogin({ kind: 'starting' });
    try {
      const result = await bridge.cloudLoginStart();
      if (!result.ok) {
        setLogin({ kind: 'error', message: result.error });
        return;
      }
      setLogin({
        kind: 'awaiting',
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        verificationUriComplete: result.verificationUriComplete,
        expiresAt: result.expiresAt,
        intervalMs: result.intervalMs,
      });
      schedulePoll(result.intervalMs);
    } catch (err) {
      setLogin({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleCancelSignIn(): Promise<void> {
    clearPoll();
    const bridge = getBridge();
    if (bridge) await bridge.cloudLoginCancel();
    setLogin({ kind: 'idle' });
  }

  async function handleSignOut(): Promise<void> {
    if (signingOut) return;
    if (!window.confirm('Sign out of Kanbots Cloud on this device?')) return;
    const bridge = getBridge();
    if (!bridge) return;
    setSigningOut(true);
    try {
      await bridge.cloudLogout();
      await refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="kb-modal-scrim" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="kb-cloud-modal" onMouseDown={stopInner}>
        <div className="kb-cloud-modal-head">
          <Logo size={14} />
          <span className="kb-cloud-modal-head-title">Kanbots Cloud</span>
          <span className="grow" />
          <button
            type="button"
            className="x-btn"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: '1px solid transparent',
              background: 'transparent',
              color: 'var(--ink-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>

        <div className="kb-cloud-modal-body">
          {loading ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: '20px 0' }}>Loading…</div>
          ) : null}

          {loadError ? (
            <div className="kb-cloud-error" role="alert">
              <span className="kb-cloud-error-icon">{ErrIcon}</span>
              <span>{loadError}</span>
            </div>
          ) : null}

          {status && !loading ? (
            status.authed ? (
              <SignedInView
                status={status}
                signingOut={signingOut}
                onSignOut={() => void handleSignOut()}
              />
            ) : (
              <SignedOutView
                login={login}
                onSignIn={() => void handleSignIn()}
                onCancelSignIn={() => void handleCancelSignIn()}
              />
            )
          ) : null}
        </div>

        <div className="kb-cloud-modal-foot">
          <span className="kb-cloud-fineprint">
            {status?.authed
              ? 'Your work syncs to the cloud while signed in.'
              : 'Local-first. Cloud is optional.'}
          </span>
          <span className="grow" />
          <button type="button" className="kb-cloud-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────
  // Subviews
  // ──────────────────────────────────────────────────────────────────────

  function SignedInView({
    status,
    signingOut,
    onSignOut,
  }: {
    status: CloudStatusPayload;
    signingOut: boolean;
    onSignOut: () => void;
  }) {
    return (
      <div className="kb-cloud-signedin">
        <div className="kb-cloud-signedin-status">
          <span className="kb-cloud-signedin-dot" />
          <span className="kb-cloud-signedin-label">
            Signed in to Kanbots Cloud
          </span>
        </div>

        <dl className="kb-cloud-meta">
          {status.baseUrl ? (
            <>
              <dt className="kb-cloud-meta-key">Endpoint</dt>
              <dd className="kb-cloud-meta-val" style={{ margin: 0 }}>{status.baseUrl}</dd>
            </>
          ) : null}
          {status.tokenPrefix ? (
            <>
              <dt className="kb-cloud-meta-key">Token</dt>
              <dd className="kb-cloud-meta-val" style={{ margin: 0 }}>{status.tokenPrefix}…</dd>
            </>
          ) : null}
          {status.signedInAt ? (
            <>
              <dt className="kb-cloud-meta-key">Since</dt>
              <dd className="kb-cloud-meta-val" style={{ margin: 0 }}>
                {new Date(status.signedInAt).toLocaleString()}
              </dd>
            </>
          ) : null}
        </dl>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="kb-cloud-secondary"
            onClick={onSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out of this device'}
          </button>
        </div>
      </div>
    );
  }

  function SignedOutView({
    login,
    onSignIn,
    onCancelSignIn,
  }: {
    login: LoginState;
    onSignIn: () => void;
    onCancelSignIn: () => void;
  }) {
    return (
      <>
        <div className="kb-cloud-hero">
          <div className="kb-cloud-hero-icon" style={{ color: 'var(--accent)' }}>
            {CloudIcon}
          </div>
          <h2 className="kb-cloud-hero-title">Connect to Kanbots Cloud</h2>
          <p className="kb-cloud-hero-tagline">
            Sync your tasks across devices and collaborate with your team.
            Your local data never leaves this machine until you sign in.
          </p>
        </div>

        <ul className="kb-cloud-features" style={{ listStyle: 'none', padding: '12px 14px', margin: 0 }}>
          <li className="kb-cloud-feature">
            <span className="kb-cloud-feature-icon">{CheckIcon}</span>
            <span>Real-time sync across desktops you sign in on</span>
          </li>
          <li className="kb-cloud-feature">
            <span className="kb-cloud-feature-icon">{CheckIcon}</span>
            <span>Shared boards, comments, and agent runs with your team</span>
          </li>
          <li className="kb-cloud-feature">
            <span className="kb-cloud-feature-icon">{CheckIcon}</span>
            <span>Encrypted bearer token; revoke any device, any time</span>
          </li>
        </ul>

        {login.kind === 'idle' || login.kind === 'starting' ? (
          <div className="kb-cloud-cta-row">
            <button
              type="button"
              className="kb-cloud-cta"
              onClick={onSignIn}
              disabled={login.kind === 'starting'}
            >
              {login.kind === 'starting' ? (
                <>
                  <span className="kb-cloud-spinner" />
                  Opening browser…
                </>
              ) : (
                'Sign in to Kanbots Cloud'
              )}
            </button>
            <a
              href={DEFAULT_BASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="kb-cloud-secondary"
            >
              Create an account {ExternalIcon}
            </a>
          </div>
        ) : null}

        {login.kind === 'awaiting' ? (
          <div className="kb-cloud-await">
            <p className="kb-cloud-await-label">
              Approve this device in your browser. If it didn’t open,{' '}
              <a
                href={login.verificationUri}
                target="_blank"
                rel="noopener noreferrer"
              >
                visit {login.verificationUri.replace(/^https?:\/\//, '')}
              </a>{' '}
              and enter:
            </p>
            <div className="kb-cloud-code">{login.userCode}</div>
            <div className="kb-cloud-await-actions">
              <a
                href={login.verificationUriComplete}
                target="_blank"
                rel="noopener noreferrer"
                className="kb-cloud-cta"
                style={{ flex: 1, textDecoration: 'none' }}
              >
                Open browser {ExternalIcon}
              </a>
              <button type="button" className="kb-cloud-secondary" onClick={onCancelSignIn}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {login.kind === 'error' ? (
          <>
            <div className="kb-cloud-error" role="alert">
              <span className="kb-cloud-error-icon">{ErrIcon}</span>
              <span>{login.message}</span>
            </div>
            <button type="button" className="kb-cloud-cta" onClick={onSignIn}>
              Try again
            </button>
          </>
        ) : null}
      </>
    );
  }
}
