import React from 'react';

export type SnapshotStatus = 'idle' | 'saved' | 'error';

interface SnapshotButtonProps {
  icon?: 'camera' | 'clipboard';
  loading: boolean;
  status: SnapshotStatus;
  disabled?: boolean;
  title: string;
  labels: {
    idle: string;
    loading: string;
    saved: string;
    error: string;
  };
  onClick: () => void;
}

const CameraIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const ClipboardDocIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <path d="M9 12h6M9 16h4" />
  </svg>
);

/**
 * Pill trigger button with Camera/Clipboard icon and consistent idle/loading/saved/error feedback.
 */
export const SnapshotButton: React.FC<SnapshotButtonProps> = ({
  icon = 'camera',
  loading,
  status,
  disabled = false,
  title,
  labels,
  onClick,
}) => {
  const statusClass = status === 'saved' ? 'saved' : status === 'error' ? 'error' : '';
  const text = loading
    ? labels.loading
    : status === 'saved'
    ? labels.saved
    : status === 'error'
    ? labels.error
    : labels.idle;

  return (
    <button
      type="button"
      className={`s2p-screenshot-btn ${statusClass}`}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
    >
      {icon === 'clipboard' ? <ClipboardDocIcon /> : <CameraIcon />}
      <span>{text}</span>
    </button>
  );
};
