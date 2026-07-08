// src/admin/AdminLayout.jsx
import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { collection, onSnapshot, waitForPendingWrites, query, where, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";
import { useAuth } from "../auth/AuthContext";
import OfflinePreloader from "./OfflinePreloader";
import RanawLogo from "../components/RanawLogo";
import { sendBookingSMS } from "../lib/smsService";
import ProfileModal from "./ProfileModal";

const NAV_LINKS = [
  { to: "/admin/dashboard", label: "Dashboard" },
  { to: "/admin/schedule", label: "Schedule" },
  { to: "/admin/courts", label: "Courts" },
];

const BOOKING_SUBLINKS = [
  { to: "/admin/bookings", label: "Bookings" },
  { to: "/admin/new-booking", label: "Manual Booking" },
  { to: "/admin/crm", label: "CRM" },
  { to: "/admin/memberships", label: "Memberships" },
];

const TOURNAMENT_SUBLINKS = [
  { to: "/admin/tournament", label: "Tournament bracket" },
  { to: "/admin/tournament-v2", label: "Tournament V2" },
  { to: "/admin/paddle-stack", label: "Paddle stacking" },
];

const NAV_LINKS_AFTER_TOURNAMENT = [
  { to: "/admin/announcements", label: "Announcements" },
  { to: "/admin/analytics", label: "Analytics" },
  { to: "/admin/equipment", label: "Equipment" },
];

export default function AdminLayout() {
  const { profile, role, loading, logout } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const tournamentRef = useRef(null);
  const bookingRef = useRef(null);
  const notifRef = useRef(null);
  const notifFirstSnapshot = useRef(true);
  const notifOpenRef = useRef(false);
  const bookingStatusByIdRef = useRef(new Map());
  const navigate = useNavigate();
  const location = useLocation();

  const [pendingBookingCount, setPendingBookingCount] = useState(0);
  const [unseenBookingCount, setUnseenBookingCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [equipmentWarningCount, setEquipmentWarningCount] = useState(0);
  const [bookingWarningCount, setBookingWarningCount] = useState(0);

  // --- OFFLINE SUPPORT STATE ---
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [hasPendingSync, setHasPendingSync] = useState(false);

  // Monitor real-time connection status and handle pending sync queue
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setHasPendingSync(true); // Internet reconnected, checking queue
      try {
        // Wait until all offline queued writes are synced to Firebase
        await waitForPendingWrites(db);
      } catch (err) {
        console.error("Offline sync error:", err);
      }
      setHasPendingSync(false); // Queue cleared
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  // -----------------------------

  const tournamentNavActive = TOURNAMENT_SUBLINKS.some((s) => location.pathname === s.to);
  const bookingNavActive = BOOKING_SUBLINKS.some((s) => location.pathname === s.to);

  useEffect(() => {
    setTournamentOpen(false);
    setBookingOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    function onKey(e) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    notifOpenRef.current = notifOpen;
  }, [notifOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (tournamentRef.current && !tournamentRef.current.contains(e.target)) {
        setTournamentOpen(false);
      }
      if (bookingRef.current && !bookingRef.current.contains(e.target)) {
        setBookingOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /** Pending court bookings — badge + toast when a new submission arrives */
  useEffect(() => {
    if (loading || role !== "admin") {
      setPendingBookingCount(0);
      setUnseenBookingCount(0);
      setBookingWarningCount(0);
      notifFirstSnapshot.current = true;
      bookingStatusByIdRef.current = new Map();
      return undefined;
    }
    const q = collection(db, "bookings");
    let activeBookingsForWarning = [];

    const checkBookingAlerts = () => {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-");
      
      const nowMs = now.getTime();
      let warnings = 0;
      
      for (const b of activeBookingsForWarning) {
        if (b.acknowledgedTimeEnd) continue;
        if (b.date !== todayStr) continue;
        
        const timeStr = String(b.timeSlot || "").trim();
        let startMins = 0;
        const match12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
        if (match12) {
          let hh = parseInt(match12[1], 10) % 12;
          const mm = parseInt(match12[2], 10);
          if (match12[3].toUpperCase() === "PM") hh += 12;
          startMins = hh * 60 + mm;
        } else {
          const match24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
          if (match24) {
            startMins = parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
          }
        }
        
        if (startMins === 0) continue;
        
        const duration = Number(b.duration) || 1;
        const endMins = startMins + duration * 60;
        
        const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(endMins / 60), endMins % 60, 0);
        const expMs = endDate.getTime();
        
        const minsLeft = (expMs - nowMs) / 60000;
        const isNearDue5 = minsLeft <= 5 && minsLeft >= -30; // Shows 5 mins before until 30 mins after
        
        if (isNearDue5) {
          warnings++;
        }
      }
      setBookingWarningCount(warnings);
    };

    const intervalId = setInterval(checkBookingAlerts, 60000);

    const unsub = onSnapshot(
      q,
      (snap) => {
        const nextMap = bookingStatusByIdRef.current;
        const normalizeStatus = (x) => String(x || "").trim().toLowerCase();
        const isPending = (x) => normalizeStatus(x) === "pending";

        activeBookingsForWarning = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(b => {
             const st = normalizeStatus(b.status);
             return st === "approved" || st === "ongoing";
          });

        checkBookingAlerts();

        const nextPendingCount = snap.docs.reduce(
          (sum, d) => (isPending(d.data()?.status) ? sum + 1 : sum),
          0
        );
        setPendingBookingCount(nextPendingCount);

        if (notifFirstSnapshot.current) {
          snap.docs.forEach((d) => nextMap.set(d.id, normalizeStatus(d.data()?.status)));
          notifFirstSnapshot.current = false;
          return;
        }
        snap.docChanges().forEach((change) => {
          const id = change.doc.id;
          const data = change.doc.data();
          const nextStatus = normalizeStatus(data?.status);
          const prevStatus = nextMap.get(id);
          if (change.type === "removed") {
            nextMap.delete(id);
            return;
          }
          nextMap.set(id, nextStatus);
          if (nextStatus === "pending" && prevStatus !== "pending") {
            const data = change.doc.data();
            const who = data.playerName || data.contactNumber || "Guest";
            const court = data.courtName || data.courtId || "Court";
            if (!notifOpenRef.current) {
              setUnseenBookingCount((n) => n + 1);
            }
            toast.success(`New booking: ${who} — ${court}`, { duration: 6000 });
          }
        });
      },
      (err) => {
        console.error("Booking notifications listener:", err);
        setPendingBookingCount(0);
        setUnseenBookingCount(0);
      }
    );
    return () => {
      unsub();
      clearInterval(intervalId);
    };
  }, [loading, role]);

  /** Active Equipment Tracking & SMS Alerts */
  useEffect(() => {
    if (loading || role !== "admin") {
      setEquipmentWarningCount(0);
      return;
    }
    const q = query(collection(db, "borrowRecords"), where("status", "in", ["active", "rented", "borrowed"]));
    
    let activeBorrows = [];
    const unsub = onSnapshot(q, (snap) => {
      activeBorrows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      checkEquipmentAlerts();
    });

    const checkEquipmentAlerts = async () => {
      const nowMs = Date.now();
      let warnings = 0;

      for (const b of activeBorrows) {
        if (!b.expectedReturnAt) continue;
        const expMs = typeof b.expectedReturnAt.toMillis === "function" 
          ? b.expectedReturnAt.toMillis() 
          : new Date(b.expectedReturnAt).getTime();
        
        const isOverdue = expMs < nowMs;
        const minsLeft = (expMs - nowMs) / 60000;
        const isNearDue = !isOverdue && minsLeft <= 5; // Changed from 30 to 5

        if (isOverdue || isNearDue) {
          warnings++;
        }

        const contact = b.contactNumber?.trim();
        if (contact) {
          // Keep 30 min logic for SMS if desired, or change to 5. We'll change SMS to 5min to match user intent.
          if (isNearDue && !b.warningSmsSent) {
            const msg = `Assalamu alaikum! RANAW PICKLEBALL COURT: Your equipment rental is due in 5 minutes. Please return it on time to avoid overdue charges. Shukran!`;
            b.warningSmsSent = true; 
            sendBookingSMS(b.id, contact, msg);
            updateDoc(doc(db, "borrowRecords", b.id), { warningSmsSent: true }).catch(console.error);
          } else if (isOverdue && !b.overdueSmsSent) {
            const msg = `Assalamu alaikum! RANAW PICKLEBALL COURT: Your equipment rental is now OVERDUE. Please return it immediately. Overdue fines will apply. Shukran!`;
            b.overdueSmsSent = true;
            sendBookingSMS(b.id, contact, msg);
            updateDoc(doc(db, "borrowRecords", b.id), { overdueSmsSent: true }).catch(console.error);
          }
        }
      }
      setEquipmentWarningCount(warnings);
    };

    const intervalId = setInterval(checkEquipmentAlerts, 60000);

    return () => {
      unsub();
      clearInterval(intervalId);
    };
  }, [loading, role]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="min-h-screen bg-[#0a0f18]">
      {/* TOP NAVIGATION — sticky + safe-area; mobile uses hamburger drawer (lg+ shows inline links) */}
      <nav className="sticky top-0 z-[100] bg-[#0a0f18]/95 backdrop-blur-xl border-b border-slate-800 px-3 sm:px-4 py-2.5 sm:py-3 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-2 min-h-[52px] sm:min-h-[56px]">
          <div className="flex items-center gap-2 sm:gap-6 min-w-0 flex-1">
            <button
              type="button"
              className="xl:hidden shrink-0 -ml-1 p-2 rounded-lg text-slate-200 hover:bg-slate-800/80 active:bg-slate-800"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <span className="material-symbols-outlined text-[28px] leading-none">menu</span>
            </button>
            <div className="flex items-center gap-2 group cursor-pointer shrink-0">
              <RanawLogo variant="nav" className="shrink-0" />
            </div>
            <div className="hidden xl:flex items-center xl:gap-3.5 2xl:gap-6 xl:ml-4 2xl:ml-6">
              {NAV_LINKS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-xs font-medium transition-colors ${isActive
                      ? "nav-link-active text-cyan-400"
                      : "nav-link text-slate-400 hover:text-cyan-400"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              <div className="relative" ref={bookingRef}>
                <button
                  type="button"
                  className={`text-xs font-medium transition-colors flex items-center gap-0.5 ${bookingNavActive || bookingOpen
                    ? "nav-link-active text-cyan-400"
                    : "nav-link text-slate-400 hover:text-cyan-400"
                    }`}
                  onClick={() => {
                    setTournamentOpen(false);
                    setBookingOpen((o) => !o);
                  }}
                  aria-expanded={bookingOpen}
                  aria-haspopup="true"
                >
                  <div className="flex items-center gap-1.5">
                    Booking
                    {bookingWarningCount > 0 && (
                      <span className="inline-flex w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                    )}
                  </div>
                  <span className="material-symbols-outlined text-[18px] leading-none">
                    {bookingOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>
                {bookingOpen && (
                  <div className="absolute left-0 top-full mt-1 py-1 min-w-[200px] rounded-lg border border-slate-700 bg-[#151e2d] shadow-xl z-[60]">
                    {BOOKING_SUBLINKS.map((s) => (
                      <NavLink
                        key={s.to}
                        to={s.to}
                        className={({ isActive }) =>
                          `block px-4 py-2.5 text-xs font-medium transition-colors ${isActive
                            ? "bg-slate-800/80 text-cyan-400"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                          }`
                        }
                        onClick={() => setBookingOpen(false)}
                      >
                        {s.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={tournamentRef}>
                <button
                  type="button"
                  className={`text-xs font-medium transition-colors flex items-center gap-0.5 ${tournamentNavActive || tournamentOpen
                    ? "nav-link-active text-cyan-400"
                    : "nav-link text-slate-400 hover:text-cyan-400"
                    }`}
                  onClick={() => {
                    setBookingOpen(false);
                    setTournamentOpen((o) => !o);
                  }}
                  aria-expanded={tournamentOpen}
                  aria-haspopup="true"
                >
                  Tournament
                  <span className="material-symbols-outlined text-[18px] leading-none">
                    {tournamentOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>
                {tournamentOpen && (
                  <div className="absolute left-0 top-full mt-1 py-1 min-w-[220px] rounded-lg border border-slate-700 bg-[#151e2d] shadow-xl z-[60]">
                    {TOURNAMENT_SUBLINKS.map((s) => (
                      <NavLink
                        key={s.to}
                        to={s.to}
                        className={({ isActive }) =>
                          `block px-4 py-2.5 text-xs font-medium transition-colors ${isActive
                            ? "bg-slate-800/80 text-cyan-400"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                          }`
                        }
                        onClick={() => setTournamentOpen(false)}
                      >
                        {s.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
              {NAV_LINKS_AFTER_TOURNAMENT.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-xs font-medium transition-colors ${isActive
                      ? "nav-link-active text-cyan-400"
                      : "nav-link text-slate-400 hover:text-cyan-400"
                    }`
                  }
                >
                  {item.label}
                  {item.to === "/admin/equipment" && equipmentWarningCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                  )}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* OFFLINE STATUS INDICATOR */}
            <div className="hidden xl:flex items-center border-r border-slate-800 pr-4 xl:pr-6">
              {!isOnline ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold" title="Changes will sync automatically">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                  Offline Mode
                </span>
              ) : hasPendingSync ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold">
                  <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
                  Pending Sync Queue
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  Online
                </span>
              )}
            </div>
            <div className="hidden md:flex flex-col items-end border-r border-slate-800 pr-4 xl:pr-6">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Current Date</span>
              <span className="text-sm font-semibold text-slate-300 whitespace-nowrap">{currentDate}</span>
            </div>
            <div className="flex md:hidden flex-col items-end max-w-[28vw] min-w-0 pr-1 border-r border-slate-800/80">
              <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wide">Today</span>
              <span className="text-[10px] font-semibold text-slate-300 truncate">
                {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <div className="flex items-center gap-1 sm:gap-3">
              <div className="relative shrink-0" ref={notifRef}>
                <button
                  type="button"
                  className="relative p-2 text-slate-400 hover:text-cyan-400 transition-colors"
                  aria-label={`Notifications${pendingBookingCount ? `, ${pendingBookingCount} pending bookings` : ""}`}
                  aria-expanded={notifOpen}
                  onClick={() => {
                    setNotifOpen((o) => {
                      const next = !o;
                      if (next) setUnseenBookingCount(0);
                      return next;
                    });
                  }}
                >
                  <span className="material-symbols-outlined text-[22px] sm:text-[24px]">notifications</span>
                  {unseenBookingCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-slate-950 shadow">
                      {unseenBookingCount > 99 ? "99+" : unseenBookingCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[min(calc(100vw-2rem),280px)] rounded-xl border border-slate-700 bg-[#151e2d] shadow-xl z-[130] py-3 px-3 text-left">
                    <p className="text-xs font-semibold text-white mb-1">Bookings</p>
                    <p className="text-[11px] text-slate-400 mb-3">
                      {pendingBookingCount === 0
                        ? "No pending approvals."
                        : `${pendingBookingCount} booking${pendingBookingCount === 1 ? "" : "s"} awaiting approval.`}
                    </p>
                    <NavLink
                      to="/admin/bookings"
                      className="block text-center rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-xs font-semibold py-2 hover:bg-cyan-500/25 transition-colors"
                      onClick={() => setNotifOpen(false)}
                    >
                      Open booking management
                    </NavLink>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-4 border-l border-slate-800 relative min-w-0">
                <div
                  className="flex flex-col items-end cursor-pointer min-w-0 max-w-[120px] sm:max-w-none"
                  onClick={() => setShowLogout((p) => !p)}
                  onKeyDown={(e) => e.key === "Enter" && setShowLogout((p) => !p)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="text-[11px] sm:text-xs font-bold text-white truncate w-full text-right">
                    {profile?.name ?? "Administrator"}
                  </span>
                  <span className="hidden sm:inline text-[8px] sm:text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                    Administrator
                  </span>
                </div>
                <div className="w-8 h-8 shrink-0 rounded-full border-2 border-slate-800 overflow-hidden">
                  <img
                    alt="Admin Avatar"
                    className="w-full h-full object-cover"
                    src={profile?.avatar || "https://lh3.googleusercontent.com/aida-public/AB6AXuCN2G52zKcQynqcDn68fQ0l2-2R_sUyjlQmzSidfD1KEUB5swEGfwLzkKOhJP0mC1tzXR0Q57ZOkSgT_e1p3tDFFFZsXgBqsH4EwxfR4F9FNKK_rBUJpYot5FbVS4pZ2FuLqMjGGvEMVOABhj0FGFzZo0v8g1cPPe2qmc9bkGd_od-WQD_OFNhw_3OIxnlcDQht8cuEyYEKPT1tSon0qRPzTiGEMegm0S1-eUm1r0P3w3-wLo0lnv4f9z0itnBiUGdB9HebRcIrMwg"}
                  />
                </div>
                {showLogout && (
                  <div className="absolute top-full right-0 mt-2 bg-[#151e2d] border border-slate-800 rounded-xl p-2 shadow-lg z-[150]">
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                      onClick={() => { setShowLogout(false); setShowProfile(true); }}
                    >
                      My Profile
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                      onClick={handleLogout}
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile / small-tablet navigation drawer */}
      {mobileMenuOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[110] bg-black/60 xl:hidden"
            aria-label="Close menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className="fixed top-0 left-0 bottom-0 z-[120] w-[min(88vw,300px)] bg-[#151e2d] border-r border-slate-700 shadow-2xl flex flex-col xl:hidden pt-[env(safe-area-inset-top)]"
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-700 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <RanawLogo variant="navCompact" className="shrink-0" />
                <p className="text-[10px] text-slate-400">{currentDate}</p>
              </div>
              <button
                type="button"
                className="p-2 rounded-lg text-slate-300 hover:bg-slate-800 shrink-0"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
              >
                <span className="material-symbols-outlined text-[26px]">close</span>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 pb-[env(safe-area-inset-bottom)]">
              <p className="px-2 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Menu</p>
              <ul className="space-y-0.5">
                {NAV_LINKS.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-3 text-sm font-medium ${isActive ? "bg-slate-800 text-cyan-400" : "text-slate-200 hover:bg-slate-800/80"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-4 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Booking</p>
              <ul className="space-y-0.5">
                {BOOKING_SUBLINKS.map((s) => (
                  <li key={s.to}>
                    <NavLink
                      to={s.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-3 text-sm font-medium ${isActive ? "bg-slate-800 text-cyan-400" : "text-slate-200 hover:bg-slate-800/80"
                        }`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {s.label}
                        {bookingWarningCount > 0 && s.to === "/admin/bookings" && (
                          <span className="inline-flex items-center justify-center w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                        )}
                      </div>
                    </NavLink>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-4 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tournament</p>
              <ul className="space-y-0.5">
                {TOURNAMENT_SUBLINKS.map((s) => (
                  <li key={s.to}>
                    <NavLink
                      to={s.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-3 text-sm font-medium ${isActive ? "bg-slate-800 text-cyan-400" : "text-slate-200 hover:bg-slate-800/80"
                        }`
                      }
                    >
                      {s.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <p className="px-2 pt-4 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">More</p>
              <ul className="space-y-0.5">
                {NAV_LINKS_AFTER_TOURNAMENT.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `block rounded-lg px-3 py-3 text-sm font-medium ${isActive ? "bg-slate-800 text-cyan-400" : "text-slate-200 hover:bg-slate-800/80"
                        }`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {item.label}
                        {item.to === "/admin/equipment" && equipmentWarningCount > 0 && (
                          <span className="inline-flex items-center justify-center w-2 h-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                        )}
                      </div>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </>
      )}

      {/* MAIN CONTENT */}
      <OfflinePreloader />
      <main className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-10 overflow-x-hidden">
        <Outlet />
      </main>

      {/* FOOTER */}
      <footer className="max-w-[1600px] mx-auto p-4 sm:p-6 mt-8 sm:mt-12 border-t border-slate-800 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500 text-xs font-medium text-center md:text-left">
        <div>© 2026 RANAW PICKLEBALL COURT. All rights reserved.</div>
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="hover:text-white transition-colors bg-transparent border-0 p-0 cursor-pointer font-inherit text-inherit"
          >
            Privacy Policy
          </button>
          <button
            type="button"
            className="hover:text-white transition-colors bg-transparent border-0 p-0 cursor-pointer font-inherit text-inherit"
          >
            Terms of Service
          </button>
          <button
            type="button"
            className="hover:text-white transition-colors bg-transparent border-0 p-0 cursor-pointer font-inherit text-inherit"
          >
            Support Center
          </button>
        </div>
      </footer>

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}