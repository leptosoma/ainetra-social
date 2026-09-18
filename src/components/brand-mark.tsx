export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-mark">
      <span className="brand-glyph">A</span>
      {!compact && <span>ainetra <strong>social</strong></span>}
    </span>
  );
}
