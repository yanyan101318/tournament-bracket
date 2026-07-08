/** Must match court booking UI grid (1h starts). */
export const TIME_SLOTS = [
  "06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM",
  "12:00 PM", "01:00 PM", "02:00 PM", "03:00 PM", "04:00 PM", "05:00 PM",
  "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM",
];

export const EXTEND_OPTIONS = [0.5, 1, 1.5, 2];

/** Convert a time string like "02:30 PM" or "14:30" to minutes from midnight */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const str = String(timeStr).trim();
  const match12 = str.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (match12) {
    let hh = parseInt(match12[1], 10) % 12;
    const mm = parseInt(match12[2], 10);
    const ap = match12[3].toUpperCase();
    if (ap === "PM") hh += 12;
    return hh * 60 + mm;
  }
  const match24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return 0;
}

/** Convert minutes from midnight to a 12-hour time string like "02:30 PM" */
export function minutesToTime(minutes) {
  const m = Math.round(minutes);
  let hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const hhStr = String(hh).padStart(2, "0");
  const mmStr = String(mm).padStart(2, "0");
  return `${hhStr}:${mmStr} ${ap}`;
}

export function calculateEndTime(startTime, durationHours) {
  const startMins = timeToMinutes(startTime);
  const endMins = startMins + durationHours * 60;
  return minutesToTime(endMins);
}

/** pending / approved / ongoing bookings count as holding the court (case-insensitive). */
export function isActiveBookingStatus(status) {
  const x = String(status || "").toLowerCase();
  return x === "pending" || x === "approved" || x === "ongoing";
}

/**
 * True if the user can start a new booking at `timeSlot` for `durationHours` without
 * overlapping any existing same-court, same-day booking.
 */
export function isSlotStartAvailableForDuration(timeSlot, durationHours, existingBookings, excludeBookingId = null) {
  const newStart = timeToMinutes(timeSlot);
  if (newStart === 0) return false; // Invalid start time
  const newEnd = newStart + durationHours * 60;

  for (const ob of existingBookings) {
    if (!ob) continue;
    if (excludeBookingId && ob.id === excludeBookingId) continue;
    if (!isActiveBookingStatus(ob.status)) continue;

    const obStart = timeToMinutes(ob.startTime || ob.timeSlot);
    const obDuration = Number(ob.duration) || 1;
    const obEnd = obStart + obDuration * 60;

    // Overlap condition: new booking starts before existing ends AND new booking ends after existing starts
    if (newStart < obEnd && newEnd > obStart) {
      return false;
    }
  }
  return true;
}

export function isSlotWithinCourtHours(timeSlot, durationHours, court) {
  if (!court) return true;
  const startMins = timeToMinutes(timeSlot);
  const endMins = startMins + durationHours * 60;
  
  const courtStart = timeToMinutes(court.activeStartTime || "06:00");
  const courtEnd = timeToMinutes(court.activeEndTime || "22:00");
  
  return startMins >= courtStart && endMins <= courtEnd;
}

/**
 * @param {object} p
 * @param {string} p.timeSlot
 * @param {number} p.duration
 * @param {number} p.extendHours
 * @param {string} p.courtId
 * @param {string} p.date
 * @param {string} p.excludeBookingId
 * @param {Array<{ id: string, courtId?: string, date?: string, timeSlot?: string, startTime?: string, duration?: number, status?: string }>} p.others
 */
export function canExtendBooking(p) {
  const { timeSlot, duration, extendHours, courtId, date, excludeBookingId, others } = p;
  const add = Number(extendHours);
  if (!Number.isFinite(add) || add <= 0) {
    return { ok: false, reason: "Choose a valid extension length." };
  }
  const newDur = Number(duration) + add;
  
  // Use others to filter same court/date bookings
  const relevantBookings = (others || []).filter(
    (ob) => ob.courtId === courtId && ob.date === date
  );

  if (!isSlotStartAvailableForDuration(timeSlot, newDur, relevantBookings, excludeBookingId)) {
    return { ok: false, reason: "The extended time overlaps with another booking." };
  }

  return { ok: true, newDuration: newDur, newEndTime: calculateEndTime(timeSlot, newDur) };
}

export function getEffectiveCourtStatus(court) {
  if (!court) return false;
  
  if (court.override_expires_at) {
    const expiresAt = typeof court.override_expires_at.toMillis === "function" 
      ? court.override_expires_at.toMillis() 
      : new Date(court.override_expires_at).getTime();
      
    if (court.override_starts_at) {
      const startsAt = typeof court.override_starts_at.toMillis === "function"
        ? court.override_starts_at.toMillis()
        : new Date(court.override_starts_at).getTime();
      
      const now = Date.now();
      if (now >= startsAt && now < expiresAt) {
        return court.override_status === true;
      }
    } else {
      // Legacy behavior
      if (expiresAt > Date.now()) {
        return court.override_status === true;
      }
    }
  }
  
  // Fall back to base_status, or legacy isActive
  if (typeof court.base_status === "boolean") {
    return court.base_status;
  }
  
  return court.isActive !== false;
}

/**
 * Checks if a slot overlaps with a scheduled inactive override for a specific court.
 * Used to block bookings during scheduled downtimes.
 */
export function isCourtActiveDuringSlot(court, targetDate, timeSlot, durationHours) {
  if (!court) return false;
  
  // If the court is generally inactive (no temporary override, just permanently inactive), it's not active.
  // Wait, if it has a future activation, the base is inactive, and we want to check if the slot is inside the activation.
  const slotDate = new Date(targetDate);
  const startMins = timeToMinutes(timeSlot);
  
  // Create start and end timestamps for the slot
  const slotStartMs = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate(), 
                               Math.floor(startMins / 60), startMins % 60).getTime();
  const slotEndMs = slotStartMs + durationHours * 3600 * 1000;

  if (court.override_expires_at) {
    const expiresAt = typeof court.override_expires_at.toMillis === "function" 
      ? court.override_expires_at.toMillis() 
      : new Date(court.override_expires_at).getTime();
      
    const startsAt = court.override_starts_at ? 
      (typeof court.override_starts_at.toMillis === "function" 
        ? court.override_starts_at.toMillis() 
        : new Date(court.override_starts_at).getTime()) 
      : 0;

    // Does the slot overlap with the override period?
    // overlap: slotStart < overrideEnd && slotEnd > overrideStart
    const overlaps = slotStartMs < expiresAt && slotEndMs > startsAt;
    
    if (overlaps) {
      // If it overlaps, the status during this slot is the override status
      return court.override_status === true;
    }
  }
  
  // If no override overlaps, use the base status
  if (typeof court.base_status === "boolean") {
    return court.base_status;
  }
  return court.isActive !== false;
}



