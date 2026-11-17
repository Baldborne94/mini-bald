const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  swatch: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.4-1-1.7-1-2.9 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.1-4-7.5-9-7.5zM7.5 12h.01M9.5 8h.01M14.5 7.5h.01',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17zM14.5 7.5l3 3',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z',
  x: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  cart: 'M3 4h2.5l2.2 10.5h10L20 7H7M9 19.5h.01M17 19.5h.01',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  up: 'M5 15l7-7 7 7',
  down: 'M5 9l7 7 7-7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  compare: 'M12 3v18M4 6h5v12H4zM15 6h5v12h-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z',
  drop: 'M12 3.5c3.5 4.2 6 7.3 6 10.3a6 6 0 0 1-12 0c0-3 2.5-6.1 6-10.3z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
