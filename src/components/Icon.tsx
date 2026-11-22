import type { ReactNode } from 'react';

type IconName =
  | 'grid'
  | 'source'
  | 'instrument'
  | 'input'
  | 'formula'
  | 'matrix'
  | 'trace'
  | 'compare'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'download'
  | 'upload'
  | 'reset'
  | 'sun'
  | 'moon'
  | 'check'
  | 'alert'
  | 'x'
  | 'info'
  | 'arrow'
  | 'split'
  | 'merge'
  | 'chevron';

const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="10" y="2.5" width="5" height="5" rx="1" />
      <rect x="2.5" y="10" width="5" height="5" rx="1" />
      <rect x="10" y="10" width="5" height="5" rx="1" />
    </>
  ),
  source: (
    <>
      <circle cx="5" cy="4.5" r="2" />
      <circle cx="5" cy="13.5" r="2" />
      <circle cx="13.5" cy="9" r="2" />
      <path d="M6.8 5.6 11.7 8M6.8 12.4 11.7 10" />
    </>
  ),
  instrument: (
    <>
      <path d="M3 4.5h11M3 8h11M3 11.5h11" />
      <path d="M5.5 2.5v13" />
    </>
  ),
  input: (
    <>
      <path d="M3 5h8M3 9h11M3 13h6" />
      <path d="M13.5 3.5v3" />
    </>
  ),
  formula: (
    <>
      <path d="M4 4h9M8.5 4c-2 4-2 8 0 10M10.5 7.5 14 12.5M14 7.5 10.5 12.5" />
    </>
  ),
  matrix: (
    <>
      <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" />
      <rect x="10.5" y="2.5" width="3" height="5.5" rx="1" />
      <rect x="2.5" y="10.5" width="5.5" height="3" rx="1" />
      <rect x="10.5" y="10.5" width="3" height="3" rx="1" />
    </>
  ),
  trace: (
    <>
      <circle cx="9" cy="3.5" r="1.7" />
      <circle cx="4" cy="12.5" r="1.7" />
      <circle cx="14" cy="12.5" r="1.7" />
      <path d="M7.8 4.8 5.2 11M10.2 4.8 12.8 11M5.8 12.5h6.4" />
    </>
  ),
  compare: (
    <>
      <path d="M3 12.5V8M8 12.5V4M13 12.5V6.5" />
      <path d="M2 15h14" />
    </>
  ),
  plus: <path d="M9 3.5v11M3.5 9h11" />,
  trash: (
    <>
      <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 10h6.6L13 5" />
      <path d="M7.8 8v4M10.2 8v4" />
    </>
  ),
  copy: (
    <>
      <rect x="6" y="6" width="8.5" height="8.5" rx="1.5" />
      <path d="M12 6V4.5A1.5 1.5 0 0 0 10.5 3h-6A1.5 1.5 0 0 0 3 4.5v6A1.5 1.5 0 0 0 4.5 12H6" />
    </>
  ),
  download: <path d="M9 3v8M5.5 8 9 11.5 12.5 8M3.5 14.5h11" />,
  upload: <path d="M9 11.5v-8M5.5 7 9 3.5 12.5 7M3.5 14.5h11" />,
  reset: (
    <>
      <path d="M3.5 6.5A6 6 0 1 1 4 12" />
      <path d="M3 3v4h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="9" cy="9" r="3" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" />
    </>
  ),
  moon: <path d="M14.5 11A6 6 0 0 1 7 3.5a6 6 0 1 0 7.5 7.5Z" />,
  check: <path d="M3.5 9.5 7 13l7.5-8" />,
  alert: (
    <>
      <path d="M9 2.5 16.5 15h-15L9 2.5Z" />
      <path d="M9 7v3.5M9 12.8v.4" />
    </>
  ),
  x: <path d="M4 4l10 10M14 4 4 14" />,
  info: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8v4.5M9 5.7v.4" />
    </>
  ),
  arrow: <path d="M3.5 9h11M10.5 5l4 4-4 4" />,
  split: (
    <>
      <path d="M3 9h5M8 9l4-4h3M8 9l4 4h3" />
      <circle cx="3" cy="9" r="1.2" />
    </>
  ),
  merge: (
    <>
      <path d="M15 9h-5M10 9 6 5H3M10 9l-4 4H3" />
      <circle cx="15" cy="9" r="1.2" />
    </>
  ),
  chevron: <path d="M7 4.5 11.5 9 7 13.5" />,
};

export function Icon({ name, size = 16, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <span className="icon" style={{ width: size, height: size }} aria-hidden={title ? undefined : true}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={title ? 'img' : undefined}
      >
        {title ? <title>{title}</title> : null}
        {paths[name]}
      </svg>
    </span>
  );
}

export type { IconName };
