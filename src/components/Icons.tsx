const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const GearIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" />
  </svg>
);

export const ImageIcon = () => (
  <svg {...base}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M4 17l5-5 4 4 3-3 4 4" />
  </svg>
);

export const BackIcon = () => (
  <svg {...base}>
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);

export const AlertIcon = () => (
  <svg {...base}>
    <path d="M12 3.5L2.8 19.5h18.4L12 3.5z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </svg>
);

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M8 7L4 11l4 4" />
    <path d="M4 11h10a5 5 0 010 10h-3" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5" />
  </svg>
);
