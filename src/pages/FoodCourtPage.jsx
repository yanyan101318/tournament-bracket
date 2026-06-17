import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../auth/AuthContext";
import FoodCourtMarketplace from "../marketplace/FoodCourtMarketplace";
import { subscribeFoodCourtConfig } from "../services/marketplace/foodCourtConfigService";
import { findActiveBookingForCourt } from "../lib/bookingSession";
import "../marketplace/marketplace.css";
import RanawLogo from "../components/RanawLogo";

export default function FoodCourtPage() {
  const { user, profile } = useAuth();
  const [searchParams] = useSearchParams();
  const courtId =
    searchParams.get("courtId") ||
    searchParams.get("courtID") ||
    searchParams.get("courtid") ||
    searchParams.get("court") ||
    searchParams.get("court_id") ||
    searchParams.get("id");
  const courtName =
    searchParams.get("courtName") ||
    searchParams.get("courtname") ||
    searchParams.get("court_name");
  const [config, setConfig] = useState({ title: "RANAW Food Court", subtitle: "" });
  const [booking, setBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(Boolean(courtId || courtName));
  const [bookingLoadError, setBookingLoadError] = useState(null);

  useEffect(() => {
    document.title = "RANAW Food Court | Order";
    const unsub = subscribeFoodCourtConfig(setConfig);
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!courtId && !courtName) {
      setBooking(null);
      setLoadingBooking(false);
      setBookingLoadError(null);
      return undefined;
    }

    setLoadingBooking(true);
    setBookingLoadError(null);

    const merged = new Map();
    let courtLabel = courtName || "";
    let unsubById = () => {};
    let unsubByName = () => {};
    let cancelled = false;

    const applyBookings = () => {
      const activeBooking = findActiveBookingForCourt(
        Array.from(merged.values()),
        courtId,
        new Date(),
        courtLabel
      );
      setBooking(activeBooking);
      setLoadingBooking(false);
    };

    const onBookingsSnap = (snap) => {
      snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));
      applyBookings();
    };

    const onBookingsErr = (err) => {
      console.error("Error loading court session:", err);
      setBooking(null);
      setBookingLoadError(err?.code === "permission-denied" ? "permission" : "unknown");
      setLoadingBooking(false);
    };

    (async () => {
      if (courtId) {
        try {
          const courtSnap = await getDoc(doc(db, "courts", courtId));
          if (cancelled) return;
          if (courtSnap.exists()) {
            courtLabel = courtSnap.data().name || courtLabel;
          }
        } catch (err) {
          console.warn("Unable to load court metadata:", err);
        }
      }

      if (cancelled) return;

      if (courtId) {
        unsubById = onSnapshot(
          query(collection(db, "bookings"), where("courtId", "==", courtId)),
          onBookingsSnap,
          onBookingsErr
        );
      }

      if (courtName || courtLabel) {
        const nameQuery = courtName || courtLabel;
        unsubByName = onSnapshot(
          query(collection(db, "bookings"), where("courtName", "==", nameQuery)),
          onBookingsSnap,
          (err) => console.warn("bookings by courtName:", err)
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubById();
      unsubByName();
    };
  }, [courtId, courtName]);

  if ((courtId || courtName) && loadingBooking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if ((courtId || courtName) && !loadingBooking && !booking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
        <div className="w-16 h-16 bg-red-500/20 border-2 border-red-500 rounded-full flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-red-400 text-3xl">error</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">No active booking found</h1>
        <p className="text-slate-400 max-w-sm">
          There is no active booking for this court right now. Scan the QR again during a reserved booking day, or order from the food court directly.
        </p>
        <Link
          to="/foodcourt"
          className="mt-6 px-6 py-3 bg-cyan-500 text-slate-950 font-bold rounded-xl"
        >
          Open food court menu
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="sticky top-0 z-20 bg-slate-900/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <RanawLogo variant="navCompact" className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{config.title || "Food Court"}</h1>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {config.subtitle || "Order from every stall in one place"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
          
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4">
        <FoodCourtMarketplace user={user} profile={profile} booking={booking} />
      </main>
    </div>
  );
}
