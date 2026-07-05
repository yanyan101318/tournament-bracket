import { BRAND_NAME } from "../lib/brand";

const VARIANTS = {
  nav: "h-12 sm:h-14 w-auto max-w-[200px] sm:max-w-[260px] object-contain",
  navCompact: "h-11 w-auto max-w-[170px] object-contain",
  auth: "w-full max-w-[min(100%,340px)] h-auto object-contain mx-auto",
  authCard: "w-full max-w-[300px] sm:max-w-[340px] h-auto object-contain mx-auto",
  receipt: "h-20 w-auto max-w-[280px] object-contain mx-auto",
  receiptPrint: "h-24 w-auto max-w-[260px] object-contain mx-auto block",
};

const HIGHLIGHT_VARIANTS = new Set(["nav", "navCompact", "auth", "authCard"]);
const PRIORITY_VARIANTS = new Set(["auth", "authCard"]);

/**
 * @param {{ variant?: keyof typeof VARIANTS, className?: string, alt?: string, highlight?: boolean }} props
 */
export default function RanawLogo({
  variant = "nav",
  className = "",
  alt = "Ranaw Pickleball Court",
  highlight,
}) {
  const sizeClass = VARIANTS[variant] || VARIANTS.nav;
  const isPriority = PRIORITY_VARIANTS.has(variant);
  const showHighlight = highlight ?? HIGHLIGHT_VARIANTS.has(variant);

  const img = (
    <img
      src="/assets/ranaw-logo.png"
      alt={alt}
      width={629}
      height={396}
      className={`ranaw-logo ${sizeClass} ${showHighlight ? "" : className}`.trim()}
      decoding="sync"
      loading={isPriority ? "eager" : "lazy"}
      fetchPriority={isPriority ? "high" : "auto"}
    />
  );

  if (!showHighlight) return img;

  return (
    <div className={`ranaw-logo-highlight ranaw-logo-highlight--${variant} ${className}`.trim()}>
      {img}
    </div>
  );
}
