// src/admin/inventoryHelpers.js
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from "date-fns";

export function getReportRange(period, anchorDate = new Date()) {
  const d = anchorDate;
  if (period === "daily") return { start: startOfDay(d), end: endOfDay(d), label: "Today" };
  if (period === "weekly") {
    return {
      start: startOfWeek(d, { weekStartsOn: 0 }),
      end: endOfWeek(d, { weekStartsOn: 0 }),
      label: "This week",
    };
  }
  if (period === "monthly") {
    return {
      start: startOfMonth(d),
      end: endOfMonth(d),
      label: "This month",
    };
  }
  return { start: startOfDay(d), end: endOfDay(d), label: "Today" };
}

export function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

/**
 * Open / in-progress rent. Inventory writes "active" or "rented"; other apps may use "rented" only.
 * Closed when actualReturnAt is set or status is returned/cancelled.
 */
export function isRentRecordActive(b) {
  if (!b) return false;
  if (b.actualReturnAt != null) return false;
  const s = b.status;
  if (s === "returned" || s === "cancelled" || s === "Cancelled") return false;
  return s === "active" || s === "rented" || s === "borrowed" || s == null;
}

export function isOverdueActive(rent, now = new Date()) {
  if (!isRentRecordActive(rent)) return false;
  const exp = tsToDate(rent.expectedReturnAt);
  return exp && exp.getTime() < now.getTime();
}

export function filterRentsByRentedAtRange(records, start, end) {
  return records.filter((r) => {
    const t = tsToDate(r.borrowedAt);
    if (!t) return false;
    return t >= start && t <= end;
  });
}

export function aggregateMostRented(records, nameById) {
  const counts = {};
  for (const r of records) {
    for (const line of r.items || []) {
      const id = line.itemId;
      if (!id) continue;
      counts[id] = (counts[id] || 0) + (Number(line.quantity) || 0);
    }
  }
  return Object.entries(counts)
    .map(([itemId, quantity]) => ({
      itemId,
      quantity,
      name: nameById[itemId] || lineItemNameFallback(itemId, records),
    }))
    .sort((a, b) => b.quantity - a.quantity);
}

function lineItemNameFallback(itemId, records) {
  for (const r of records) {
    const line = (r.items || []).find((x) => x.itemId === itemId);
    if (line?.itemName) return line.itemName;
  }
  return itemId;
}

export function filterOverdueInRange(records, start, end) {
  return records.filter((r) => {
    if (!isRentRecordActive(r)) return false;
    if (!isOverdueActive(r)) return false;
    const exp = tsToDate(r.expectedReturnAt);
    return exp && exp >= start && exp <= end;
  });
}

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Rental = sum(qty × pricePerHour × hours) */
export function computeRentalCharge(lines, hours) {
  const h = Math.max(0, Number(hours) || 0);
  let t = 0;
  for (const l of lines || []) {
    const p = Number(l.pricePerHour) || 0;
    const q = Number(l.quantity) || 0;
    t += q * p * h;
  }
  return roundMoney(t);
}

/**
 * Scheduled rental for UI and checkout: prefer stored total (includes extensions from inventory flow);
 * otherwise compute from line items × hoursInitial (external apps often omit estimatedRentalCharge).
 */
export function getRentScheduledRentalCharge(rent) {
  if (!rent) return 0;
  const raw = rent.estimatedRentalCharge;
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return roundMoney(Number(raw));
  }
  const lines = rent.items || [];
  const h = Number(rent.hoursInitial) || 0;
  return computeRentalCharge(lines, h);
}

/** Initial rental hours + hours added by extensions (for display). */
export function getRentBillableRentalHours(rent) {
  if (!rent) return 0;
  let h = Number(rent.hoursInitial) || 0;
  for (const ex of rent.extensionHistory || []) {
    h += Number(ex.addedHours) || 0;
  }
  return h;
}

/**
 * Short caption explaining scheduled rent: qty × ₱/hr × billable hours (plus ext note).
 * Does not replace the stored total when extensions exist; clarifies the pricing model.
 */
export function getRentRentalCaption(rent) {
  const items = rent?.items || [];
  const h0 = Number(rent?.hoursInitial) || 0;
  if (!items.length || h0 <= 0) return null;
  const lineBits = [];
  for (const l of items) {
    const q = Number(l.quantity) || 0;
    const p = Number(l.pricePerHour) || 0;
    if (!q || !p) continue;
    const pStr = Number.isInteger(p) ? String(p) : p.toFixed(2);
    lineBits.push(`${q}×₱${pStr}/hr×${h0}h`);
  }
  if (!lineBits.length) return null;
  let s = lineBits.join(" + ");
  const extH = (rent.extensionHistory || []).reduce((a, ex) => a + (Number(ex.addedHours) || 0), 0);
  if (extH > 0) {
    s += ` + same rate × ${extH}h extension`;
  }
  return s;
}

/** Overdue fine = sum(qty × overdueFinePerHour × lateHours) */
export function computeOverdueFine(lines, lateHours) {
  const lh = Math.max(0, Number(lateHours) || 0);
  if (lh <= 0) return 0;
  let t = 0;
  for (const l of lines || []) {
    const f = Number(l.overdueFinePerHour) || 0;
    const q = Number(l.quantity) || 0;
    t += q * f * lh;
  }
  return roundMoney(t);
}

/** Hours past expected return (0 if not late yet). */
export function computeLateHours(expectedReturnAt, nowMs = Date.now()) {
  if (!expectedReturnAt?.toMillis) return 0;
  const expMs = expectedReturnAt.toMillis();
  const lateMs = Math.max(0, nowMs - expMs);
  return lateMs / (3600 * 1000);
}
