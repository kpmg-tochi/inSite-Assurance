export default function Loader({
  white,
  size,
}: {
  white?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className="flex items-center gap-1">
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
}
