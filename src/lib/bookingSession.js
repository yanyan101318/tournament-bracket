import { format, parse, isValid, startOfDay, endOfDay } from "date-fns";
import { isActiveBookingStatus } from "./bookingSlots";

function normCourtKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeBookingDate(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === "string") return dateVal.trim().slice(0, 10);
  if (typeof dateVal?.toDate === "function") {
    return format(dateVal.toDate(), "yyyy-MM-dd");
  }
  return null;
}

/** @returns {{ start: Date, end: Date } | null} */
export function parseBookingTimeRange(booking) {
  const dateStr = normalizeBookingDate(booking?.date);
  const slot = booking?.timeSlot;
  if (!dateStr || !slot || typeof slot !== "string") return null;

  const durationH = Number(booking.duration);
  const durHours = Number.isFinite(durationH) && durationH > 0 ? durationH : 1;
  const combined = `${dateStr} ${slot.trim()}`;

  let start = parse(combined, "yyyy-MM-dd hh:mm a", new Date());
  if (!isValid(start)) {
    start = parse(combined, "yyyy-MM-dd h:mm a", new Date());
  }
  if (!isValid(start)) {
    const m = slot.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (m) {
      let hh = Number(m[1]) % 12;
      if (m[3].toUpperCase() === "PM") hh += 12;
      const hhText = String(hh).padStart(2, "0");
      const mmText = String(m[2]).padStart(2, "0");
      start = new Date(`${dateStr}T${hhText}:${mmText}:00`);
    }
  }
  if (!isValid(start)) return null;

  const end = new Date(start.getTime() + durHours * 60 * 60 * 1000);
  return { start, end };
}

/** Booking belongs to this court (Firestore id or display name e.g. "Court 1"). */
export function bookingMatchesCourt(booking, courtId, courtName) {
  if (!booking) return false;
  const id = String(courtId || "").trim();
  if (id && String(booking.courtId || "").trim() === id) return true;
  const nameKey = normCourtKey(courtName);
  if (nameKey && normCourtKey(booking.courtName) === nameKey) return true;
  if (nameKey && normCourtKey(booking.courtId) === nameKey) return true;
  return false;
}

/**
 * Pending/approved booking for this court.
 * Can only order if the current time is within the booking's time slot.
 */
export function bookingAllowsCourtOrdering(booking, now = new Date()) {
  if (!booking || !isActiveBookingStatus(booking.status)) return false;

  const timeRange = parseBookingTimeRange(booking);
  if (!timeRange) return false;

  const { start, end } = timeRange;
  return now >= start && now <= end;
}

/** @deprecated alias */
export function bookingCoversNow(booking, now) {
  return bookingAllowsCourtOrdering(booking, now);
}

/**
 * Pick the best active booking for a court (prefers Approved over Pending).
 * @param {Array<{ id: string, courtId?: string, status?: string }>} bookings
 */
export function findActiveBookingForCourt(bookings, courtId, now = new Date(), courtName) {
  if (!courtId && !courtName) return null;

  let best = null;
  for (const b of bookings || []) {
    if (!bookingMatchesCourt(b, courtId, courtName)) continue;
    if (!bookingAllowsCourtOrdering(b, now)) continue;

    if (!best) {
      best = b;
      continue;
    }
    const bApproved = String(b.status || "").toLowerCase() === "approved";
    const bestApproved = String(best.status || "").toLowerCase() === "approved";
    if (bApproved && !bestApproved) best = b;
  }
  return best;
}
