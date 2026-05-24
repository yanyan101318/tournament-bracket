// src/admin/AdminSchedule.jsx
import { useState, useEffect, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";

function paymentDayKey(p) {
  const ts = p.createdAt;
  if (!ts) return null;
  const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "yyyy-MM-dd");
}

export default function AdminSchedule() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => format(new Date(), "yyyy-MM-dd"));

  useEffect(() => {
    const qB = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
    const unsubB = onSnapshot(
      qB,
      { includeMetadataChanges: true },
      (snap) => {
        setBookings(snap.docs.map((d) => ({ id: d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    const qP = query(collection(db, "payments"), orderBy("createdAt", "desc"));
    const unsubP = onSnapshot(qP, { includeMetadataChanges: true }, (snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data() })));
    });
    return () => {
      unsubB();
      unsubP();
    };
  }, []);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const { bookingsByDate, paymentsByDate, activities } = useMemo(() => {
    const bookingsByDateMap = new Map();
    for (const b of bookings) {
      const key = b.date;
      if (!key || typeof key !== "string") continue;
      if (!bookingsByDateMap.has(key)) bookingsByDateMap.set(key, []);
      bookingsByDateMap.get(key).push(b);
    }

    const paymentsByDateMap = new Map();
    for (const p of payments) {
      const key = paymentDayKey(p);
      if (!key) continue;
      if (!paymentsByDateMap.has(key)) paymentsByDateMap.set(key, []);
      paymentsByDateMap.get(key).push(p);
    }

    const dayBookings = bookingsByDateMap.get(selected) ?? [];
    const dayPayments = paymentsByDateMap.get(selected) ?? [];
    const rows = [];
    for (const b of dayBookings) {
      rows.push({
        kind: "booking",
        sort: `${b.timeSlot || "00:00"}-${b.id}`,
        label: "Court booking",
        title: `${b.playerName || "Guest"} · ${b.courtName || b.courtId || "Court"}`,
        sub: [`${b.timeSlot || ""}${b.duration ? ` (${b.duration} hr${b.duration > 1 ? 's' : ''})` : ""}`, b.status, b.hasPendingWrites ? "Pending Sync" : null].filter(Boolean).join(" · "),
        id: b.id,
      });
    }
    for (const p of dayPayments) {
      const ts = p.createdAt?.toDate?.() ?? null;
      const timeStr = ts ? format(ts, "h:mm a") : "";
      rows.push({
        kind: "payment",
        sort: `${timeStr}-${p.id}`,
        label: "Payment activity",
        title: `${p.name || "Customer"} · ₱${p.amount ?? "—"}`,
        sub: [p.method, p.paymentStatus, p.hasPendingWrites ? "Pending Sync" : null].filter(Boolean).join(" · "),
        id: p.id,
      });
    }
    rows.sort((a, b) => a.sort.localeCompare(b.sort));

    return {
      bookingsByDate: bookingsByDateMap,
      paymentsByDate: paymentsByDateMap,
      activities: rows,
    };
  }, [bookings, payments, selected]);

  if (loading) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="ad-page-title">Schedule</h1>
          <p className="ad-page-sub">
            Calendar of customer court bookings and payment activity by day.
          </p>
        </div>
        <Link
          to="/admin/new-booking"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-sm font-bold transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          New booking
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 ad-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              onClick={() => setCursor(subMonths(cursor, 1))}
              aria-label="Previous month"
            >
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <h2 className="text-lg font-black text-white tracking-tight">
              {format(cursor, "MMMM yyyy")}
            </h2>
            <button
              type="button"
              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              onClick={() => setCursor(addMonths(cursor, 1))}
              aria-label="Next month"
            >
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, cursor);
              const isSelected = selected === key;
              const bCount = (bookingsByDate.get(key) ?? []).length;
              const pCount = (paymentsByDate.get(key) ?? []).length;
              const hasActivity = bCount + pCount > 0;
              const isToday = isSameDay(day, new Date());

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={`
                    relative min-h-[3rem] sm:min-h-[4rem] rounded-xl border text-left p-1.5 sm:p-2 transition-all
                    ${!inMonth ? "opacity-35 border-transparent bg-slate-900/20" : "border-slate-800 bg-slate-900/40"}
                    ${isSelected ? "ring-2 ring-cyan-500 border-cyan-500/50 bg-cyan-500/10" : "hover:border-slate-600"}
                    ${isToday && !isSelected ? "ring-1 ring-slate-600" : ""}
                  `}
                >
                  <span
                    className={`text-xs sm:text-sm font-bold ${
                      inMonth ? "text-white" : "text-slate-600"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                  {hasActivity && (
                    <div className="absolute bottom-1 left-1.5 right-1.5 flex flex-wrap gap-0.5 justify-center">
                      {bCount > 0 && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                          title={`${bCount} booking(s)`}
                        />
                      )}
                      {pCount > 0 && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          title={`${pCount} payment(s)`}
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Bookings
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Payments
            </span>
          </div>
        </div>

        <div className="ad-card p-4 sm:p-6 flex flex-col min-h-[320px]">
          <h3 className="text-sm font-black text-white tracking-tight uppercase mb-1">
            {format(new Date(selected + "T12:00:00"), "EEEE, MMM d, yyyy")}
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">
            {activities.length} item{activities.length === 1 ? "" : "s"} on this day
          </p>

          <div className="flex-1 overflow-y-auto space-y-2 max-h-[480px] custom-scrollbar pr-1">
            {activities.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl">
                <span className="material-symbols-outlined text-slate-700 text-3xl mb-2 block">
                  event_busy
                </span>
                <p className="text-slate-500 text-xs font-medium">
                  No bookings or payment activity this day.
                </p>
              </div>
            ) : (
              activities.map((a) => (
                <div
                  key={`${a.kind}-${a.id}`}
                  className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        a.kind === "booking"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-amber-500/15 text-amber-400"
                      }`}
                    >
                      {a.label}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-white">{a.title}</div>
                  {a.sub && (
                    <div className="text-[11px] text-slate-500 mt-0.5">{a.sub}</div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 flex gap-2">
            <Link
              to="/admin/bookings"
              className="flex-1 text-center py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              All bookings
            </Link>
            <Link
              to="/admin/payments"
              className="flex-1 text-center py-2 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              All payments
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
