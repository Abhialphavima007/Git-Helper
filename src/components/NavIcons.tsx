// Small stroke icons for the sidebar (16px, inherit currentColor).

function Base({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const Icons = {
  status: (
    <Base>
      <path d="M22 12h-4l-3 8L9 4l-3 8H2" />
    </Base>
  ),
  changes: (
    <Base>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 15h6M12 12v6" />
    </Base>
  ),
  commit: (
    <Base>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v6.5M12 15.5V22" />
    </Base>
  ),
  branches: (
    <Base>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 7.5v9M18 11.5c0 3-3 4-6 4" />
    </Base>
  ),
  compare: (
    <Base>
      <path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12" />
    </Base>
  ),
  history: (
    <Base>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Base>
  ),
  conflicts: (
    <Base>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Base>
  ),
  undo: (
    <Base>
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 3-7.7L3 7" />
    </Base>
  ),
  dashboard: (
    <Base>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Base>
  ),
  repos: (
    <Base>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Base>
  ),
  pulls: (
    <Base>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v7M18 15.5V11a4 4 0 0 0-4-4h-1M14.5 4.5 13 7l2.5 1.5" />
    </Base>
  ),
} as const;

export type IconName = keyof typeof Icons;
