/** Shared RANAW brand assets and helpers. */

export const BRAND_NAME = "RANAW PICKLEBALL COURT";
export const BRAND_TAGLINE = "Court Reservation Management";
export const BRAND_MOTTO = "Play. Compete. Experience Excellence.";

/** Public URL path — works in print iframes on same origin. */
export const LOGO_PATH = `${process.env.PUBLIC_URL || ""}/assets/ranaw-logo.png`;

export function getLogoUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${LOGO_PATH}`;
  }
  return LOGO_PATH;
}

/** Inline HTML for thermal / POS receipt headers (white paper). */
export function buildReceiptLogoHtml({ maxWidth = "58mm", marginBottom = "4px" } = {}) {
  const src = getLogoUrl();
  return `<div style="text-align:center;margin-bottom:${marginBottom}">
    <img src="${src}" alt="${BRAND_NAME}" style="display:block;margin:0 auto;max-width:100%;width:${maxWidth};height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;" />
  </div>`;
}
