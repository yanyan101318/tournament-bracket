// src/admin/BookingManager.jsx
import { useState, useEffect } from "react";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
} from "date-fns";
import {
  collection, query, orderBy, onSnapshot, where, getDocs, writeBatch,
  doc, updateDoc, getDoc, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { canExtendBooking, EXTEND_OPTIONS } from "../lib/bookingSlots";
import { roundMoney } from "../lib/bookingMoney";
import { resolveCustomerPayStatus, PLAN_FULL } from "../lib/bookingPayment";
import toast from "react-hot-toast";
import { useOfflineSync } from "../hooks/useOfflineSync";

const STATUS_COLORS = { Pending:"pending", Approved:"approved", Cancelled:"rejected" };
const PAY_STATUS_BADGE = { paid: "approved", partial: "pending", unpaid: "rejected" };

function deriveRemainingBalance(row) {
  const explicit = Number(row?.remainingBalance);
  if (Number.isFinite(explicit) && explicit >= 0) return roundMoney(explicit);
  const total = Number(row?.totalAmount) || 0;
  const paid = Number(row?.amountPaid) || 0;
  return roundMoney(Math.max(0, total - paid));
}

/** Booking `date` is stored as yyyy-MM-dd; fall back to parsing slot time if needed. */
function bookingDayString(b, toMs) {
  const raw = String(b?.date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = toMs(b);
  if (!ms) return null;
  return format(new Date(ms), "yyyy-MM-dd");
}

export default function BookingManager() {
  const EMPTY_BALANCE_MODAL = { open: false, booking: null, amount: "", method: "cash" };
  const PAGE_SIZE = 10;
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter]     = useState("All");
  const [search, setSearch]     = useState("");
  const [sortByDate, setSortByDate] = useState("date_desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(null);
  const [selected, setSelected] = useState(null);
  const [extendHours, setExtendHours] = useState(1);
  const [extending, setExtending] = useState(false);
  const [balanceModal, setBalanceModal] = useState(EMPTY_BALANCE_MODAL);
  const [payStatusDraft, setPayStatusDraft] = useState("");
  const { wrapSync } = useOfflineSync();

  useEffect(() => {
    const q = query(collection(db,"bookings"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setBookings(snap.docs.map((d) => ({ 
          id: d.id, 
          hasPendingWrites: d.metadata.hasPendingWrites,
          ...d.data() 
        })));
        setLoading(false);
      },
      (err) => {
        console.error("Bookings listener:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selected) {
      setPayStatusDraft("");
      return;
    }
    const current = String(selected.customerPaymentStatus || "").toLowerCase();
    if (current === "paid" || current === "partial" || current === "unpaid") {
      setPayStatusDraft(current);
      return;
    }
    setPayStatusDraft("partial");
  }, [selected]);

  useEffect(() => {
    setPage(1);
  }, [filter, search, sortByDate, dateFrom, dateTo]);

  function applyDatePreset(preset) {
    const today = new Date();
    if (preset === "today") {
      const y = format(today, "yyyy-MM-dd");
      setDateFrom(y);
      setDateTo(y);
      return;
    }
    if (preset === "week") {
      const s = startOfWeek(today, { weekStartsOn: 1 });
      const e = endOfWeek(today, { weekStartsOn: 1 });
      setDateFrom(format(s, "yyyy-MM-dd"));
      setDateTo(format(e, "yyyy-MM-dd"));
      return;
    }
    if (preset === "month") {
      const s = startOfMonth(today);
      const e = endOfMonth(today);
      setDateFrom(format(s, "yyyy-MM-dd"));
      setDateTo(format(e, "yyyy-MM-dd"));
      return;
    }
    if (preset === "last7") {
      setDateFrom(format(subDays(today, 6), "yyyy-MM-dd"));
      setDateTo(format(today, "yyyy-MM-dd"));
      return;
    }
    if (preset === "clear") {
      setDateFrom("");
      setDateTo("");
    }
  }

  function toDateMs(booking) {
    const d = String(booking?.date || "").trim();
    const t = String(booking?.timeSlot || "").trim();
    if (!d) return 0;
    if (!t) {
      const dt = new Date(`${d}T00:00:00`);
      return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
    }
    const m = t.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!m) {
      const dt = new Date(`${d} ${t}`);
      return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
    }
    let hh = Number(m[1]) % 12;
    const mm = Number(m[2]);
    const ap = m[3].toUpperCase();
    if (ap === "PM") hh += 12;
    const hhText = String(hh).padStart(2, "0");
    const mmText = String(mm).padStart(2, "0");
    const dt = new Date(`${d}T${hhText}:${mmText}:00`);
    return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
  }

  async function setStatus(id, status) {
    setActing(id);
    try {
      const promise = updateDoc(doc(db,"bookings",id), {
        status,
        reviewedAt: Timestamp.now(),
      });
      await wrapSync(promise, {
        successMsg: `Booking ${status}`,
        offlineMsg: "Action Queued for Sync"
      });
    } catch(err) { console.error(err); }
    setActing(null);
    setSelected(null);
  }

  async function applyExtension(b) {
    const hours = Number(extendHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("Select extension length");
      return;
    }
    let hourly = Number(b.hourlyRate);
    if (!Number.isFinite(hourly) || hourly <= 0) {
      try {
        const cs = await getDoc(doc(db, "courts", b.courtId));
        hourly = Number(cs.data()?.pricePerHour) || 0;
      } catch {
        hourly = 0;
      }
    }
    if (hourly <= 0) {
      toast.error("Could not read court hourly rate");
      return;
    }
    const check = canExtendBooking({
      timeSlot: b.timeSlot,
      duration: Number(b.duration) || 1,
      extendHours: hours,
      courtId: b.courtId,
      date: b.date,
      excludeBookingId: b.id,
      others: bookings,
    });
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    const extra = roundMoney(hours * hourly);
    const prevTotal =
      Number.isFinite(Number(b.totalAmount)) && Number(b.totalAmount) > 0
        ? Number(b.totalAmount)
        : roundMoney(hourly * (Number(b.duration) || 1));
    const newTotal = roundMoney(prevTotal + extra);
    const amountPaid = roundMoney(Number(b.amountPaid) || 0);
    const newRemaining = roundMoney(Math.max(0, newTotal - amountPaid));
    const payStatus = resolveCustomerPayStatus(b.paymentPlan || PLAN_FULL, newTotal, amountPaid);

    setExtending(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "bookings", b.id), {
        duration: check.newDuration,
        totalAmount: newTotal,
        remainingBalance: newRemaining,
        customerPaymentStatus: payStatus,
        hourlyRate: roundMoney(hourly),
        extendedAt: Timestamp.now(),
      });
      const paySnap = await getDocs(query(collection(db, "payments"), where("bookingId", "==", b.id)));
      paySnap.forEach((d) => {
        batch.update(d.ref, {
          amount: newTotal,
          totalAmount: newTotal,
          remainingBalance: newRemaining,
          customerPaymentStatus: payStatus,
        });
      });
      
      await wrapSync(batch.commit(), {
        successMsg: "Booking extended",
        offlineMsg: "Extension Saved Offline — Pending Server Sync"
      });

      setSelected((s) =>
        s && s.id === b.id
          ? {
              ...s,
              duration: check.newDuration,
              totalAmount: newTotal,
              remainingBalance: newRemaining,
              customerPaymentStatus: payStatus,
              hourlyRate: roundMoney(hourly),
            }
          : s
      );
    } catch (e) {
      console.error(e);
      // toast is handled by wrapSync if error happens in promise
    }
    setExtending(false);
  }

  function openBalanceModal(b) {
    const remaining = deriveRemainingBalance(b);
    if (remaining <= 0) {
      toast.success("This booking is already fully paid.");
      return;
    }
    setBalanceModal({
      open: true,
      booking: b,
      amount: remaining.toFixed(2),
      method: "cash",
    });
  }

  function closeBalanceModal() {
    setBalanceModal(EMPTY_BALANCE_MODAL);
  }

  async function settleBalance(b, amountRaw, methodRaw) {
    const total = roundMoney(Number(b.totalAmount) || 0);
    const paid = roundMoney(Number(b.amountPaid) || 0);
    const currentRemaining = deriveRemainingBalance(b);
    if (currentRemaining <= 0) {
      toast.success("This booking is already fully paid.");
      return;
    }

    const amount = roundMoney(Number(amountRaw));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid payment amount.");
      return;
    }
    if (amount > currentRemaining) {
      toast.error("Amount cannot exceed remaining balance.");
      return;
    }
    const method = String(methodRaw || "cash").toLowerCase() === "gcash" ? "gcash" : "cash";

    const newAmountPaid = roundMoney(paid + amount);
    const newRemaining = roundMoney(Math.max(0, total - newAmountPaid));
    const nextPayStatus = resolveCustomerPayStatus(
      b.paymentPlan || PLAN_FULL,
      total,
      newAmountPaid
    );

    setActing(b.id);
    try {
      const batch = writeBatch(db);
      const bookingRef = doc(db, "bookings", b.id);
      batch.update(bookingRef, {
        amountPaid: newAmountPaid,
        remainingBalance: newRemaining,
        customerPaymentStatus: nextPayStatus,
        updatedAt: Timestamp.now(),
      });

      const linked = await getDocs(
        query(collection(db, "payments"), where("bookingId", "==", b.id))
      );
      linked.forEach((d) => {
        batch.update(d.ref, {
          amountPaid: newAmountPaid,
          remainingBalance: newRemaining,
          customerPaymentStatus: nextPayStatus,
          updatedAt: serverTimestamp(),
        });
      });

      const paymentRef = doc(collection(db, "payments"));
      batch.set(paymentRef, {
        bookingId: b.id,
        userId: b.userId || null,
        name: b.playerName || "Unknown",
        courtId: b.courtId || null,
        courtName: b.courtName || null,
        date: b.date || null,
        timeSlot: b.timeSlot || null,
        amount,
        totalAmount: total,
        amountPaid: newAmountPaid,
        remainingBalance: newRemaining,
        paymentPlan: b.paymentPlan || PLAN_FULL,
        customerPaymentStatus: nextPayStatus,
        method,
        paymentStatus: "Approved",
        paymentImageUrl: null,
        paymentKind: "balance",
        notes: "Balance payment settled by admin",
        createdAt: serverTimestamp(),
      });

      await wrapSync(batch.commit(), {
        successMsg: newRemaining <= 0 ? "Balance settled." : "Payment recorded.",
        offlineMsg: "Payment Saved Offline — Pending Server Sync",
        errorMsg: "Could not record balance payment."
      });

      closeBalanceModal();
      setSelected((s) =>
        s && s.id === b.id
          ? {
              ...s,
              amountPaid: newAmountPaid,
              remainingBalance: newRemaining,
              customerPaymentStatus: nextPayStatus,
            }
          : s
      );
    } catch (e) {
      console.error(e);
    } finally {
      setActing(null);
    }
  }

  async function updatePayStatus(booking, nextStatus) {
    const status = String(nextStatus || "").toLowerCase();
    if (!["paid", "partial", "unpaid"].includes(status)) {
      toast.error("Invalid pay status.");
      return;
    }
    setActing(booking.id);
    try {
      const batch = writeBatch(db);
      const bookingRef = doc(db, "bookings", booking.id);
      batch.update(bookingRef, {
        customerPaymentStatus: status,
        updatedAt: Timestamp.now(),
      });
      const linked = await getDocs(
        query(collection(db, "payments"), where("bookingId", "==", booking.id))
      );
      linked.forEach((d) => {
        batch.update(d.ref, {
          customerPaymentStatus: status,
          updatedAt: serverTimestamp(),
        });
      });

      await wrapSync(batch.commit(), {
        successMsg: "Pay status updated.",
        offlineMsg: "Status Update Saved Offline — Pending Server Sync",
        errorMsg: "Could not update pay status."
      });

      setSelected((s) => (s && s.id === booking.id ? { ...s, customerPaymentStatus: status } : s));
    } catch (e) {
      console.error(e);
    } finally {
      setActing(null);
    }
  }

  async function removeBooking(id) {
    const row = bookings.find((b) => b.id === id) ?? selected;
    const label = row?.playerName || row?.courtName || "this booking";
    let linkedSnap;
    try {
      linkedSnap = await getDocs(
        query(collection(db, "payments"), where("bookingId", "==", id))
      );
    } catch (e) {
      console.error(e);
      window.alert("Could not load linked payment data. Try again.");
      return;
    }
    const linkedPayments = linkedSnap.size;
    const linkedNote =
      linkedPayments > 0
        ? `\n\nAlso removes ${linkedPayments} linked payment record(s) from the same submission.`
        : "";
    if (
      !window.confirm(
        `Delete this booking permanently?\n\n${label}${linkedNote}\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setActing(id);
    try {
      const batch = writeBatch(db);
      linkedSnap.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, "bookings", id));
      
      await wrapSync(batch.commit(), {
        successMsg: "Booking deleted permanently.",
        offlineMsg: "Action Queued for Sync",
        errorMsg: "Could not delete this booking."
      });
    } catch (err) {
      console.error(err);
      window.alert("Could not delete this booking. Check your connection and permissions.");
    }
    setActing(null);
    setSelected(null);
  }

  let rangeFrom = dateFrom.trim();
  let rangeTo = dateTo.trim();
  if (rangeFrom && rangeTo && rangeFrom > rangeTo) {
    [rangeFrom, rangeTo] = [rangeTo, rangeFrom];
  }

  const filtered = bookings.filter((b) => {
    const matchFilter = filter === "All" || b.status === filter;
    const matchSearch =
      !search ||
      b.playerName?.toLowerCase().includes(search.toLowerCase()) ||
      b.courtName?.toLowerCase().includes(search.toLowerCase());
    if (!matchFilter || !matchSearch) return false;
    const day = bookingDayString(b, toDateMs);
    if (rangeFrom && (!day || day < rangeFrom)) return false;
    if (rangeTo && (!day || day > rangeTo)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const diff = toDateMs(a) - toDateMs(b);
    return sortByDate === "date_asc" ? diff : -diff;
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const paged = sorted.slice(start, start + PAGE_SIZE);

  const counts = {
    All:       bookings.length,
    Pending:   bookings.filter(b=>b.status==="Pending").length,
    Approved:  bookings.filter(b=>b.status==="Approved").length,
    Cancelled: bookings.filter(b=>b.status==="Cancelled").length,
  };

  if (loading) return <div className="ad-loading"><div className="ad-spinner"/></div>;

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Booking Management</h1>
          <p className="ad-page-sub">Review and manage all court bookings.</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="ad-filter-tabs">
        {Object.entries(counts).map(([k,v])=>(
          <button key={k} className={`ad-filter-tab ${filter===k?"active":""}`} onClick={()=>setFilter(k)}>
            {k} <span className="ad-filter-count">{v}</span>
          </button>
        ))}
      </div>

      <div className="ad-booking-toolbar">
        <div className="ad-booking-toolbar-row">
          <input
            className="ad-search"
            style={{ flex: "1 1 240px", minWidth: 200, maxWidth: "100%" }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by player or court..."
          />
          <span className="ad-count ad-booking-count">
            {sorted.length} booking{sorted.length !== 1 ? "s" : ""} • page {currentPage}/{totalPages}
          </span>
        </div>
        <div className="ad-booking-toolbar-row ad-booking-toolbar-dates">
          <div className="ad-date-field">
            <label htmlFor="bm-date-from">From</label>
            <input
              id="bm-date-from"
              type="date"
              className="ad-search ad-date-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="ad-date-field">
            <label htmlFor="bm-date-to">To</label>
            <input
              id="bm-date-to"
              type="date"
              className="ad-search ad-date-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="ad-date-field">
            <label htmlFor="bm-sort-order">Order</label>
            <select
              id="bm-sort-order"
              className="ad-search ad-date-input"
              value={sortByDate}
              onChange={(e) => setSortByDate(e.target.value)}
              aria-label="Sort order by booking date"
            >
              <option value="date_desc">Newest → oldest</option>
              <option value="date_asc">Oldest → newest</option>
            </select>
          </div>
          <div className="ad-date-presets">
            <span className="ad-date-presets-label">Quick range</span>
            <div className="ad-action-btns">
              <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => applyDatePreset("today")}>
                Today
              </button>
              <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => applyDatePreset("week")}>
                This week
              </button>
              <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => applyDatePreset("month")}>
                This month
              </button>
              <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => applyDatePreset("last7")}>
                Last 7 days
              </button>
              <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => applyDatePreset("clear")}>
                Clear range
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="ad-card">
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Player</th><th>Court</th><th>Date</th>
                <th>Time</th><th>Pay</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.length===0 && (
                <tr><td colSpan={7} className="ad-empty">No bookings found.</td></tr>
              )}
              {paged.map(b=>(
                <tr key={b.id} className="ad-table-row" onClick={()=>setSelected(b)}>
                  <td className="ad-td-main">{b.playerName??"—"}</td>
                  <td>{b.courtName??b.courtId??"—"}</td>
                  <td>{b.date??"—"}</td>
                  <td>{b.timeSlot??"—"}</td>
                  <td>
                    <span className={`ad-badge ad-badge-${PAY_STATUS_BADGE[(b.customerPaymentStatus||"").toLowerCase()]??"pending"}`}>
                      {(b.customerPaymentStatus ?? "—").toString()}
                    </span>
                  </td>
                  <td><span className={`ad-badge ad-badge-${b.hasPendingWrites ? "pending" : (STATUS_COLORS[b.status]??"pending")}`}>{b.hasPendingWrites ? "Pending Sync" : (b.status??"Pending")}</span></td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div className="ad-action-btns">
                      {b.status!=="Approved" && (
                        <button className="ad-btn ad-btn-sm ad-btn-success"
                          disabled={acting===b.id}
                          onClick={()=>setStatus(b.id,"Approved")}>
                          ✓ Approve
                        </button>
                      )}
                      {b.status!=="Cancelled" && (
                        <button className="ad-btn ad-btn-sm ad-btn-danger"
                          disabled={acting===b.id}
                          onClick={()=>setStatus(b.id,"Cancelled")}>
                          ✕ Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        className="ad-btn ad-btn-sm ad-btn-outline"
                        disabled={acting===b.id}
                        onClick={() => removeBooking(b.id)}
                        title="Remove this booking record"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sorted.length > PAGE_SIZE && (
          <div className="ad-modal-footer" style={{ borderTop: "1px solid var(--ad-border)" }}>
            <button
              type="button"
              className="ad-btn ad-btn-outline ad-btn-sm"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <span className="ad-count">Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              className="ad-btn ad-btn-outline ad-btn-sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="ad-modal-backdrop" onClick={()=>setSelected(null)}>
          <div className="ad-modal ad-modal-booking" onClick={e=>e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>Booking Detail</h3>
              <button className="ad-modal-close" onClick={()=>setSelected(null)}>✕</button>
            </div>
            <div className="ad-detail-grid">
              <div className="ad-detail-row"><span>Player</span><strong>{selected.playerName??selected.userId??'—'}</strong></div>
              <div className="ad-detail-row"><span>Contact</span><strong>{selected.contactNumber ?? "—"}</strong></div>
              <div className="ad-detail-row"><span>Court</span><strong>{selected.courtName??selected.courtId??'—'}</strong></div>
              <div className="ad-detail-row"><span>Date</span><strong>{selected.date??'—'}</strong></div>
              <div className="ad-detail-row"><span>Time Slot</span><strong>{selected.timeSlot??'—'}</strong></div>
              <div className="ad-detail-row"><span>Duration</span><strong>{selected.duration ?? "—"} hr</strong></div>
              <div className="ad-detail-row"><span>Total</span><strong>₱{roundMoney(Number(selected.totalAmount)||0).toFixed(2)}</strong></div>
              <div className="ad-detail-row"><span>Paid</span><strong>₱{roundMoney(Number(selected.amountPaid)||0).toFixed(2)}</strong></div>
              <div className="ad-detail-row"><span>Balance</span><strong>₱{deriveRemainingBalance(selected).toFixed(2)}</strong></div>
              <div className="ad-detail-row">
                <span>Pay status</span>
                <div className="ad-action-btns">
                  <select
                    className="ad-search text-sm py-2"
                    style={{ maxWidth: 170 }}
                    value={payStatusDraft}
                    onChange={(e) => setPayStatusDraft(e.target.value)}
                  >
                    <option value="partial">Partial</option>
                    <option value="paid">Full</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                  <button
                    type="button"
                    className="ad-btn ad-btn-sm ad-btn-primary"
                    disabled={acting===selected.id || payStatusDraft === String(selected.customerPaymentStatus || "").toLowerCase()}
                    onClick={() => updatePayStatus(selected, payStatusDraft)}
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="ad-detail-row"><span>Booking status</span>
                <span className={`ad-badge ad-badge-${STATUS_COLORS[selected.status]??"pending"}`}>{selected.status??"Pending"}</span>
              </div>
              {selected.notes && <div className="ad-detail-row ad-detail-full"><span>Notes</span><strong>{selected.notes}</strong></div>}
            </div>
            {selected.status !== "Cancelled" && (
              <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/30">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Extend time</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Add hours</label>
                    <select
                      className="ad-search text-sm py-2"
                      value={extendHours}
                      onChange={(e) => setExtendHours(Number(e.target.value))}
                    >
                      {EXTEND_OPTIONS.map((h) => (
                        <option key={h} value={h}>+{h} hr</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="ad-btn ad-btn-sm ad-btn-success"
                    disabled={extending}
                    onClick={() => applyExtension(selected)}
                  >
                    {extending ? "…" : "Extend"}
                  </button>
                </div>
              </div>
            )}
            <div className="ad-modal-footer ad-modal-footer-between">
              <button
                type="button"
                className="ad-btn ad-btn-outline"
                disabled={acting===selected.id}
                onClick={() => removeBooking(selected.id)}
              >
                Delete booking
              </button>
              <div className="ad-modal-footer-actions">
                {deriveRemainingBalance(selected) > 0 && selected.status !== "Cancelled" && (
                  <button
                    className="ad-btn ad-btn-sm ad-btn-success"
                    disabled={acting===selected.id}
                    onClick={() => openBalanceModal(selected)}
                    title="Record an on-site payment for remaining balance"
                  >
                    + Pay balance
                  </button>
                )}
                {selected.status!=="Approved" && (
                  <button className="ad-btn ad-btn-success" disabled={acting===selected.id} onClick={()=>setStatus(selected.id,"Approved")}>✓ Approve</button>
                )}
                {selected.status!=="Cancelled" && (
                  <button className="ad-btn ad-btn-danger" disabled={acting===selected.id} onClick={()=>setStatus(selected.id,"Cancelled")}>✕ Cancel</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {balanceModal.open && balanceModal.booking && (
        <div className="ad-modal-backdrop" onClick={closeBalanceModal}>
          <div className="ad-modal ad-modal-balance" onClick={(e) => e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>Pay Remaining Balance</h3>
              <button className="ad-modal-close" onClick={closeBalanceModal}>✕</button>
            </div>
            <div className="ad-modal-form">
              <div className="ad-detail-row">
                <span>Player</span>
                <strong>{balanceModal.booking.playerName ?? "—"}</strong>
              </div>
              <div className="ad-detail-row">
                <span>Remaining balance</span>
                <strong>₱{deriveRemainingBalance(balanceModal.booking).toFixed(2)}</strong>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold block mb-1">
                  Amount to record
                </label>
                <input
                  className="ad-search"
                  type="number"
                  min="0"
                  step="0.01"
                  value={balanceModal.amount}
                  onChange={(e) =>
                    setBalanceModal((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold block mb-1">
                  Method
                </label>
                <div className="ad-action-btns">
                  <button
                    type="button"
                    className={`ad-btn ad-btn-sm ${
                      balanceModal.method === "cash" ? "ad-btn-success" : "ad-btn-outline"
                    }`}
                    onClick={() => setBalanceModal((prev) => ({ ...prev, method: "cash" }))}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    className={`ad-btn ad-btn-sm ${
                      balanceModal.method === "gcash" ? "ad-btn-success" : "ad-btn-outline"
                    }`}
                    onClick={() => setBalanceModal((prev) => ({ ...prev, method: "gcash" }))}
                  >
                    GCash
                  </button>
                </div>
              </div>
            </div>
            <div className="ad-modal-footer">
              <button type="button" className="ad-btn ad-btn-outline" onClick={closeBalanceModal}>
                Cancel
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-success"
                disabled={acting===balanceModal.booking.id}
                onClick={() =>
                  settleBalance(balanceModal.booking, balanceModal.amount, balanceModal.method)
                }
              >
                {acting===balanceModal.booking.id ? "Saving..." : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}