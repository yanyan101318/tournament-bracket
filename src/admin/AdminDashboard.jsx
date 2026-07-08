// src/admin/AdminDashboard.jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../auth/AuthContext";

function PosStatTile({ icon, label, value, sub, accent }) {
  const ring =
    accent === "emerald"
      ? "border-emerald-500/35 shadow-[0_0_24px_rgba(16,185,129,0.12)]"
      : accent === "amber"
        ? "border-amber-500/35 shadow-[0_0_24px_rgba(245,158,11,0.12)]"
        : accent === "violet"
          ? "border-violet-500/35 shadow-[0_0_24px_rgba(139,92,246,0.12)]"
          : "border-cyan-500/40 shadow-[0_0_28px_rgba(34,211,238,0.15)]";
  const iconWrap =
    accent === "emerald"
      ? "bg-emerald-500/15 text-emerald-400"
      : accent === "amber"
        ? "bg-amber-500/15 text-amber-400"
        : accent === "violet"
          ? "bg-violet-500/15 text-violet-300"
          : "bg-cyan-500/15 text-cyan-400";
  return (
    <div
      className={`bg-[#151e2d] border rounded-xl p-4 transition-all hover:border-cyan-500/45 group ${ring}`}
    >
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-lg ${iconWrap}`}>
          <span className="material-symbols-outlined text-xl">{icon}</span>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-tight text-cyan-500/80"></span>
      </div>
      <div className="space-y-0.5">
        <h3 className="text-2xl font-black text-white tracking-tighter tabular-nums">{value}</h3>
        <p className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">{label}</p>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-800/50">
        <span className="text-[10px] text-slate-500 font-medium leading-snug">{sub}</span>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({
    bookingsToday: 0,
    salesToday: 0,
    activeBookings: 0,
    pendingPayments: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Dashboard";
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTs = Timestamp.fromDate(today);
        const todayStr = format(today, "yyyy-MM-dd");

        const [bSnap, pSnap, bRecentSnap] = await Promise.all([
          getDocs(query(collection(db, "bookings"), where("createdAt", ">=", todayTs))),
          getDocs(query(collection(db, "payments"), where("paymentStatus", "==", "Pending"))),
          getDocs(query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(250))),
        ]);

        let salesToday = 0;
        bSnap.forEach((d) => {
          salesToday += Number(d.data().amountPaid) || 0;
        });

        let activeBookings = 0;
        bRecentSnap.forEach((d) => {
          const x = d.data();
          if (x.date === todayStr && x.status === "Approved") activeBookings += 1;
        });

        setStats({
          bookingsToday: bSnap.size,
          salesToday,
          activeBookings,
          pendingPayments: pSnap.size,
        });
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (loading) return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2"></div>
        <span className="text-slate-400 text-sm">Loading dashboard...</span>
      </div>
    </div>
  );

  return (
    <div>
      {/* HEADER SECTION */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
            {greeting}, {profile?.name?.split(" ")[0] ?? "Ian"}
          </h1>
          <p className="text-sm text-slate-400">Key numbers for today. Details live under Analytics.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/analytics"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg text-sm"
          >
            Analytics
          </Link>
          <Link
            to="/admin/schedule"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg flex items-center gap-1.5 text-sm"
          >
            <span className="material-symbols-outlined text-base">calendar_today</span>
            Schedule
          </Link>
          <Link
            to="/admin/new-booking"
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg shadow-lg cyan-glow flex items-center gap-1.5 text-sm"
          >
            <span className="material-symbols-outlined text-base">add_circle</span>
            New booking
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <PosStatTile
          icon="book_online"
          label="Daily Transaction"
          value={String(stats.bookingsToday)}
          sub="Created since midnight"
          accent="cyan"
        />
        <PosStatTile
          icon="payments"
          label="Sales today"
          value={`₱${Number(stats.salesToday || 0).toFixed(2)}`}
          sub="Sum of amount paid on new bookings"
          accent="emerald"
        />
        <PosStatTile
          icon="sports_tennis"
          label="Active Bookings today"
          value={String(stats.activeBookings)}
          sub="Approved bookings dated today"
          accent="violet"
        />
        <PosStatTile
          icon="hourglass_top"
          label="Pending payments"
          value={String(stats.pendingPayments)}
          sub="Awaiting review under Sales → Payments"
          accent="amber"
        />
      </section>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/admin/crm" className="text-cyan-400 font-semibold hover:underline">
          CRM — customers
        </Link>
        <span className="text-slate-600">·</span>
        <Link to="/admin/bookings" className="text-cyan-400 font-semibold hover:underline">
          All bookings
        </Link>
      </div>
    </div>
  );
}