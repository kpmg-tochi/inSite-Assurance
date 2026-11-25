/**
 * The animated four-bar loader. By default it renders as a full-width,
 * horizontally centred block with vertical padding, so it sits in the middle
 * of whatever panel is loading. Pass `inline` where it must sit inside a row,
 * a button or a wrapper that already lays it out.
 */
export default function Loader({
  white,
  size,
  inline,
}: {
  white?: boolean;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
}) {
  const bars = (
    <div className="flex items-center gap-1" role="status" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={`logo-loader aspect-[2/3] ${
            size === 'sm'
              ? 'w-8 border-[3px]'
              : size === 'md'
                ? 'w-12 border-[3px]'
                : 'w-16 border-4'
          } ${white ? 'border-white' : 'border-brand-primary'}`}
          style={{ animationDelay: `${index * 100}ms` }}
        />
      ))}
    </div>
  );
  if (inline) return bars;
  return (
    <div className={`flex w-full justify-center ${size === 'sm' ? 'py-4' : 'py-10'}`}>
      {bars}
    </div>
  );
}
