import type { ReactNode } from 'react';

export interface WindowProps {
  workspaceName: string;
  folderName: string;
  branch: string;
  showRail: boolean;
  onToggleRail: () => void;
  tweaksOpen?: boolean;
  onToggleTweaks?: () => void;
  children: ReactNode;
}

const sidebarIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

const tweaksIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
  </svg>
);

export function Window({
  workspaceName,
  folderName,
  branch,
  showRail,
  onToggleRail,
  tweaksOpen,
  onToggleTweaks,
  children,
}: WindowProps) {
  const bridge = typeof window !== 'undefined' ? window.kanbots : undefined;
  const host = bridge ? 'desktop' : 'browser';

  return (
    <div className="kb-stage" data-host={host}>
      <div className="kb-window kb-app">
        <div className="kb-titlebar">
          <div className="kb-tlights">
            <button
              type="button"
              className="kb-tlight r"
              aria-label="Close"
              title="Close"
              disabled={!bridge}
              onClick={() => bridge?.closeWindow()}
            />
            <button
              type="button"
              className="kb-tlight y"
              aria-label="Minimize"
              title="Minimize"
              disabled={!bridge}
              onClick={() => bridge?.minimizeWindow()}
            />
            <button
              type="button"
              className="kb-tlight g"
              aria-label="Maximize"
              title="Maximize"
              disabled={!bridge}
              onClick={() => bridge?.toggleMaximizeWindow()}
            />
          </div>
          <div className="kb-tbar-title">
            <span className="kb-tdot" />
            <span>{workspaceName}</span>
            <span className="kb-sep">/</span>
            <span className="kb-folder">{folderName}</span>
            <span className="kb-branch">{branch}</span>
          </div>
          <div className="kb-tbar-actions">
            {onToggleTweaks ? (
              <button
                type="button"
                className="kb-tbar-btn"
                title="Tweaks"
                aria-label="Tweaks"
                aria-pressed={tweaksOpen ?? false}
                onClick={onToggleTweaks}
              >
                {tweaksIcon}
              </button>
            ) : null}
            <button
              type="button"
              className="kb-tbar-btn"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
              aria-pressed={showRail}
              onClick={onToggleRail}
            >
              {sidebarIcon}
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
