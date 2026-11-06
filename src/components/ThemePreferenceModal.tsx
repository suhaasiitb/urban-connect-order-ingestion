import React, { useState } from 'react';

export interface ThemePreferenceModalProps {
  currentTheme: 'dark' | 'light';
  onSelectTheme: (theme: 'dark' | 'light') => void;
  onConfirm: (theme: 'dark' | 'light') => void;
  onDismiss: () => void;
}

export const ThemePreferenceModal: React.FC<ThemePreferenceModalProps> = ({
  currentTheme,
  onSelectTheme,
  onConfirm,
  onDismiss,
}) => {
  const [selectedTheme, setSelectedTheme] = useState<'dark' | 'light'>(currentTheme);

  const handleSelect = (theme: 'dark' | 'light') => {
    setSelectedTheme(theme);
    onSelectTheme(theme); // Live preview behind modal
  };

  const handleConfirm = () => {
    onConfirm(selectedTheme);
  };

  return (
    <div className="modal-backdrop theme-modal-backdrop" onClick={onDismiss}>
      <div
        className="modal-card theme-preference-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-modal-title"
      >
        <div className="modal-header theme-modal-header">
          <div className="theme-modal-header-text">
            <span className="theme-modal-badge">
              <span className="theme-sparkle-icon" aria-hidden="true">💡</span>
              First-Time Setup
            </span>
            <h3 id="theme-modal-title" className="editorial-serif-heading modal-title">
              Choose Your Theme
            </h3>
            <p className="modal-subtitle">
              Welcome to Amazon Now Ops Portal! How would you like your workspace to look? Your choice will be saved locally and can be changed anytime using the bulb icon in the top bar.
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onDismiss}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modal-body theme-modal-body">
          <div className="theme-options-grid">
            {/* Midnight Dark Option */}
            <div
              className={`theme-option-card ${selectedTheme === 'dark' ? 'selected' : ''}`}
              onClick={() => handleSelect('dark')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelect('dark');
                }
              }}
              aria-pressed={selectedTheme === 'dark'}
            >
              <div className="theme-preview-box preview-midnight">
                <div className="mock-topbar mock-topbar-midnight">
                  <div className="mock-pill mock-pill-midnight" />
                  <div className="mock-bulb-icon bulb-off-icon" />
                </div>
                <div className="mock-grid">
                  <div className="mock-kpi-card mock-kpi-midnight">
                    <div className="mock-label" />
                    <div className="mock-val mock-val-violet" />
                  </div>
                  <div className="mock-kpi-card mock-kpi-midnight">
                    <div className="mock-label" />
                    <div className="mock-val mock-val-green" />
                  </div>
                </div>
                <div className="mock-table mock-table-midnight">
                  <div className="mock-table-row mock-row-header" />
                  <div className="mock-table-row" />
                  <div className="mock-table-row" />
                </div>
              </div>

              <div className="theme-option-details">
                <div className="theme-option-title-row">
                  <div className="theme-radio-group">
                    <span className="theme-radio-circle">
                      {selectedTheme === 'dark' && <span className="theme-radio-inner" />}
                    </span>
                    <strong className="theme-name">Midnight Theme</strong>
                  </div>
                  <span className="theme-pill-tag tag-midnight">Default</span>
                </div>
                <p className="theme-desc">
                  Basedash midnight carbon palette with soft violet highlights. High contrast and reduced eye fatigue for long shifts.
                </p>
              </div>
            </div>

            {/* Light Option */}
            <div
              className={`theme-option-card ${selectedTheme === 'light' ? 'selected' : ''}`}
              onClick={() => handleSelect('light')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelect('light');
                }
              }}
              aria-pressed={selectedTheme === 'light'}
            >
              <div className="theme-preview-box preview-light">
                <div className="mock-topbar mock-topbar-light">
                  <div className="mock-pill mock-pill-light" />
                  <div className="mock-bulb-icon bulb-on-icon" />
                </div>
                <div className="mock-grid">
                  <div className="mock-kpi-card mock-kpi-light">
                    <div className="mock-label" />
                    <div className="mock-val mock-val-blue" />
                  </div>
                  <div className="mock-kpi-card mock-kpi-light">
                    <div className="mock-label" />
                    <div className="mock-val mock-val-green" />
                  </div>
                </div>
                <div className="mock-table mock-table-light">
                  <div className="mock-table-row mock-row-header-light" />
                  <div className="mock-table-row" />
                  <div className="mock-table-row" />
                </div>
              </div>

              <div className="theme-option-details">
                <div className="theme-option-title-row">
                  <div className="theme-radio-group">
                    <span className="theme-radio-circle">
                      {selectedTheme === 'light' && <span className="theme-radio-inner" />}
                    </span>
                    <strong className="theme-name">Light Theme</strong>
                  </div>
                  <span className="theme-pill-tag tag-daylight">Daylight</span>
                </div>
                <p className="theme-desc">
                  Crisp daylight theme with clear borders and vivid typography. Ideal for brightly lit store desks and office environments.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer theme-modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onDismiss}
            title="Keep Midnight theme as default"
          >
            Keep Midnight
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm theme-save-btn"
            onClick={handleConfirm}
          >
            Save Preference &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
};
