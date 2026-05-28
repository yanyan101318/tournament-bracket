import { normalizePhilippineMsisdn } from "./normalizePhilippinePhone";

/** True if input matches the court booker's email or phone (no login required). */
export function matchesBookerIdentity(input, booking) {
  const raw = String(input || "").trim();
  if (!raw || !booking) return false;

  const email = String(booking.email || "").trim().toLowerCase();
  if (email && raw.toLowerCase() === email) return true;

  const bookerMsisdn = normalizePhilippineMsisdn(booking.contactNumber);
  const inputMsisdn = normalizePhilippineMsisdn(raw);
  if (bookerMsisdn && inputMsisdn && bookerMsisdn === inputMsisdn) return true;

  const digits = (s) => String(s || "").replace(/\D/g, "");
  const b = digits(booking.contactNumber);
  const i = digits(raw);
  if (b.length >= 10 && i.length >= 10 && b.slice(-10) === i.slice(-10)) return true;

  return false;
}
