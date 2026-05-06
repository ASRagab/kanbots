import { useEffect, useState, type MouseEvent } from 'react';
import { Logo } from './Logo.js';
import { getBridge } from '../desktop-bridge.js';
import { CloudSettingsModal } from './modals/CloudSettingsModal.js';
import type { CloudStatusPayload } from '../desktop-bridge.js';

export interface CloudFirstRunPromptProps {
  onDismissed: () => void;
  onSignedIn: () => void;
}

const CheckIcon = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12l5 5L20 7" />
  </svg>
);

const HeroIcon = (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="13" y="3" width="8" height="6" rx="1.5" />
    <rect x="13" y="11" width="8" height="10" rx="1.5" fill="currentColor" opacity="0.85" />
  </svg>
);

/**
 * Shown once on first launch when the user has neither signed in to Kanbots
 * Cloud nor explicitly opted out. The user makes the local-vs-cloud choice
 * before anything else; dismissal is sticky so this never reappears.
 */
export function CloudFirstRunPrompt({ onDismissed, onSignedIn }: CloudFirstRunPromptProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      // Force an explicit choice — neither Esc nor click-outside dismisses
      // the gate. The "Continue local-only" button is one click away.
      if (e.key === 'Escape') e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleContinueLocal(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const bridge = getBridge();
    if (bridge) {
      try {
        await bridge.cloudPromptDismiss();
      } catch {
        /* best-effort */
      }
    }
    setBusy(false);
    onDismissed();
  }

  function handleStatusChange(status: CloudStatusPayload): void {
    if (status.authed) onSignedIn();
  }

  function stopInner(e: MouseEvent<HTMLDivElement>): void {
    e.stopPropagation();
  }

  if (showSettings) {
    return (
      <CloudSettingsModal
        onClose={() => setShowSettings(false)}
        onChanged={handleStatusChange}
      />
    );
  }

  return (
    <div className="kb-modal-scrim" role="dialog" aria-modal="true">
      <div className="kb-cloud-modal" onMouseDown={stopInner}>
        <div className="kb-cloud-modal-head">
          <Logo size={14} />
          <span className="kb-cloud-modal-head-title">Welcome to kanbots</span>
          <span className="grow" />
        </div>

        <div className="kb-cloud-modal-body">
          <div className="kb-cloud-hero">
            <div className="kb-cloud-hero-icon" style={{ color: 'var(--accent)' }}>
              {HeroIcon}
            </div>
            <h2 className="kb-cloud-hero-title">Local-first by default</h2>
            <p className="kb-cloud-hero-tagline">
              kanbots runs entirely on your machine. Sign in to Kanbots Cloud
              to sync with your team — or continue local-only and switch later.
            </p>
          </div>

          <ul
            className="kb-cloud-features"
            style={{ listStyle: 'none', padding: '12px 14px', margin: 0 }}
          >
            <li className="kb-cloud-feature">
              <span className="kb-cloud-feature-icon">{CheckIcon}</span>
              <span>
                <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Local-only</strong>{' '}
                — fully offline, your data never leaves this machine
              </span>
            </li>
            <li className="kb-cloud-feature">
              <span className="kb-cloud-feature-icon">{CheckIcon}</span>
              <span>
                <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Cloud</strong>{' '}
                — sync tasks and runs across your team and devices
              </span>
            </li>
            <li className="kb-cloud-feature">
              <span className="kb-cloud-feature-icon">{CheckIcon}</span>
              <span>You can switch any time from the toolbar</span>
            </li>
          </ul>

          <div className="kb-cloud-cta-row">
            <button
              type="button"
              className="kb-cloud-cta"
              onClick={() => setShowSettings(true)}
              disabled={busy}
            >
              Sign in to Kanbots Cloud
            </button>
            <button
              type="button"
              className="kb-cloud-secondary"
              onClick={() => void handleContinueLocal()}
              disabled={busy}
            >
              Continue local-only
            </button>
          </div>

          <p className="kb-cloud-fineprint">
            By continuing you agree to our{' '}
            <a href="https://app.kanbots.dev/terms" target="_blank" rel="noopener noreferrer">
              Terms
            </a>{' '}
            and{' '}
            <a href="https://app.kanbots.dev/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
