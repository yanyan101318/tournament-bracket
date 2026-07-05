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
import { roundMoney, parseCashAmount } from "../lib/bookingMoney";
import {
  resolveCustomerPayStatus,
  resolveBookingTotals,
  PLAN_FULL,
} from "../lib/bookingPayment";
import toast from "react-hot-toast";
import { useOfflineSync } from "../hooks/useOfflineSync";
import ReceiptPrint from "../components/ReceiptPrint";
import { sendBookingSMS } from "../lib/smsService";
import { resolveBookingContactNumber } from "../lib/resolveContactNumber";
import ExportButton from "../components/export/ExportButton";

const STATUS_COLORS = { Pending: "pending", Approved: "approved", Cancelled: "rejected" };
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
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [sortByDate, setSortByDate] = useState("created_desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [extendHours, setExtendHours] = useState(1);
  const [extending, setExtending] = useState(false);
  const [balanceModal, setBalanceModal] = useState(EMPTY_BALANCE_MODAL);

  const [printData, setPrintData] = useState(null);
  const [linkedPayment, setLinkedPayment] = useState(null);
  const [zoomImage, setZoomImage] = useState(null);
  const [rejectReasonModal, setRejectReasonModal] = useState({ open: false, reason: "" });
  const [resolvedContact, setResolvedContact] = useState(null);
  const [paidEditDraft, setPaidEditDraft] = useState("");
  const [savingPaid, setSavingPaid] = useState(false);
  const { wrapSync } = useOfflineSync();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Booking Management";
  }, []);

  useEffect(() => {
    const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
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
      setResolvedContact(null);
      return;
    }
    let cancelled = false;
    resolveBookingContactNumber(db, selected).then((phone) => {
      if (!cancelled) setResolvedContact(phone);
    });
    return () => { cancelled = true; };
  }, [selected]);



  useEffect(() => {
    setPage(1);
  }, [filter, search, sortByDate, dateFrom, dateTo]);

  useEffect(() => {
    if (!selected) {
      setLinkedPayment(null);
      setZoomImage(null);
      setRejectReasonModal({ open: false, reason: "" });
      return;
    }
    const q = query(collection(db, "payments"), where("bookingId", "==", selected.id));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const sorted = [...snap.docs].sort((a, b) => {
          const ta = a.data().createdAt?.toMillis?.() ?? 0;
          const tb = b.data().createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        const latest = sorted[0];
        setLinkedPayment({ id: latest.id, ...latest.data() });
      } else {
        setLinkedPayment(null);
      }
    }, (err) => {
      console.error("Payment listener error:", err);
      toast.error("Failed to load payment data");
    });
    return () => unsub();
  }, [selected]);

  const selectedMoney = selected
    ? resolveBookingTotals(selected, linkedPayment)
    : { total: 0, paid: 0, remaining: 0 };

  useEffect(() => {
    if (!selected) {
      setPaidEditDraft("");
      return;
    }
    const { paid } = resolveBookingTotals(selected, linkedPayment);
    const gcashHint =
      String(selected.paymentMethod || linkedPayment?.method || "").toLowerCase() === "gcash";
    const payRecordAmt = roundMoney(Number(linkedPayment?.amount) || 0);
    const suggested =
      paid > 0 ? paid : gcashHint && payRecordAmt > 0 ? payRecordAmt : paid;
    setPaidEditDraft(suggested > 0 ? suggested.toFixed(2) : "");
  }, [
    selected,
    linkedPayment,
    selected?.id,
    selected?.amountPaid,
    selected?.totalAmount,
    linkedPayment?.id,
    linkedPayment?.amount,
    linkedPayment?.amountPaid,
  ]);

  async function savePaidAmount() {
    if (!selected) return;
    const paid = roundMoney(parseCashAmount(paidEditDraft));
    if (!Number.isFinite(paid) || paid < 0) {
      toast.error("Enter a valid amount received.");
      return;
    }

    let { total } = resolveBookingTotals(selected, linkedPayment);
    if (total <= 0 && paid > 0) total = paid;
    if (total <= 0) {
      toast.error("Set court pricing or payment total before recording amount paid.");
      return;
    }
    if (paid > total) {
      toast.error("Amount paid cannot exceed the booking total.");
      return;
    }

    const remaining = roundMoney(Math.max(0, total - paid));
    const payStatus = resolveCustomerPayStatus(
      selected.paymentPlan || PLAN_FULL,
      total,
      paid
    );

    setSavingPaid(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "bookings", selected.id), {
        totalAmount: total,
        amountPaid: paid,
        remainingBalance: remaining,
        customerPaymentStatus: payStatus,
        updatedAt: Timestamp.now(),
      });

      const linkedSnap = await getDocs(
        query(collection(db, "payments"), where("bookingId", "==", selected.id))
      );
      linkedSnap.forEach((d) => {
        const data = d.data();
        const patch = {
          totalAmount: total,
          amountPaid: paid,
          remainingBalance: remaining,
          customerPaymentStatus: payStatus,
          updatedAt: serverTimestamp(),
        };
        if (data.paymentKind !== "balance") {
          patch.amount = total;
        }
        batch.update(d.ref, patch);
      });

      await wrapSync(batch.commit(), {
        successMsg: "Payment amount saved.",
        offlineMsg: "Payment amount queued for sync",
        errorMsg: "Could not save payment amount.",
      });

      setSelected((s) =>
        s && s.id === selected.id
          ? {
            ...s,
            totalAmount: total,
            amountPaid: paid,
            remainingBalance: remaining,
            customerPaymentStatus: payStatus,
          }
          : s
      );
      setPaidEditDraft(paid.toFixed(2));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingPaid(false);
    }
  }

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
      const batch = writeBatch(db);
      batch.update(doc(db, "bookings", id), {
        status,
        reviewedAt: Timestamp.now(),
      });

      if (status === "Cancelled") {
        const paySnap = await getDocs(query(collection(db, "payments"), where("bookingId", "==", id)));
        paySnap.forEach(d => {
          batch.update(d.ref, { paymentStatus: "Cancelled" });
        });
      }

      await wrapSync(batch.commit(), {
        successMsg: `Booking ${status}`,
        offlineMsg: "Action Queued for Sync"
      });
    } catch (err) { console.error(err); }
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
      timeSlot: b.startTime || b.timeSlot,
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
        endTime: check.newEndTime,
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
            endTime: check.newEndTime,
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

  async function handlePrintReceipt(b) {
    const receiptId = "RCPT-" + b.id.substring(0, 5).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900);
    const printedBy = "Admin";

    setActing(b.id);
    try {
      await updateDoc(doc(db, "bookings", b.id), {
        latestReceiptId: receiptId,
        lastPrintedAt: Timestamp.now(),
        lastPrintedBy: printedBy
      });
    } catch (err) {
      console.error("Failed to log receipt print", err);
    }
    setActing(null);
    setPrintData({ booking: b, receiptId, printedBy });
  }

  async function approvePayment() {
    if (!linkedPayment) return;
    setActing("payment_approve");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "payments", linkedPayment.id), {
        paymentStatus: "Approved",
        reviewedAt: serverTimestamp()
      });
      batch.update(doc(db, "bookings", selected.id), {
        status: "Confirmed"
      });
      await wrapSync(batch.commit(), {
        successMsg: "Payment approved successfully",
        offlineMsg: "Approval queued for sync",
        silent: true // handle toast manually
      });

      setActing("payment_approve_sms");
      const smsMsg = `Assalamu alaikum! RANAW PICKLEBALL COURT: Your booking has been approved for ${selected.date} at ${selected.timeSlot}. Court ${selected.courtName || selected.courtId}. Please arrive 15 minutes before your scheduled time.`;
      const phone = await resolveBookingContactNumber(db, selected);
      const smsRes = await sendBookingSMS(selected.id, phone, smsMsg);

      if (smsRes.success) {
        toast.success("Booking approved and SMS sent successfully");
      } else {
        if (smsRes.code === "no_number") {
          toast.success("Booking updated but SMS could not be sent (missing contact number)");
        } else if (smsRes.code === "invalid_format") {
          toast.success("Booking updated but SMS failed due to invalid phone number");
        } else if (smsRes.code === "config_error") {
          toast.error(smsRes.error || "SMS sender ID not configured (M360_SHORTCODE_MASK in .env)");
        } else {
          toast.error(smsRes.error || "Booking updated but SMS service failed");
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Update failed. Please try again.");
    } finally {
      setActing(null);
    }
  }

  async function rejectPayment() {
    if (!linkedPayment || !rejectReasonModal.reason.trim()) {
      toast.error("Please enter a rejection reason");
      return;
    }
    setActing("payment_reject");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "payments", linkedPayment.id), {
        paymentStatus: "Rejected",
        rejectionReason: rejectReasonModal.reason.trim(),
        reviewedAt: serverTimestamp()
      });
      batch.update(doc(db, "bookings", selected.id), {
        status: "Rejected"
      });
      await wrapSync(batch.commit(), {
        successMsg: "Payment rejected",
        offlineMsg: "Rejection queued for sync",
        silent: true // handle toast manually
      });
      setRejectReasonModal({ open: false, reason: "" });

      setActing("payment_reject_sms");
      const smsMsg = "Assalamu alaikum! RANAW PICKLEBALL COURT: Your booking has been REJECTED. Please review your booking details or contact support for assistance. Thank you.";
      const phone = await resolveBookingContactNumber(db, selected);
      const smsRes = await sendBookingSMS(selected.id, phone, smsMsg);

      if (smsRes.success) {
        toast.success("Booking rejected and SMS notification sent");
      } else {
        if (smsRes.code === "no_number") {
          toast.success("Booking updated but SMS could not be sent (missing contact number)");
        } else if (smsRes.code === "invalid_format") {
          toast.success("Booking updated but SMS failed due to invalid phone number");
        } else if (smsRes.code === "config_error") {
          toast.error(smsRes.error || "SMS sender ID not configured (M360_SHORTCODE_MASK in .env)");
        } else {
          toast.error(smsRes.error || "Booking updated but SMS service failed");
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Update failed. Please try again.");
    } finally {
      setActing(null);
    }
  }

  async function setPaymentPending() {
    if (!linkedPayment) return;
    setActing("payment_pending");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "payments", linkedPayment.id), {
        paymentStatus: "Pending"
      });
      batch.update(doc(db, "bookings", selected.id), {
        status: "Pending Review"
      });
      await wrapSync(batch.commit(), {
        successMsg: "Marked as pending review",
        offlineMsg: "Update queued for sync"
      });
    } catch (e) {
      console.error(e);
      toast.error("Update failed. Please try again.");
    } finally {
      setActing(null);
    }
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
    if (sortByDate.startsWith("created")) {
      const aTime = a.createdAt?.toMillis?.() || 0;
      const bTime = b.createdAt?.toMillis?.() || 0;
      const diff = aTime - bTime;
      return sortByDate === "created_asc" ? diff : -diff;
    } else {
      const diff = toDateMs(a) - toDateMs(b);
      return sortByDate === "date_asc" ? diff : -diff;
    }
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const paged = sorted.slice(start, start + PAGE_SIZE);

  const counts = {
    All: bookings.length,
    Pending: bookings.filter(b => b.status === "Pending").length,
    Approved: bookings.filter(b => b.status === "Approved").length,
    Cancelled: bookings.filter(b => b.status === "Cancelled").length,
  };

  if (loading) return <div className="ad-loading"><div className="ad-spinner" /></div>;

  return (
    <div className="ad-page">
      <div className="ad-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="ad-page-title">Booking Management</h1>
          <p className="ad-page-sub">Review and manage all court bookings.</p>
        </div>
        <ExportButton
          pageTitle="Bookings Report"
          schemaKey="MY_BOOKINGS"
          exportData={() => {
            if (sorted.length === 0) {
              toast.error("No bookings found to export.");
              return [];
            }
            return sorted.map(b => ({
              bookingId: b.id,
              court: b.courtName ?? b.courtId ?? "—",
              date: b.date ?? "—",
              timeSlot: b.timeSlot ?? "—",
              playerName: b.playerName ?? b.userId ?? "—",
              contactNumber: b.contactNumber ?? "—",
              status: b.status ?? "Pending",
              amount: Number(b.totalAmount) || 0,
              paymentMethod: b.customerPaymentStatus ?? "—",
              notes: ""
            }));
          }}
          filename="Booking_Management_Export"
        />
      </div>

      {/* Filter tabs */}
      <div className="ad-filter-tabs">
        {Object.entries(counts).map(([k, v]) => (
          <button key={k} className={`ad-filter-tab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
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
              <option value="created_desc">Received (Newest first)</option>
              <option value="created_asc">Received (Oldest first)</option>
              <option value="date_asc">Play Date (Soonest first)</option>
              <option value="date_desc">Play Date (Furthest first)</option>
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
              {paged.length === 0 && (
                <tr><td colSpan={7} className="ad-empty">No bookings found.</td></tr>
              )}
              {paged.map(b => (
                <tr key={b.id} className="ad-table-row" onClick={() => setSelected(b)}>
                  <td className="ad-td-main">{b.playerName ?? "—"}</td>
                  <td>{b.courtName ?? b.courtId ?? "—"}</td>
                  <td>{b.date ?? "—"}</td>
                  <td>{b.timeSlot ?? "—"}</td>
                  <td>
                    <span className={`ad-badge ad-badge-${PAY_STATUS_BADGE[(b.customerPaymentStatus || "").toLowerCase()] ?? "pending"}`}>
                      {(b.customerPaymentStatus ?? "—").toString()}
                    </span>
                  </td>
                  <td><span className={`ad-badge ad-badge-${b.hasPendingWrites ? "pending" : (STATUS_COLORS[b.status] ?? "pending")}`}>{b.hasPendingWrites ? "Pending Sync" : (b.status ?? "Pending")}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="ad-action-btns">
                      {b.status !== "Approved" && (
                        <button className="ad-btn ad-btn-sm ad-btn-success"
                          disabled={acting === b.id}
                          onClick={() => setStatus(b.id, "Approved")}>
                          ✓ Approve
                        </button>
                      )}
                      {b.status !== "Cancelled" && (
                        <button className="ad-btn ad-btn-sm ad-btn-danger"
                          disabled={acting === b.id}
                          onClick={() => setStatus(b.id, "Cancelled")}>
                          ✕ Cancel
                        </button>
                      )}
                      <button
                        type="button"
                        className="ad-btn ad-btn-sm ad-btn-outline"
                        disabled={acting === b.id}
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
        <div className="ad-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="ad-modal ad-modal-booking flex flex-col md:flex-row bg-[#0f172a]/95 backdrop-blur-xl border border-slate-700 shadow-2xl rounded-2xl overflow-hidden" style={{ maxWidth: '1200px', width: '96vw' }} onClick={e => e.stopPropagation()}>
            {/* LEFT COLUMN: INFO */}
            <div className="flex-1 flex flex-col max-h-[85vh] overflow-y-auto custom-scrollbar border-r border-slate-800">
              <div className="ad-modal-header sticky top-0 bg-[#0f172a]/95 backdrop-blur-md z-10 border-b border-slate-800">
                <h3>Booking & Payment Details</h3>
                <button className="ad-modal-close lg:hidden" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className="p-4 space-y-6">
                {/* Booking Info */}
                <div>
                  <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Booking Information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="ad-detail-row"><span>Player</span><strong>{selected.playerName ?? selected.userId ?? '—'}</strong></div>
                    <div className="ad-detail-row"><span>Contact</span><strong>{resolvedContact ?? selected.contactNumber ?? "—"}</strong></div>
                    <div className="ad-detail-row"><span>Court</span><strong>{selected.courtName ?? selected.courtId ?? '—'}</strong></div>
                    <div className="ad-detail-row"><span>Date</span><strong>{selected.date ?? '—'}</strong></div>
                    <div className="ad-detail-row"><span>Time Slot</span><strong>{selected.timeSlot ?? '—'}</strong></div>
                    <div className="ad-detail-row"><span>Duration</span><strong>{selected.duration ?? "—"} hr</strong></div>
                    <div className="ad-detail-row"><span>Total</span><strong>₱{selectedMoney.total.toFixed(2)}</strong></div>
                    <div className="ad-detail-row ad-detail-row-edit">
                      <span>Paid (GCash / cash received)</span>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="ad-search text-sm py-2 w-32"
                          value={paidEditDraft}
                          onChange={(e) => setPaidEditDraft(e.target.value)}
                          placeholder="0.00"
                          aria-label="Amount paid"
                        />
                        <button
                          type="button"
                          className="ad-btn ad-btn-sm ad-btn-success"
                          disabled={savingPaid || acting === selected.id}
                          onClick={savePaidAmount}
                        >
                          {savingPaid ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                    <div className="ad-detail-row"><span>Balance</span><strong>₱{selectedMoney.remaining.toFixed(2)}</strong></div>
                    {Number(selected.totalAmount) === 0 && selectedMoney.total > 0 && (
                      <p className="col-span-2 text-xs text-amber-400/90">
                        Total was missing on the booking — showing ₱{selectedMoney.total.toFixed(2)} from the payment record. Save paid amount to sync both records.
                      </p>
                    )}
                    <div className="ad-detail-row"><span>Booking Status</span>
                      <span className={`ad-badge ad-badge-${STATUS_COLORS[selected.status] ?? "pending"} mt-1 w-fit`}>{selected.status ?? "Pending"}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Info */}
                {linkedPayment && (
                  <div>
                    <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Payment Record</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="ad-detail-row"><span>Amount</span><strong>₱{roundMoney(Number(linkedPayment.amount) || 0).toFixed(2)}</strong></div>
                      <div className="ad-detail-row"><span>Discount</span><strong>₱{roundMoney(Number(linkedPayment.discount) || 0).toFixed(2)}</strong></div>
                      <div className="ad-detail-row"><span>Promo Code</span><strong>{linkedPayment.promoCode ?? "None"}</strong></div>
                      <div className="ad-detail-row"><span>Method</span><strong className="capitalize">{linkedPayment.method ?? "—"}</strong></div>
                      <div className="ad-detail-row"><span>Status</span>
                        <span className={`ad-badge ad-badge-${PAY_STATUS_BADGE[(linkedPayment.paymentStatus || "").toLowerCase()] ?? "pending"} mt-1 w-fit`}>
                          {linkedPayment.paymentStatus ?? "Pending"}
                        </span>
                      </div>
                      <div className="ad-detail-row"><span>Created At</span><strong>{linkedPayment.createdAt?.toDate ? format(linkedPayment.createdAt.toDate(), "MMM dd, yyyy — h:mm a") : "—"}</strong></div>
                      <div className="ad-detail-row"><span>Reviewed At</span><strong>{linkedPayment.reviewedAt?.toDate ? format(linkedPayment.reviewedAt.toDate(), "MMM dd, yyyy — h:mm a") : "Not reviewed"}</strong></div>
                    </div>
                  </div>
                )}

                {!linkedPayment && (
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 flex items-center justify-center text-sm text-slate-500 font-medium">
                    No linked payment record found for this booking.
                  </div>
                )}

                {/* Extend Time */}
                {selected.status !== "Cancelled" && (
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Extend time</p>
                    <div className="flex flex-wrap items-end gap-3">
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

                {/* Court Orders & Checkout Section */}
                
              </div>

              <div className="mt-auto p-4 border-t border-slate-800 bg-[#0f172a]/95 sticky bottom-0 z-10 flex flex-wrap gap-2 items-center justify-between">
                <button
                  type="button"
                  className="ad-btn ad-btn-outline ad-btn-sm"
                  disabled={acting === selected.id}
                  onClick={() => removeBooking(selected.id)}
                >
                  Delete Booking
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="ad-btn ad-btn-primary ad-btn-sm"
                    disabled={acting === selected.id}
                    onClick={() => handlePrintReceipt(selected)}
                  >
                    Print Receipt
                  </button>
                  {selectedMoney.remaining > 0 && selected.status !== "Cancelled" && (
                    <button
                      className="ad-btn ad-btn-sm ad-btn-success"
                      disabled={acting === selected.id}
                      onClick={() => openBalanceModal(selected)}
                    >
                      + Pay balance
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: PAYMENT PREVIEW & ACTIONS */}
            <div className="md:w-[420px] lg:w-[500px] flex-shrink-0 flex flex-col bg-slate-900/50 relative max-h-[85vh]">
              <div className="absolute top-4 right-4 z-20 hidden lg:block">
                <button className="w-8 h-8 rounded-full bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-colors shadow-lg" onClick={() => setSelected(null)}>✕</button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Payment Proof Preview</h4>

                {linkedPayment?.paymentImageUrl ? (
                  <div
                    className="relative rounded-xl overflow-hidden border border-slate-700 bg-black/50 shadow-2xl cursor-pointer group flex-1 min-h-[300px]"
                    onClick={() => setZoomImage(linkedPayment.paymentImageUrl)}
                  >
                    <img
                      src={linkedPayment.paymentImageUrl}
                      alt="Payment Proof"
                      className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-2 text-white">
                        <span className="material-symbols-outlined text-4xl">zoom_in</span>
                        <span className="text-sm font-semibold tracking-wide">Click to Zoom</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-[300px] rounded-xl border border-dashed border-slate-700 bg-slate-800/30 flex flex-col items-center justify-center text-slate-500 gap-3">
                    <span className="material-symbols-outlined text-4xl opacity-50">receipt_long</span>
                    <p className="text-sm font-medium">No payment proof uploaded</p>
                  </div>
                )}

                {/* Reject Reason Input (conditionally visible) */}
                {rejectReasonModal.open && (
                  <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 shadow-inner">
                    <label className="text-[11px] font-bold text-red-400 uppercase tracking-wide block mb-2">Rejection Reason</label>
                    <textarea
                      className="w-full bg-slate-900/80 border border-red-500/30 rounded-lg p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 resize-none"
                      rows="2"
                      placeholder="Why is this payment being rejected?"
                      value={rejectReasonModal.reason}
                      onChange={(e) => setRejectReasonModal(prev => ({ ...prev, reason: e.target.value }))}
                    ></textarea>
                    <div className="flex gap-2 mt-3 justify-end">
                      <button className="text-xs font-semibold text-slate-400 hover:text-white px-3 py-1.5" onClick={() => setRejectReasonModal({ open: false, reason: "" })}>Cancel</button>
                      <button className="text-xs font-bold bg-red-500 text-white px-4 py-1.5 rounded-md hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20" onClick={rejectPayment} disabled={acting === "payment_reject" || acting === "payment_reject_sms"}>
                        {acting === "payment_reject" ? "Rejecting..." : acting === "payment_reject_sms" ? "Sending SMS..." : "Confirm Reject"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md sticky bottom-0 z-10 flex flex-col gap-2">
                {!rejectReasonModal.open && (
                  <div className="flex gap-2 w-full">
                    <button
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                      onClick={approvePayment}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Approved"}
                    >
                      {acting === "payment_approve" ? "Approving..." : acting === "payment_approve_sms" ? "Sending SMS..." : "Approve Payment"}
                    </button>
                    <button
                      className="flex-1 bg-red-500/10 border border-red-500/30 hover:bg-red-500 hover:text-white text-red-400 font-bold py-2.5 px-4 rounded-lg transition-all disabled:opacity-50"
                      onClick={() => setRejectReasonModal({ open: true, reason: "" })}
                      disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Rejected"}
                    >
                      Reject
                    </button>
                  </div>
                )}
                <button
                  className="w-full bg-transparent border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 font-semibold py-2 px-4 rounded-lg transition-colors text-sm disabled:opacity-50"
                  onClick={setPaymentPending}
                  disabled={!linkedPayment || acting || linkedPayment.paymentStatus === "Pending"}
                >
                  {acting === "payment_pending" ? "Setting..." : "Set as Pending Review"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Image Modal */}
      {zoomImage && (
        <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center backdrop-blur-sm p-4 lg:p-8" onClick={() => setZoomImage(null)}>
          <button className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center transition-colors backdrop-blur-md" onClick={() => setZoomImage(null)}>
            <span className="material-symbols-outlined">close</span>
          </button>
          <img
            src={zoomImage}
            alt="Fullscreen Payment Proof"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <a
            href={zoomImage}
            download="payment-proof.jpg"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-6 right-6 flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2.5 px-5 rounded-full transition-all shadow-lg shadow-cyan-500/20"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            Download
          </a>
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
                    className={`ad-btn ad-btn-sm ${balanceModal.method === "cash" ? "ad-btn-success" : "ad-btn-outline"
                      }`}
                    onClick={() => setBalanceModal((prev) => ({ ...prev, method: "cash" }))}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    className={`ad-btn ad-btn-sm ${balanceModal.method === "gcash" ? "ad-btn-success" : "ad-btn-outline"
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
                disabled={acting === balanceModal.booking.id}
                onClick={() =>
                  settleBalance(balanceModal.booking, balanceModal.amount, balanceModal.method)
                }
              >
                {acting === balanceModal.booking.id ? "Saving..." : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {printData && (
        <ReceiptPrint
          booking={printData.booking}
          receiptId={printData.receiptId}
          printedBy={printData.printedBy}
          onAfterPrint={() => setPrintData(null)}
        />
      )}
    </div>
  );
}