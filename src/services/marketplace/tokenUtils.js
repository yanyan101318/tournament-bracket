/** Cryptographically secure vendor portal token (hex). */
export function generateSecureToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function vendorPortalPath(storeId, token) {
  return `/vendor/store/${storeId}?token=${encodeURIComponent(token)}`;
}

export function vendorPortalUrl(storeId, token) {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${vendorPortalPath(storeId, token)}`;
  }
  return vendorPortalPath(storeId, token);
}
