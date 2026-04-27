import type { Tweaks } from '../../hooks/useTweaks.js';

export interface TweaksPanelProps {
  tweaks: Tweaks;
  onSet: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  onReset: () => void;
  onClose: () => void;
  onOpenPalette: () => void;
  onFocusPaused?: () => void;
  onFocusReview?: () => void;
}

export function TweaksPanel({
  tweaks,
  onSet,
  onReset,
  onClose,
  onOpenPalette,
  onFocusPaused,
  onFocusReview,
}: TweaksPanelProps) {
  return (
    <div className="kb-tweaks kb-app" role="dialog" aria-label="Tweaks">
      <div className="kb-tweaks-head">
        <span className="t">Tweaks</span>
        <span className="grow" />
        <button type="button" onClick={onReset} title="Reset to defaults" aria-label="Reset">
          ↺
        </button>
        <button type="button" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>

      <div className="kb-tweaks-section">
        <div className="kb-tweaks-label">Theme</div>
        <div className="kb-tweaks-radio">
          {(['dark', 'paper'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={tweaks.theme === v ? 'on' : ''}
              onClick={() => onSet('theme', v)}
            >
              {v === 'dark' ? 'Dark' : 'Paper'}
            </button>
          ))}
        </div>
      </div>

      <div className="kb-tweaks-section">
        <div className="kb-tweaks-label">Accent hue</div>
        <div className="kb-tweaks-slider-row">
          <input
            type="range"
            className="kb-tweaks-slider"
            min={0}
            max={360}
            step={1}
            value={tweaks.accentHue}
            onChange={(e) => onSet('accentHue', Number.parseInt(e.target.value, 10))}
            aria-label="Accent hue"
          />
          <span style={{ width: 32, textAlign: 'right' }}>{tweaks.accentHue}°</span>
        </div>
      </div>

      <div className="kb-tweaks-section">
        <div className="kb-tweaks-label">Layout</div>
        <Toggle
          label="Sidebar"
          on={tweaks.showRail}
          onChange={(v) => onSet('showRail', v)}
        />
        <Toggle
          label="Decision tray"
          on={tweaks.showTray}
          onChange={(v) => onSet('showTray', v)}
        />
      </div>

      <div className="kb-tweaks-section">
        <div className="kb-tweaks-label">Try things</div>
        <div className="kb-tweaks-actions">
          <button type="button" onClick={onOpenPalette}>
            Open command palette (⌘K)
          </button>
          {onFocusPaused ? (
            <button type="button" onClick={onFocusPaused}>
              Focus a paused agent
            </button>
          ) : null}
          {onFocusReview ? (
            <button type="button" onClick={onFocusReview}>
              Focus a review-ready PR
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="kb-tweaks-toggle">
      <span>{label}</span>
      <span className="kb-tweaks-switch" data-on={on ? 'true' : 'false'} aria-hidden />
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
    </label>
  );
}
