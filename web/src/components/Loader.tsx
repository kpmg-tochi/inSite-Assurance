/**
 * The loading spinner: two open (three-quarter) rings turning in opposite directions, the outer
 * UBEC green (white with `white`, for dark or green surfaces) and the inner UBEC amber. By default
 * it renders as a full-width, horizontally centred block with vertical padding, so it sits in the
 * middle of whatever panel is loading. Pass `inline` where it must sit inside a row, a button or a
 * wrapper that already lays it out. Keyframes and the reduced-motion rule are in `index.css`.
 */
const SIZE_CLASSES = {
  sm: { box: 'w-6 h-6', outer: 'border-[3px]', inner: 'inset-[6px] border-2' },
  md: { box: 'w-9 h-9', outer: 'border-[3px]', inner: 'inset-[8px] border-[3px]' },
  lg: { box: 'w-12 h-12', outer: 'border-4', inner: 'inset-[11px] border-[3px]' },
} as const;

export default function Loader({
  white,
  size,
  inline,
}: {
  white?: boolean;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
}) {
  const s = SIZE_CLASSES[size ?? 'lg'];
  const spinner = (
    <span
      className={`relative inline-block shrink-0 align-middle ${s.box}`}
      role="status"
      aria-label="Loading"
    >
      <span
        aria-hidden="true"
        className={`ubec-spinner-outer absolute inset-0 rounded-full ${s.outer} ${
          white ? 'border-white' : 'border-brand-primary'
        } border-r-transparent`}
      />
      <span
        aria-hidden="true"
        className={`ubec-spinner-inner absolute rounded-full ${s.inner} border-brand-sky border-l-transparent`}
      />
    </span>
  );
  if (inline) return spinner;
  return (
    <div className={`flex w-full justify-center ${size === 'sm' ? 'py-4' : 'py-10'}`}>
      {spinner}
    </div>
  );
}
