import { doc, getDoc } from "firebase/firestore";
import { normalizePhilippineMsisdnNumber } from "./normalizePhilippinePhone.js";

function pickPhone(...values) {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (!s || s === "—" || /^n\/a$/i.test(s) || /@/.test(s)) continue;
    const normalized = normalizePhilippineMsisdnNumber(s);
    if (normalized != null) return normalized;
  }
  return null;
}

/**
 * Resolve a booking's contact phone: booking field, then users, then customers CRM.
 */
export async function resolveBookingContactNumber(db, booking) {
  const fromBooking = pickPhone(booking?.contactNumber);
  if (fromBooking) return fromBooking;

  const userId = booking?.userId;
  if (!userId) return null;

  try {
    const [userSnap, customerSnap] = await Promise.all([
      getDoc(doc(db, "users", userId)),
      getDoc(doc(db, "customers", userId)),
    ]);
    const user = userSnap.exists() ? userSnap.data() : {};
    const customer = customerSnap.exists() ? customerSnap.data() : {};
    return pickPhone(user.contactNumber, user.phone, customer.contactNumber);
  } catch (e) {
    console.error("resolveBookingContactNumber", e);
    return null;
  }
}
