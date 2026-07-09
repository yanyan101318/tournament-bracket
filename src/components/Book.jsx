import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { db } from "../firebase";
import "./book.css";
import {
  collection,
  doc,
  setDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  onSnapshot,
  limit,
} from "firebase/firestore";
import { Link } from "react-router-dom";
import {
  Calendar, Clock, Users, ChevronRight, Check, Upload,
  Smartphone, AlertCircle, Package, User, FileText, X, Banknote,
} from "lucide-react";
import toast from "react-hot-toast";
import { format, addDays } from "date-fns";
import { roundMoney, parseCashAmount, parseAmountPaid } from "../lib/bookingMoney";
import { TIME_SLOTS, isSlotStartAvailableForDuration, calculateEndTime, isSlotWithinCourtHours, getEffectiveCourtStatus, isCourtActiveDuringSlot } from "../lib/bookingSlots";
import {
  PLAN_FULL,
  PLAN_PARTIAL,
  PLAN_LATER,
  resolveAmountPaid,
  resolveRemaining,
  resolveCustomerPayStatus,
} from "../lib/bookingPayment";
import { upsertCustomerAfterBooking } from "../lib/crm";
import BookingReceipt from "./BookingReceipt";
import ReceiptPrint from "./ReceiptPrint";
import RanawLogo from "./RanawLogo";
import { sendBookingSMS } from "../lib/smsService";

function isSlotInPast(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const parts = timeStr.split(' ');
  if (parts.length !== 2) return false;
  const time = parts[0];
  const modifier = parts[1];
  let [hours, minutes] = time.split(':');
  if (hours === '12') hours = '00';
  if (modifier === 'PM' || modifier === 'pm') hours = parseInt(hours, 10) + 12;
  const hh = parseInt(hours, 10);
  const mm = parseInt(minutes, 10);

  const [yy, M, d] = dateStr.split('-');
  const slotDate = new Date(parseInt(yy, 10), parseInt(M, 10) - 1, parseInt(d, 10), hh, mm, 0);

  // Treat the slot as past only after 1 hour has elapsed
  const endOfSlot = new Date(slotDate.getTime() + 60 * 60 * 1000);
  return endOfSlot < new Date();
}

function format24to12(time24) {
  if (!time24) return "";
  let [hh, mm] = time24.split(":");
  hh = parseInt(hh, 10);
  const ap = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const hhStr = String(hh).padStart(2, "0");
  return `${hhStr}:${mm} ${ap}`;
}

function deriveCourtKind(c) {
  const joined = (c.amenities || [])
    .map((x) => String(x).toLowerCase())
    .join(" ");
  if (joined.includes("indoor")) return "Indoor";
  if (joined.includes("outdoor")) return "Outdoor";
  return "Court";
}

const DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3, "Custom"];

const PROMOS = [
  { code: "PICKLE10", discount: 0.1, label: "10% off" },
  { code: "NEWUSER", discount: 0.15, label: "15% off for new users" },
  { code: "MEMBER20", discount: 0.2, label: "20% member discount" },
];

const PAYMENT_PNB = "pnb";
const PAYMENT_CASH = "cash";

export default function Book() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const adminMode = location.pathname.startsWith("/admin/");
  const [searchParams] = useSearchParams();
  const courtParam =
    searchParams.get("court") ||
    searchParams.get("courtId") ||
    searchParams.get("courtID") ||
    searchParams.get("courtid") ||
    searchParams.get("court_id") ||
    searchParams.get("id");
  const fileInputRef = useRef();

  /** Rental add-ons: prefer `price`, fall back to legacy inventory `pricePerHour`. */
  function getRentalItemPrice(item) {
    const p = item?.price;
    if (p != null && Number.isFinite(Number(p))) return Number(p);
    return Number(item?.pricePerHour) || 0;
  }

  const [courts, setCourts] = useState([]);
  const [courtsReady, setCourtsReady] = useState(false);
  const [step, setStep] = useState(1);
  /** Same court + day: { id, timeSlot, duration, status } for overlap checks */
  const [dayBookings, setDayBookings] = useState([]);
  const [rentalAddOns, setRentalAddOns] = useState([]);
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [nameSuggestOpen, setNameSuggestOpen] = useState(false);
  const [debouncedPlayerName, setDebouncedPlayerName] = useState("");
  const nameSuggestRef = useRef(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [paymentImg, setPaymentImg] = useState(null);
  const [paymentImgUrl, setPaymentImgUrl] = useState("");
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [amountPaidInput, setAmountPaidInput] = useState("");
  const [receiptSnapshot, setReceiptSnapshot] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const { syncState, wrapSync, setSyncState } = useOfflineSync();
  const { markDirty, markClean } = useUnsavedChanges();

  const [form, setForm] = useState({
    courtIds: courtParam ? [courtParam] : [],
    date: format(addDays(new Date(), 1), "yyyy-MM-dd"),
    timeSlot: "",
    customStartTime: "",
    isCustomTime: false,
    duration: 1,
    customDuration: "",
    customEndTime: "",
    players: 2,
    equipment: [],
    notes: "",
    playerName: "",
    contactNumber: "",
    email: "",
    paymentMethod: PAYMENT_PNB,
    paymentPlan: PLAN_FULL,
    bookingMode: "one-time",
    recurrenceEnd: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    recurringDays: [new Date(addDays(new Date(), 1)).getDay()],
    repeatDurationValue: 1,
    repeatDurationUnit: "months"
  });

  const [sessionPreviewList, setSessionPreviewList] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const actualTimeSlot = form.isCustomTime ? format24to12(form.customStartTime) : form.timeSlot;

  const actualDuration = useMemo(() => {
    if (form.duration !== "Custom") return form.duration;
    if (form.customEndTime && actualTimeSlot) {
      const parseTimeToMs = (timeStr) => {
        if (!timeStr) return 0;
        const parts = timeStr.match(/(\d+):(\d+)\s+(AM|PM)/i);
        if (parts) {
          let h = parseInt(parts[1], 10);
          let m = parseInt(parts[2], 10);
          if (h === 12) h = 0;
          if (parts[3].toUpperCase() === "PM") h += 12;
          return h * 60 + m;
        }
        const p = timeStr.split(":");
        if (p.length === 2) {
          return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
        }
        return 0;
      };
      const startMs = parseTimeToMs(actualTimeSlot);
      const endMs = parseTimeToMs(form.customEndTime);
      let diff = endMs - startMs;
      if (diff < 0) diff += 24 * 60;
      return diff / 60;
    }
    return Number(form.customDuration) || 1;
  }, [form.duration, form.customDuration, form.customEndTime, actualTimeSlot]);

  const calculatedEndTime = (actualTimeSlot && actualDuration > 0) ? calculateEndTime(actualTimeSlot, actualDuration) : "";

  const activeCourts = useMemo(
    () => courts.filter((c) => getEffectiveCourtStatus(c)),
    [courts]
  );

  const selectedCourtsList = useMemo(() => {
    return form.courtIds.map((id) => {
      const raw = activeCourts.find((c) => c.id === id);
      if (!raw) return null;
      return {
        id: raw.id,
        name: raw.name || "Court",
        price: Number(raw.pricePerHour) || 0,
        type: deriveCourtKind(raw),
        activeStartTime: raw.activeStartTime,
        activeEndTime: raw.activeEndTime,
        rawCourt: raw,
      };
    }).filter(Boolean);
  }, [activeCourts, form.courtIds]);

  const court = selectedCourtsList.length > 0 ? selectedCourtsList[0] : null;

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "courts"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setCourts(list);
        setCourtsReady(true);
      },
      () => setCourtsReady(true)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (activeCourts.length === 0) return;
    const bookableCourts = activeCourts;
    if (bookableCourts.length === 0) return;
    setForm((f) => {
      if (courtParam && bookableCourts.some((c) => c.id === courtParam)) {
        if (f.courtIds.includes(courtParam)) return f;
        return { ...f, courtIds: [courtParam], timeSlot: "" };
      }
      if (f.courtIds.length > 0 && bookableCourts.some((c) => f.courtIds.includes(c.id))) return f;
      return { ...f, courtIds: [bookableCourts[0].id], timeSlot: "" };
    });
  }, [activeCourts, courtParam]);

  const [tournaments, setTournaments] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "tournamentsV2"), (snap) => {
      setTournaments(snap.docs.map(d => d.data()));
    });
    return () => unsub();
  }, []);

  const isTournamentDay = useMemo(() => {
    if (!form.date) return false;
    return tournaments.some(t => {
      if (!t.date || t.status === 'completed') return false;
      return t.date.startsWith(form.date);
    });
  }, [tournaments, form.date]);

  const loadDayBookings = useCallback(async () => {
    if (form.courtIds.length === 0) return;
    try {
      const q = query(
        collection(db, "bookings"),
        where("date", "==", form.date),
        where("status", "in", ["pending", "approved", "Pending", "Approved"])
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          courtId: data.courtId,
          timeSlot: data.timeSlot,
          startTime: data.startTime || data.timeSlot,
          duration: Number(data.duration) || 1,
          status: data.status,
        };
      }).filter(b => form.courtIds.includes(b.courtId));
      setDayBookings(list);
    } catch {
      setDayBookings([]);
    }
  }, [form.courtIds, form.date]);

  useEffect(() => {
    if (!user) {
      if (!adminMode) navigate("/login");
      return;
    }
    if (form.courtIds.length === 0) return;
    loadDayBookings();
  }, [form.courtIds, form.date, user, adminMode, navigate, loadDayBookings]);

  /**
   * Real-time add-ons from `inventoryItems`.
   * - If `type` is present, only accept `type: "rental"`.
   * - Legacy items without `type` are treated as rental add-ons when they have a price.
   */
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "inventoryItems"),
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setRentalAddOns(
          all.filter((it) => {
            const t = String(it.type ?? "").trim().toLowerCase();
            if (t === "sale") return false;

            const hasPricePerHour = it.pricePerHour != null && it.pricePerHour !== "" && Number.isFinite(Number(it.pricePerHour));
            const hasLegacyPrice = it.price != null && it.price !== "" && Number.isFinite(Number(it.price));
            const isRentItem = t === "rental" || t === "rent" || t === "both" || hasPricePerHour || hasLegacyPrice;

            if (!isRentItem) return false;

            const availableQty = Number(it.availableQty);
            const hasStock = !Number.isFinite(availableQty) || availableQty > 0;
            return hasStock;
          })
        );
      },
      () => setRentalAddOns([])
    );
    return () => unsub();
  }, []);

  /** Debounce player name for Firestore prefix search (admin autocomplete). */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPlayerName(String(form.playerName || "")), 300);
    return () => clearTimeout(t);
  }, [form.playerName]);

  /** Firestore: customers by fullName + bookings by playerName, merged and deduped. */
  useEffect(() => {
    if (!adminMode) {
      setNameSuggestions([]);
      return;
    }
    const q = debouncedPlayerName.trim();
    if (q.length < 1) {
      setNameSuggestions([]);
      return;
    }
    let cancelled = false;
    const end = q + "\uf8ff";
    (async () => {
      try {
        const [cSnap, bSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "customers"),
              where("fullName", ">=", q),
              where("fullName", "<=", end),
              limit(8)
            )
          ),
          getDocs(
            query(
              collection(db, "bookings"),
              where("playerName", ">=", q),
              where("playerName", "<=", end),
              limit(8)
            )
          ),
        ]);
        if (cancelled) return;
        const map = new Map();
        cSnap.forEach((docSnap) => {
          const n = String(docSnap.data().fullName || "").trim();
          if (n) map.set(n.toLowerCase(), n);
        });
        bSnap.forEach((docSnap) => {
          const n = String(docSnap.data().playerName || "").trim();
          if (n) map.set(n.toLowerCase(), n);
        });
        setNameSuggestions([...map.values()].sort((a, b) => a.localeCompare(b)));
      } catch (e) {
        console.error(e);
        if (!cancelled) setNameSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminMode, debouncedPlayerName]);

  useEffect(() => {
    if (adminMode) return;
    if (profile?.name) setForm((f) => ({ ...f, playerName: profile.name }));
  }, [profile, adminMode]);

  /**
   * When duration changes or we load overlapping bookings from Firestore, clear an
   * impossible start time.
   */
  useEffect(() => {
    setForm((f) => {
      const actualD = f.duration === "Custom" ? Number(f.customDuration) || 1 : f.duration;
      if (f.isCustomTime) {
        if (!f.customStartTime) return f;
        const time12 = format24to12(f.customStartTime);
        if (isSlotStartAvailableForDuration(time12, actualD, dayBookings) && isSlotWithinCourtHours(time12, actualD, court) && isCourtActiveDuringSlot(court?.rawCourt, form.date, time12, actualD)) return f;
        return { ...f, customStartTime: "" };
      } else {
        if (!f.timeSlot) return f;
        if (isSlotStartAvailableForDuration(f.timeSlot, actualD, dayBookings) && isSlotWithinCourtHours(f.timeSlot, actualD, court) && isCourtActiveDuringSlot(court?.rawCourt, form.date, f.timeSlot, actualD)) return f;
        return { ...f, timeSlot: "" };
      }
    });
  }, [form.duration, form.customDuration, form.isCustomTime, dayBookings, form.date, court]);

  /** Track Dirty State */
  useEffect(() => {
    // The user requested that the page is ALWAYS protected from exit, 
    // even if nothing has been typed yet.
    markDirty();
  }, [markDirty]);

  /** Drop invalid add-on ids once we know the rental list (avoids clearing selection before snapshot). */
  useEffect(() => {
    if (rentalAddOns.length === 0) return;
    const ids = new Set(rentalAddOns.map((r) => r.id));
    setForm((f) => {
      const next = f.equipment.filter((id) => ids.has(id));
      if (next.length === f.equipment.length) return f;
      return { ...f, equipment: next };
    });
  }, [rentalAddOns]);

  const equipmentItems = useMemo(
    () => rentalAddOns.filter((e) => form.equipment.includes(e.id)),
    [rentalAddOns, form.equipment]
  );
  const sessionCount = useMemo(() => {
    if (form.bookingMode === "one-time") return 1;
    if (sessionPreviewList.length === 0) return 0;
    const validSessions = sessionPreviewList.filter(s => s.isAvailable === true).length;
    if (validSessions > 0) return validSessions;
    if (!actualTimeSlot) return sessionPreviewList.length;
    return 0;
  }, [form.bookingMode, sessionPreviewList, actualTimeSlot]);

  const equipmentTotal = useMemo(
    () => equipmentItems.reduce((s, e) => s + getRentalItemPrice(e), 0) * sessionCount,
    [equipmentItems, sessionCount]
  );
  const courtTotal = selectedCourtsList.reduce((sum, c) => sum + (c.price * actualDuration), 0) * sessionCount;
  const subtotal = courtTotal + equipmentTotal;
  const discount = appliedPromo ? subtotal * appliedPromo.discount : 0;
  const total = subtotal - discount;

  const partialPaidNum = useMemo(
    () => parseAmountPaid(amountPaidInput),
    [amountPaidInput]
  );
  const amountPaidNow = useMemo(
    () => resolveAmountPaid(form.paymentPlan, total, partialPaidNum),
    [form.paymentPlan, total, partialPaidNum]
  );
  const remainingBalance = useMemo(
    () => resolveRemaining(total, amountPaidNow),
    [total, amountPaidNow]
  );
  const customerPaymentStatus = useMemo(
    () => resolveCustomerPayStatus(form.paymentPlan, total, amountPaidNow),
    [form.paymentPlan, total, amountPaidNow]
  );
  const cashDueNow = useMemo(() => {
    if (form.paymentPlan === PLAN_LATER) return 0;
    return roundMoney(amountPaidNow);
  }, [form.paymentPlan, amountPaidNow]);

  const generatedDatesPreview = useMemo(() => {
    if (form.bookingMode === "one-time") return [form.date];
    const dates = [];
    
    // Parse manually to avoid UTC midnight parsing issues in different browsers
    const [sY, sM, sD] = form.date.split("-").map(Number);
    if (!sY || !sM || !sD) return [];
    let current = new Date(sY, sM - 1, sD, 12, 0, 0); // Noon local time
    
    const [eY, eM, eD] = form.recurrenceEnd.split("-").map(Number);
    if (!eY || !eM || !eD) return [];
    const end = new Date(eY, eM - 1, eD, 12, 0, 0); // Noon local time
    
    // Safety limit 365 days
    let iterations = 0;
    while (current <= end && iterations < 365) {
      if (form.recurringDays.includes(current.getDay())) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${d}`);
      }
      current.setDate(current.getDate() + 1);
      iterations++;
    }
    return dates;
  }, [form.date, form.recurrenceEnd, form.recurringDays, form.bookingMode]);

  useEffect(() => {
    if (form.bookingMode !== "recurring" || !adminMode) {
      setSessionPreviewList([]);
      return;
    }
    
    let isSubscribed = true;
    setPreviewLoading(true);

    const checkAvailability = async () => {
      try {
        const dur = actualDuration || 1;
        
        let allBookingsForDates = [];
        if (court && generatedDatesPreview.length > 0) {
           const chunks = [];
           for (let i = 0; i < generatedDatesPreview.length; i += 30) {
               chunks.push(generatedDatesPreview.slice(i, i + 30));
           }
           const bookingsPromises = chunks.map(chunk => {
               const q = query(
                 collection(db, "bookings"),
                 where("courtId", "==", court.id),
                 where("date", "in", chunk)
               );
               return getDocs(q);
           });
           const snapshots = await Promise.all(bookingsPromises);
           snapshots.forEach(snap => {
               snap.docs.forEach(d => {
                 const data = d.data();
                 if (["pending", "approved", "Pending", "Approved"].includes(data.status)) {
                   allBookingsForDates.push({ id: d.id, ...data });
                 }
               });
           });
        }
        
        const preview = generatedDatesPreview.map(dateStr => {
          if (!actualTimeSlot) {
            return { date: dateStr, isAvailable: null, reason: "Select start time" };
          }
          
          const inPast = isSlotInPast(dateStr, actualTimeSlot);
          if (inPast) {
            return { date: dateStr, isAvailable: false, reason: "Past date/time" };
          }
          
          const outOfHours = !isSlotWithinCourtHours(actualTimeSlot, dur, court);
          if (outOfHours) {
            return { date: dateStr, isAvailable: false, reason: "Outside operating hours" };
          }
          
          const dayBookings = allBookingsForDates.filter(b => b.date === dateStr);
          const isTaken = !isSlotStartAvailableForDuration(actualTimeSlot, dur, dayBookings) || !isCourtActiveDuringSlot(court?.rawCourt, dateStr, actualTimeSlot, dur);
          
          if (isTaken) {
             return { date: dateStr, isAvailable: false, reason: "Already booked or inactive" };
          }
          
          return { date: dateStr, isAvailable: true, reason: "" };
        });
        
        if (isSubscribed) {
          setSessionPreviewList(preview);
        }
      } catch (err) {
        console.error("Preview error", err);
      } finally {
        if (isSubscribed) setPreviewLoading(false);
      }
    };

    const timeout = setTimeout(checkAvailability, 300);
    return () => {
      isSubscribed = false;
      clearTimeout(timeout);
    };
  }, [generatedDatesPreview, actualTimeSlot, actualDuration, court, adminMode, form.bookingMode]);
  const cashReceivedNum = useMemo(
    () => parseCashAmount(cashReceivedInput),
    [cashReceivedInput]
  );
  const cashChangeUi = useMemo(() => {
    if (form.paymentMethod !== PAYMENT_CASH || form.paymentPlan === PLAN_LATER) {
      return { text: "—", variant: "muted" };
    }
    const raw = String(cashReceivedInput ?? "").trim();
    if (raw === "") return { text: "—", variant: "muted" };
    if (!Number.isFinite(cashReceivedNum)) return { text: "—", variant: "muted" };
    if (cashReceivedNum < cashDueNow) return { text: "Insufficient", variant: "danger" };
    return { text: `₱${roundMoney(cashReceivedNum - cashDueNow).toFixed(2)}`, variant: "ok" };
  }, [form.paymentMethod, form.paymentPlan, cashReceivedInput, cashReceivedNum, cashDueNow]);

  const toggleEquipment = (id) => {
    setForm((f) => ({
      ...f,
      equipment: f.equipment.includes(id) ? f.equipment.filter((e) => e !== id) : [...f.equipment, id],
    }));
  };

  const applyPromo = () => {
    const promo = PROMOS.find((p) => p.code === promoInput.toUpperCase());
    if (promo) { setAppliedPromo(promo); toast.success(`Promo applied: ${promo.label}`); }
    else toast.error("Invalid promo code");
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File too large (max 5MB)"); return; }
    setPaymentImg(file);
    setPaymentImgUrl(URL.createObjectURL(file));
  };

  const selectPaymentMethod = (method) => {
    setForm((f) => ({ ...f, paymentMethod: method }));
    if (method === PAYMENT_CASH || (method === PAYMENT_PNB && adminMode)) {
      setPaymentImg(null);
      setPaymentImgUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    if (method === PAYMENT_PNB && !adminMode) {
      setCashReceivedInput("");
    }
  };

  const selectPaymentPlan = (plan) => {
    setForm((f) => ({ ...f, paymentPlan: plan }));
    if (plan !== PLAN_PARTIAL) setAmountPaidInput("");
    if (plan === PLAN_LATER) {
      setPaymentImg(null);
      setPaymentImgUrl("");
      setCashReceivedInput("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (selectedCourtsList.length === 0) return toast.error("Please select a court");
    if (selectedCourtsList.some(c => !c.price || c.price <= 0)) {
      return toast.error("One or more selected courts have no hourly rate set. Ask admin to update court pricing.");
    }
    if (!actualTimeSlot) return toast.error("Please select a time slot");
    if (!form.playerName) return toast.error("Player name is required");
    if (!String(form.contactNumber ?? "").trim()) {
      toast.error("Contact number is required");
      return;
    }

    const paidNow = resolveAmountPaid(form.paymentPlan, total, partialPaidNum);
    if (form.paymentPlan === PLAN_PARTIAL) {
      if (!Number.isFinite(partialPaidNum) || partialPaidNum <= 0) {
        toast.error("Enter a valid down payment amount");
        return;
      }
      if (partialPaidNum >= total) {
        toast.error("Down payment must be less than the total");
        return;
      }
    }

    const needPNBProof = form.paymentMethod === PAYMENT_PNB && paidNow > 0 && !adminMode;
    if (needPNBProof && !paymentImg) {
      toast.error("Please upload your PNB receipt");
      return;
    }

    if ((form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) && form.paymentPlan !== PLAN_LATER) {
      const raw = String(cashReceivedInput ?? "").trim();
      if (raw === "") return toast.error(`Please enter ${form.paymentMethod === PAYMENT_CASH ? 'cash' : 'PNB'} received`);
      if (!Number.isFinite(cashReceivedNum)) return toast.error("Enter a valid amount");
      if (cashReceivedNum < cashDueNow) {
        return toast.error("Amount received is less than the amount due now");
      }
    }

    try {
      // Re-check overlaps against latest data so two admins cannot double-book the same range.
      const confSnap = await getDocs(
        query(
          collection(db, "bookings"),
          where("date", "==", form.date),
          where("status", "in", ["pending", "approved", "Pending", "Approved"])
        )
      );
      const latestDay = confSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          courtId: data.courtId,
          timeSlot: data.timeSlot,
          startTime: data.startTime || data.timeSlot,
          duration: Number(data.duration) || 1,
          status: data.status,
        };
      }).filter(b => form.courtIds.includes(b.courtId));
      if (!isSlotStartAvailableForDuration(actualTimeSlot, actualDuration, latestDay)) {
        setDayBookings(latestDay);
        toast.error("That time is no longer available for one or more selected courts.");
        return;
      }

      for (const c of selectedCourtsList) {
        if (!isCourtActiveDuringSlot(c.rawCourt, form.date, actualTimeSlot, actualDuration)) {
          toast.error(`That time is unavailable for ${c.name} due to a scheduled deactivation.`);
          return;
        }
        if (!isSlotWithinCourtHours(actualTimeSlot, actualDuration, c)) {
          toast.error(`The selected time is outside the operating hours for ${c.name} (${c.activeStartTime || "06:00"} - ${c.activeEndTime || "22:00"}).`);
          return;
        }
        if (!getEffectiveCourtStatus(c.rawCourt)) {
          toast.error(`${c.name} is currently unavailable for rent.`);
          return;
        }
      }

      let receiptUrl = null;
      if (needPNBProof && paymentImg) {
        receiptUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error("Could not read receipt file"));
          reader.readAsDataURL(paymentImg);
        });
      }

      const numCourts = selectedCourtsList.length;
      const amountPaidRounded = roundMoney(paidNow);
      const splitTotal = roundMoney(total / numCourts);
      const splitAmountPaidNow = roundMoney(paidNow / numCourts);
      const splitRemaining = resolveRemaining(splitTotal, splitAmountPaidNow);
      const splitDiscount = roundMoney(discount / numCourts);

      const splitCashReceived =
        (form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) && form.paymentPlan !== PLAN_LATER
          ? roundMoney(cashReceivedNum / numCourts)
          : null;
      const splitChange =
        (form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) && form.paymentPlan !== PLAN_LATER
          ? roundMoney((cashReceivedNum - cashDueNow) / numCourts)
          : null;

      const writePromises = [];
      let firstBookingRefId = null;
      let firstBookingData = null;

      for (const c of selectedCourtsList) {
        const payStatus = resolveCustomerPayStatus(form.paymentPlan, splitTotal, splitAmountPaidNow);

        const bookingBase = {
          courtId: c.id,
          courtName: c.name,
          date: form.date,
          timeSlot: actualTimeSlot,
          startTime: actualTimeSlot,
          endTime: calculatedEndTime,
          duration: actualDuration,
          players: form.players,
          equipment: form.equipment,
          notes: form.notes,
          playerName: form.playerName,
          contactNumber: String(form.contactNumber).trim(),
          email: String(form.email ?? "").trim() || null,
          userId: user.uid,
          status: (form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) ? "Approved" : "Pending",
          createdAt: serverTimestamp(),
          promoCode: appliedPromo?.code || null,
          paymentMethod: form.paymentMethod,
          paymentPlan: form.paymentPlan,
          hourlyRate: roundMoney(c.price),
          totalAmount: splitTotal,
          amountPaid: splitAmountPaidNow,
          remainingBalance: splitRemaining,
          customerPaymentStatus: payStatus,
        };

        const bookingData =
          form.paymentMethod === PAYMENT_PNB && !adminMode
            ? { ...bookingBase, receiptUrl: receiptUrl || null }
            : {
              ...bookingBase,
              receiptUrl: null,
              cashReceived: splitCashReceived,
              change: splitChange,
            };

        const bookingRef = doc(collection(db, "bookings"));
        if (!firstBookingRefId) {
          firstBookingRefId = bookingRef.id;
          firstBookingData = bookingData;
        }
        const paymentRef = doc(collection(db, "payments"));

        const paymentBase = {
          bookingId: bookingRef.id,
          userId: user.uid,
          name: form.playerName,
          courtId: c.id,
          courtName: c.name,
          date: form.date,
          timeSlot: actualTimeSlot,
          startTime: actualTimeSlot,
          endTime: calculatedEndTime,
          amount: splitTotal,
          totalAmount: splitTotal,
          amountPaid: splitAmountPaidNow,
          remainingBalance: splitRemaining,
          paymentPlan: form.paymentPlan,
          customerPaymentStatus: payStatus,
          method: form.paymentMethod,
          paymentStatus: (form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) ? "Approved" : "Pending",
          promoCode: appliedPromo?.code || null,
          discount: splitDiscount,
          createdAt: serverTimestamp(),
        };

        const paymentData =
          form.paymentMethod === PAYMENT_PNB && !adminMode
            ? { ...paymentBase, paymentImageUrl: receiptUrl || null }
            : {
              ...paymentBase,
              paymentImageUrl: null,
              cashReceived: splitCashReceived,
              change: splitChange,
            };

        writePromises.push(setDoc(bookingRef, bookingData));
        writePromises.push(setDoc(paymentRef, paymentData));
      }

      writePromises.push(
        upsertCustomerAfterBooking(db, {
          userId: user.uid,
          fullName: form.playerName,
          contactNumber: String(form.contactNumber).trim(),
          email: String(form.email ?? "").trim() || null,
          amountApplied: amountPaidRounded, // total amount paid across all courts
        })
      );

      const writePromiseAll = Promise.all(writePromises);

      await wrapSync(writePromiseAll, {
        successMsg: "RANAW PICKLEBALL COURT booking confirmed successfully",
        offlineMsg: "Saved Offline — Will Sync Automatically",
        errorMsg: "Booking Failed — Retry",
        onSuccess: () => {
          markClean();
          setStep(4);
        },
        onOfflineSuccess: () => {
          markClean();
          setTimeout(() => setStep(4), 1000);
        }
      });

      if (adminMode && String(form.contactNumber).trim()) {
        const smsMsg = `Assalamu alaikum! RANAW PICKLEBALL COURT: Your booking has been confirmed for ${form.date} at ${actualTimeSlot}. Courts: ${selectedCourtsList.map((c) => c.name).join(", ")}. Please arrive 15 minutes before your scheduled time. Shukran!!!.`;
        try {
          await sendBookingSMS(firstBookingRefId, String(form.contactNumber).trim(), smsMsg);
        } catch (e) {
          console.error("Failed to send admin booking SMS:", e);
        }
      }

      const paymentMethodLabel = form.paymentMethod === PAYMENT_CASH ? "Cash" : "pnb";
      const paymentPlanLabel =
        form.paymentPlan === PLAN_FULL ? "Full payment" :
          form.paymentPlan === PLAN_PARTIAL ? "Down payment" : "Pay later";

      setReceiptSnapshot({
        booking: { ...firstBookingData, id: firstBookingRefId },
        transactionId: firstBookingRefId,
        date: form.date,
        timeSlot: form.timeSlot,
        courtName: selectedCourtsList.map((c) => c.name).join(", "),
        duration: form.duration,
        playerName: form.playerName,
        paymentMethodLabel,
        paymentPlanLabel,
        totalAmount: roundMoney(total),
        amountPaid: amountPaidRounded,
        remainingBalance: resolveRemaining(total, amountPaidRounded),
        change:
          form.paymentMethod === PAYMENT_CASH && form.paymentPlan !== PLAN_LATER ? roundMoney(cashReceivedNum - cashDueNow) : null,
        customerPayStatus: resolveCustomerPayStatus(form.paymentPlan, total, amountPaidRounded),
      });

    } catch (err) {
      console.error(err);
      if (syncState === "idle") {
        setSyncState("error");
        toast.error("Booking Failed — Retry");
      }
    }
  };

  const minDate = format(new Date(), "yyyy-MM-dd");
  const maxDate = format(addDays(new Date(), 90), "yyyy-MM-dd");

  if (step === 4 && receiptSnapshot) {
    return (
      <div
        className={
          adminMode
            ? "hero-bg flex items-center justify-center px-4 py-10 rounded-2xl border border-slate-800"
            : "min-h-screen hero-bg flex items-center justify-center px-4 pt-20 pb-12"
        }
      >
        <div className="max-w-lg w-full space-y-6">
          <div className="card p-6 sm:p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 border-2 border-green-500 rounded-full flex items-center justify-center mx-auto mb-4 glow-green">
              <Check size={30} className="text-green-400" />
            </div>
            <h2 className="font-display text-2xl sm:text-3xl tracking-wider text-white mb-2">BOOKING SUBMITTED</h2>
            <p className="text-slate-400 text-sm">Pending staff approval. Save your receipt below.</p>
          </div>
          <div className="card p-6 sm:p-8">
            <BookingReceipt receipt={receiptSnapshot} />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => setIsPrinting(true)}
              className="btn-primary flex-1 text-sm py-3"
              style={{ background: "var(--pickle)", color: "#000", border: "none" }}
            >
              Print Receipt
            </button>
            <button
              type="button"
              onClick={() => navigate(adminMode ? "/admin/bookings" : "/bookings")}
              className="btn-secondary flex-1 text-sm py-3"
            >
              {adminMode ? "View all bookings" : "View My Bookings"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setReceiptSnapshot(null);
                setPaymentImg(null);
                setPaymentImgUrl("");
                setCashReceivedInput("");
                setAmountPaidInput("");
                if (fileInputRef.current) fileInputRef.current.value = "";
                setForm((f) => ({
                  ...f,
                  paymentMethod: PAYMENT_PNB,
                  paymentPlan: PLAN_FULL,
                  contactNumber: "",
                  email: "",
                  ...(adminMode ? { playerName: "" } : {}),
                }));
              }}
              className="btn-secondary flex-1 text-sm py-3"
            >
              Book another
            </button>
          </div>
        </div>

        {isPrinting && (
          <ReceiptPrint
            booking={receiptSnapshot.booking}
            receiptId={"RCPT-" + receiptSnapshot.transactionId.substring(0, 5).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900)}
            printedBy={adminMode ? "Admin" : "Customer"}
            onAfterPrint={() => setIsPrinting(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={adminMode ? "book-page--embedded" : "min-h-screen"}>
      <div
        className={
          adminMode ? "court-pattern pt-4 pb-10 px-2 sm:px-4" : "min-h-screen court-pattern pt-12 sm:pt-20 pb-8 sm:pb-12 px-3 sm:px-4"
        }
      >
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8 pt-2 sm:pt-4 px-2">
            <RanawLogo variant="auth" className="mb-3 sm:mb-4 mx-auto !max-w-[160px] sm:!max-w-[200px]" />
            <h1 className="font-display text-2xl sm:text-4xl tracking-wider text-white">BOOK A <span className="gradient-text">COURT</span></h1>
            <p className="text-slate-500 mt-1 text-xs sm:text-sm">Complete all steps to confirm your reservation</p>
          </div>

          {/* Steps */}
          <div className="flex items-center justify-center gap-2 mb-10">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${step > s ? "bg-green-500 text-slate-950" :
                  step === s ? "bg-green-500/20 border-2 border-green-500 text-green-400" :
                    "bg-slate-800 text-slate-600"
                  }`}>
                  {step > s ? <Check size={16} /> : s}
                </div>
                <span className={`text-sm font-medium hidden sm:block ${step >= s ? "text-white" : "text-slate-600"}`}>
                  {s === 1 ? "Court & Schedule" : s === 2 ? "Add-ons" : "Payment"}
                </span>
                {s < 3 && <ChevronRight size={16} className="text-slate-700 mx-1" />}
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main Form */}
            <div className="lg:col-span-2 space-y-5">

              {/* Step 1 */}
              {step === 1 && (
                <>
                  {/* Court Selection */}
                  <div className="card p-6">
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Calendar size={18} className="text-green-400" /> Select Court
                    </h3>
                    {!courtsReady ? (
                      <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
                        <svg className="animate-spin w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                        </svg>
                        Loading courts…
                      </div>
                    ) : activeCourts.length === 0 ? (
                      <div className="text-center py-10 border border-dashed border-slate-700 rounded-xl">
                        <p className="text-slate-400 text-sm mb-3">No active courts available yet.</p>
                        {adminMode ? (
                          <Link
                            to="/admin/courts"
                            className="inline-flex items-center gap-1 text-cyan-400 text-sm font-semibold hover:underline"
                          >
                            Add courts in Court Management →
                          </Link>
                        ) : (
                          <p className="text-slate-500 text-xs">Ask your facility admin to add courts.</p>
                        )}
                      </div>
                    ) : (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {activeCourts.map((c) => {
                          const kind = deriveCourtKind(c);
                          const price = Number(c.pricePerHour) || 0;
                          const kindClass =
                            kind === "Indoor"
                              ? "bg-blue-500/20 text-blue-400"
                              : kind === "Outdoor"
                                ? "bg-orange-500/20 text-orange-400"
                                : "bg-slate-500/20 text-slate-400";
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                if (adminMode) {
                                  setForm(f => {
                                    const exists = f.courtIds.includes(c.id);
                                    let newIds = exists ? f.courtIds.filter(id => id !== c.id) : [...f.courtIds, c.id];
                                    if (newIds.length === 0) newIds = [c.id]; // Prevent empty selection
                                    return { ...f, courtIds: newIds, timeSlot: "" };
                                  });
                                } else {
                                  setForm({ ...form, courtIds: [c.id], timeSlot: "" });
                                }
                              }}
                              className={`rounded-xl border text-left transition-all overflow-hidden flex flex-col ${form.courtIds.includes(c.id)
                                ? "border-green-500 bg-green-500/10"
                                : "border-slate-700 bg-slate-800 hover:border-slate-600"
                                }`}
                            >
                              {c.picture && (
                                <div className="w-full h-32 bg-slate-900 shrink-0">
                                  <img src={c.picture} alt={c.name} className="w-full h-full object-cover" />
                                </div>
                              )}
                              <div className="p-4 flex-1 flex flex-col justify-between w-full">
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-white font-medium text-sm">{c.name}</span>
                                    {form.courtIds.includes(c.id) && <Check size={14} className="text-green-400" />}
                                  </div>
                                  <span className={`text-xs px-2 py-0.5 rounded-full inline-block mr-1 ${kindClass}`}>
                                    {kind}
                                  </span>
                                </div>
                                <div className="text-green-400 font-semibold mt-3">
                                  ₱{price.toLocaleString()}
                                  <span className="text-slate-500 text-xs font-normal">/hr</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Player Info */}
                  <div className="card p-6">
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <User size={18} className="text-green-400" /> Player Information
                    </h3>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className={adminMode ? "sm:col-span-2" : ""}>
                        <label className="label">Player Name</label>
                        <div className={adminMode ? "relative" : undefined}>
                          <input
                            type="text"
                            required
                            className="input-field"
                            placeholder="Full name"
                            autoComplete={adminMode ? "off" : "name"}
                            value={form.playerName}
                            onChange={(e) => {
                              setForm({ ...form, playerName: e.target.value });
                              if (adminMode) setNameSuggestOpen(true);
                            }}
                            onFocus={() => adminMode && setNameSuggestOpen(true)}
                            onBlur={() => {
                              if (!adminMode) return;
                              setTimeout(() => {
                                if (!nameSuggestRef.current?.contains(document.activeElement)) {
                                  setNameSuggestOpen(false);
                                }
                              }, 150);
                            }}
                          />
                          {adminMode && nameSuggestOpen && nameSuggestions.length > 0 && (
                            <ul
                              ref={nameSuggestRef}
                              className="book-name-suggestions absolute left-0 right-0 top-full z-[300] mt-1.5 max-h-48 overflow-y-auto rounded-lg py-1"
                              role="listbox"
                            >
                              {nameSuggestions.map((name) => (
                                <li
                                  key={name}
                                  role="option"
                                  aria-selected={form.playerName.trim() === name.trim()}
                                >
                                  <button
                                    type="button"
                                    className="book-name-suggestions__item w-full text-left px-3 py-2.5 text-sm font-medium"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setForm((f) => ({ ...f, playerName: name }));
                                      setNameSuggestOpen(false);
                                    }}
                                  >
                                    {name}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="label">Number of Players</label>
                        <select
                          className="input-field"
                          value={form.players}
                          onChange={(e) => setForm({ ...form, players: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Contact number *</label>
                        <input
                          type="tel"
                          className="input-field"
                          placeholder="09XX XXX XXXX"
                          value={form.contactNumber}
                          onChange={(e) => setForm({ ...form, contactNumber: e.target.value })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label">Email (optional)</label>
                        <input
                          type="email"
                          className="input-field"
                          placeholder="you@example.com"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Date & Time */}
                  <div className="card p-6">
                    {adminMode && (
                      <div className="flex bg-slate-900 rounded-xl p-1 mb-6">
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, bookingMode: "one-time" }))}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                            form.bookingMode === "one-time" 
                              ? "bg-slate-800 border border-slate-700 text-white shadow" 
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Calendar size={16} /> One-Time
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, bookingMode: "recurring" }))}
                          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                            form.bookingMode === "recurring" 
                              ? "bg-green-500/10 text-green-400 border border-green-500/20 shadow" 
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21v-5h5"/></svg>
                          Recurring
                        </button>
                      </div>
                    )}

                    {isTournamentDay ? (
                      <div className="bg-amber-500/10 border border-amber-500/50 p-6 rounded-xl text-center mb-6">
                        <span className="material-symbols-outlined text-amber-500 text-4xl mb-2 block mx-auto">sports_tennis</span>
                        <h3 className="text-xl font-bold text-amber-500 mb-2">Tournament Day</h3>
                        <p className="text-amber-200/70 text-sm max-w-md mx-auto">
                          All courts are fully reserved for a tournament on this date. Booking is unavailable.
                        </p>
                      </div>
                    ) : (
                      <>
                        {form.bookingMode === "one-time" ? (
                          <>
                            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                              <Clock size={18} className="text-green-400" /> Date & Time
                            </h3>
                            <div className="grid sm:grid-cols-2 gap-4 mb-5">
                              <div>
                                <label className="label uppercase text-xs tracking-wider text-slate-400 mb-2 block">Date</label>
                                <div className="relative">
                                  <input
                                    type="date"
                                    className="input-field py-3 appearance-none"
                                    min={minDate}
                                    max={maxDate}
                                    value={form.date}
                                    onChange={(e) => {
                                      const d = e.target.value;
                                      if (!d) return;
                                      const day = new Date(d).getDay();
                                      setForm(f => {
                                        const next = { ...f, date: d, timeSlot: "", customStartTime: "" };
                                        if (f.bookingMode === "recurring" && !f.recurringDays.includes(day)) {
                                          next.recurringDays = [day];
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="label uppercase text-xs tracking-wider text-slate-400 mb-2 block">Duration</label>
                                <div className="relative">
                                  <select
                                    className="input-field appearance-none py-3"
                                    value={form.duration}
                                    onChange={(e) => setForm({ ...form, duration: e.target.value === "Custom" ? "Custom" : Number(e.target.value) })}
                                  >
                                    {DURATIONS.map((d) => (
                                      <option key={d} value={d}>{d} {d === 1 ? "hour" : (d === "Custom" ? "" : "hours")}</option>
                                    ))}
                                  </select>
                                </div>
                                {form.duration === "Custom" && (
                                  <input
                                    type="time"
                                    className="input-field mt-2"
                                    value={form.customEndTime}
                                    onChange={e => setForm({...form, customEndTime: e.target.value})}
                                  />
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between mb-3 mt-2">
                              <label className="label uppercase text-xs tracking-wider text-slate-400 mb-0 block">Start Time</label>
                              {adminMode && (
                                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={form.isCustomTime}
                                    onChange={(e) => setForm({ ...form, isCustomTime: e.target.checked, timeSlot: "", customStartTime: "" })}
                                    className="rounded border-slate-700 bg-slate-800 text-slate-400 focus:ring-slate-500 w-4 h-4"
                                  />
                                  Custom Time
                                </label>
                              )}
                            </div>

                            <div className="relative mb-2">
                              {form.isCustomTime ? (
                                <input
                                  type="time"
                                  className="input-field max-w-[200px]"
                                  value={form.customStartTime}
                                  onChange={(e) => setForm({ ...form, customStartTime: e.target.value })}
                                />
                              ) : (
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                  {TIME_SLOTS.map((slot) => {
                                    const inPast = isSlotInPast(form.date, slot);
                                    const isTaken = !inPast && (!isSlotStartAvailableForDuration(
                                      slot,
                                      actualDuration,
                                      dayBookings
                                    ) || !isCourtActiveDuringSlot(court?.rawCourt, form.date, slot, actualDuration));
                                    const outOfHours = !isSlotWithinCourtHours(slot, actualDuration, court);
                                    const isUnavailable = inPast || isTaken || outOfHours;

                                    return (
                                      <button
                                        key={slot}
                                        type="button"
                                        disabled={isUnavailable}
                                        onClick={() => setForm({ ...form, timeSlot: slot })}
                                        className={`py-3 px-1 rounded-xl text-xs font-medium transition-all ${isUnavailable ? "bg-red-500/10 border border-red-500/20 text-red-400/50 cursor-not-allowed" :
                                          form.timeSlot === slot ? "bg-slate-700 text-white" :
                                            "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
                                          }`}
                                      >
                                        {slot}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {!form.isCustomTime && (
                              <div className="text-sm text-slate-500 mt-3">
                                <p>Booked = this time slot is already reserved. Conflicts = this start time would overlap an existing booking for the selected duration.</p>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 mb-6 flex gap-3 items-start">
                              <Calendar size={18} className="text-slate-400 shrink-0 mt-0.5" />
                              <p className="text-sm text-slate-400 leading-relaxed">
                                Book the same court(s) and time on chosen weekdays across a date range — e.g. every Tuesday and Wednesday, 6:00 PM–8:00 PM, for a month.
                              </p>
                            </div>
                            
                            <div className="grid sm:grid-cols-2 gap-4 mb-5">
                              <div>
                                <label className="label text-slate-400 font-medium mb-2 block">Start Date</label>
                                <div className="relative">
                                  <input
                                    type="date"
                                    className="input-field"
                                    min={minDate}
                                    max={maxDate}
                                    value={form.date}
                                    onChange={(e) => {
                                      const d = e.target.value;
                                      if (!d) return;
                                      const day = new Date(d).getDay();
                                      setForm(f => {
                                        const next = { ...f, date: d, timeSlot: "", customStartTime: "" };
                                        if (f.bookingMode === "recurring" && !f.recurringDays.includes(day)) {
                                          next.recurringDays = [day];
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="label text-slate-400 font-medium mb-2 block">End Date</label>
                                <div className="relative">
                                  <input
                                    type="date"
                                    className="input-field"
                                    min={form.date}
                                    value={form.recurrenceEnd}
                                    onChange={(e) => setForm({ ...form, recurrenceEnd: e.target.value })}
                                  />
                                </div>
                              </div>
                            </div>
                            
                            <div className="mb-6">
                              <label className="text-[13px] text-slate-400 font-medium mb-2 block tracking-wide">Or set repeat duration</label>
                              <div className="flex gap-3">
                                <input 
                                  type="number"
                                  min="1"
                                  className="w-20 bg-slate-800/60 border border-slate-700/80 text-white rounded-xl text-center py-2.5 focus:outline-none focus:border-green-500/50 transition-colors"
                                  value={form.repeatDurationValue}
                                  onChange={e => setForm({...form, repeatDurationValue: Number(e.target.value)})}
                                />
                                <select 
                                  className="flex-1 bg-slate-800/60 border border-slate-700/80 text-white rounded-xl px-4 py-2.5 appearance-none focus:outline-none focus:border-green-500/50 transition-colors"
                                  value={form.repeatDurationUnit}
                                  onChange={e => setForm({...form, repeatDurationUnit: e.target.value})}
                                  style={{
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 1rem center',
                                    backgroundSize: '1rem'
                                  }}
                                >
                                  <option value="weeks">Week(s)</option>
                                  <option value="months">Month(s)</option>
                                  <option value="years">Year(s)</option>
                                </select>
                                <button 
                                  type="button"
                                  className="bg-slate-800/80 hover:bg-slate-700 text-white font-medium px-6 py-2.5 rounded-xl transition-colors border border-slate-700/80"
                                  onClick={() => {
                                    const start = new Date(form.date);
                                    let end = start;
                                    if (form.repeatDurationUnit === "weeks") {
                                      end = addDays(start, form.repeatDurationValue * 7);
                                    } else if (form.repeatDurationUnit === "months") {
                                      end.setMonth(end.getMonth() + form.repeatDurationValue);
                                    } else if (form.repeatDurationUnit === "years") {
                                      end.setFullYear(end.getFullYear() + form.repeatDurationValue);
                                    }
                                    setForm(f => ({ ...f, recurrenceEnd: format(end, "yyyy-MM-dd") }));
                                  }}
                                >
                                  Apply
                                </button>
                              </div>
                            </div>

                            <div className="mb-6">
                              <label className="label text-slate-400 font-medium">Days of the Week</label>
                              <div className="flex flex-wrap gap-2">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, idx) => (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => {
                                      setForm(f => {
                                        const days = f.recurringDays.includes(idx)
                                          ? f.recurringDays.filter(d => d !== idx)
                                          : [...f.recurringDays, idx];
                                        return { ...f, recurringDays: days.length > 0 ? days : [idx] };
                                      });
                                    }}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                                      form.recurringDays.includes(idx)
                                        ? "bg-green-500 text-slate-900 border-green-500"
                                        : "bg-transparent text-slate-400 hover:bg-slate-800 border-slate-700"
                                    }`}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                            </div>
                            
                            <div className="grid sm:grid-cols-2 gap-4 mb-2">
                              <div>
                                <label className="label text-slate-400 font-medium mb-2 block">Start Time</label>
                                <div className="relative">
                                  <select
                                    className="input-field appearance-none py-3"
                                    value={form.timeSlot}
                                    onChange={(e) => setForm({ ...form, timeSlot: e.target.value })}
                                  >
                                    <option value="" disabled>Select</option>
                                    {TIME_SLOTS.map((slot) => {
                                      const inPast = isSlotInPast(form.date, slot);
                                      const outOfHours = !isSlotWithinCourtHours(slot, actualDuration, court);
                                      return (
                                        <option key={slot} value={slot} disabled={inPast || outOfHours}>
                                          {slot} {inPast ? "(Past)" : ""} {outOfHours ? "(Closed)" : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <Clock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                              </div>
                              <div>
                                <label className="label text-slate-400 font-medium mb-2 block">End Time</label>
                                <div className="relative">
                                  <select
                                    className="input-field appearance-none py-3"
                                    value={form.duration}
                                    onChange={(e) => setForm({ ...form, duration: e.target.value === "Custom" ? "Custom" : Number(e.target.value) })}
                                  >
                                    {DURATIONS.map((d) => {
                                      let label = d === "Custom" ? "Custom" : `${d} hr`;
                                      if (d !== "Custom" && form.timeSlot) {
                                        const parts = form.timeSlot.match(/(\d+):(\d+)\s+(AM|PM)/i);
                                        if (parts) {
                                            let h = parseInt(parts[1], 10);
                                            let m = parts[2];
                                            let ampm = parts[3];
                                            if (h === 12) h = 0;
                                            if (ampm.toUpperCase() === "PM") h += 12;
                                            const startMs = h * 60 + parseInt(m, 10);
                                            const endMs = startMs + (d * 60);
                                            let endH = Math.floor(endMs / 60);
                                            const endM = endMs % 60;
                                            let endAMPM = "AM";
                                            if (endH >= 24) endH -= 24;
                                            if (endH >= 12) {
                                              endAMPM = "PM";
                                              if (endH > 12) endH -= 12;
                                            }
                                            if (endH === 0) endH = 12;
                                            label = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')} ${endAMPM}`;
                                        }
                                      }
                                      return <option key={d} value={d}>{label}</option>
                                    })}
                                  </select>
                                  <Clock size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                                {form.duration === "Custom" && (
                                  <input
                                    type="time"
                                    className="input-field mt-2"
                                    value={form.customEndTime}
                                    onChange={e => setForm({...form, customEndTime: e.target.value})}
                                  />
                                )}
                              </div>
                            </div>
                            {actualTimeSlot && actualDuration && (
                              <div className="text-sm text-slate-400 mb-6">
                                Each session: <span className="text-green-400 font-medium">{actualDuration} hr</span> 
                              </div>
                            )}
                            
                            {sessionPreviewList.length > 0 && (
                              <div className="mt-8 border-t border-slate-800 pt-6">
                                <div className="flex justify-between items-end mb-4">
                                  <h4 className="text-white font-medium text-sm">Session Preview</h4>
                                  <div className="text-xs text-slate-400">
                                    <span className="text-green-400 font-medium">{sessionPreviewList.filter(s => s.isAvailable).length}</span> of {sessionPreviewList.length} available
                                  </div>
                                </div>
                                
                                {previewLoading ? (
                                  <div className="flex justify-center items-center py-6">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-500"></div>
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                                    {sessionPreviewList.map((session, i) => {
                                      const dateObj = new Date(session.date);
                                      const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                      return (
                                        <div key={i} className={`flex justify-between items-center p-3 rounded-xl border ${
                                          session.isAvailable === null ? 'bg-transparent border-slate-700/50' : (session.isAvailable ? 'bg-transparent border-slate-700/50' : 'bg-orange-500/5 border-orange-500/20')
                                        }`}>
                                          <div>
                                            <div className="text-sm text-white">{displayDate}</div>
                                            {(session.isAvailable === false || session.isAvailable === null) && <div className="text-xs text-slate-500 mt-0.5">{session.reason}</div>}
                                          </div>
                                          <div className={`text-sm font-medium ${session.isAvailable === null ? 'text-slate-500' : (session.isAvailable ? 'text-green-400' : 'text-orange-400')}`}>
                                            {session.isAvailable === null ? 'Pending Info' : (session.isAvailable ? 'Available' : 'Booked')}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>

                  {/* Notes */}
                  <div className="card p-6">
                    <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                      <FileText size={18} className="text-green-400" /> Special Notes (Optional)
                    </h3>
                    <textarea
                      rows={3}
                      className="input-field resize-none"
                      placeholder="Any special requests, skill level, purpose of booking..."
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                </>
              )}

              {/* Step 2 - Equipment */}
              {step === 2 && (
                <div className="card p-6">
                  <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                    <Package size={18} className="text-green-400" /> Equipment Rental Add-ons
                  </h3>
                  <p className="text-slate-500 text-sm mb-5">Optional extras to enhance your session</p>
                  <div className="space-y-3">
                    {rentalAddOns.length === 0 ? (
                      <p className="text-slate-500 text-sm py-4 text-center border border-dashed border-slate-700 rounded-xl">
                        No add-ons available yet. Add priced inventory items (or set type to "rental").
                      </p>
                    ) : (
                      rentalAddOns.map((item) => {
                        const price = getRentalItemPrice(item);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => toggleEquipment(item.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${form.equipment.includes(item.id)
                              ? "border-green-500 bg-green-500/10"
                              : "border-slate-700 bg-slate-800 hover:border-slate-600"
                              }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Package className="text-slate-400 shrink-0" size={28} strokeWidth={1.5} />
                              <div className="text-left min-w-0">
                                <div className="text-white font-medium truncate">{item.name || "Rental"}</div>
                                <div className="text-slate-500 text-sm">₱{price.toLocaleString()} per session</div>
                              </div>
                            </div>
                            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${form.equipment.includes(item.id) ? "border-green-500 bg-green-500" : "border-slate-600"
                              }`}>
                              {form.equipment.includes(item.id) && <Check size={12} className="text-slate-950" />}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {/* Promo Code */}
                  <div className="mt-6 border-t border-slate-800 pt-5">
                    <label className="label">Promo Code</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="input-field flex-1"
                        placeholder="Enter code (e.g. PICKLE10)"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      />
                      <button onClick={applyPromo} className="btn-secondary px-4 py-2 text-sm whitespace-nowrap">
                        Apply
                      </button>
                    </div>
                    {appliedPromo && (
                      <div className="flex items-center gap-2 mt-2 text-green-400 text-sm">
                        <Check size={14} /> {appliedPromo.label} applied!
                      </div>
                    )}
                    <p className="text-slate-600 text-xs mt-2">Try: PICKLE10, NEWUSER, MEMBER20</p>
                  </div>
                </div>
              )}

              {/* Step 3 - Payment */}
              {step === 3 && (
                <div className="card p-6">
                  <h3 className="text-white font-semibold mb-1 flex items-center gap-2">
                    <Smartphone size={18} className="text-green-400" /> Payment
                  </h3>
                  <p className="text-slate-500 text-sm mb-5">Plan, method, and proof</p>

                  <label className="label">Payment plan</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-6">
                    {[
                      { id: PLAN_FULL, label: "Full payment" },
                      { id: PLAN_PARTIAL, label: "Down payment" },
                      { id: PLAN_LATER, label: "Pay later" },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectPaymentPlan(p.id)}
                        className={`rounded-xl border py-3 px-2 text-xs font-semibold transition-all ${form.paymentPlan === p.id
                          ? "border-cyan-500 bg-cyan-500/15 text-cyan-300"
                          : "border-slate-700 bg-slate-800/80 text-slate-400 hover:border-slate-600"
                          }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {form.paymentPlan === PLAN_PARTIAL && (
                    <div className="mb-6">
                      <label className="label">Amount paying now *</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="input-field"
                        placeholder="0.00"
                        value={amountPaidInput}
                        onChange={(e) => setAmountPaidInput(e.target.value)}
                      />
                      <p className="text-slate-500 text-xs mt-1">
                        Balance after: <strong className="text-amber-400">₱{remainingBalance.toFixed(2)}</strong>
                      </p>
                    </div>
                  )}

                  <label className="label">Payment method</label>
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <button
                      type="button"
                      onClick={() => selectPaymentMethod(PAYMENT_PNB)}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3.5 px-3 text-sm font-semibold min-h-[48px] transition-all ${form.paymentMethod === PAYMENT_PNB
                        ? "border-green-500 bg-green-500/15 text-green-400"
                        : "border-slate-700 bg-slate-800/80 text-slate-400"
                        }`}
                    >
                      <Smartphone size={18} /> PNB
                    </button>
                    <button
                      type="button"
                      onClick={() => selectPaymentMethod(PAYMENT_CASH)}
                      className={`flex items-center justify-center gap-2 rounded-xl border py-3.5 px-3 text-sm font-semibold min-h-[48px] transition-all ${form.paymentMethod === PAYMENT_CASH
                        ? "border-amber-500 bg-amber-500/15 text-amber-400"
                        : "border-slate-700 bg-slate-800/80 text-slate-400"
                        }`}
                    >
                      <Banknote size={18} /> Cash
                    </button>
                  </div>

                  <div
                    className={`transition-[max-height,opacity] duration-300 overflow-hidden ${form.paymentMethod === PAYMENT_PNB && !adminMode ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                      }`}
                    aria-hidden={form.paymentMethod !== PAYMENT_PNB || adminMode}
                  >
                    {form.paymentMethod === PAYMENT_PNB && !adminMode && (
                      <>
                        <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-5 mb-5">
                          <div className="flex items-start gap-3">
                            <AlertCircle size={18} className="text-green-400 mt-0.5 shrink-0" />
                            <div className="text-sm">
                              <p className="text-white font-medium mb-1">PNB instructions</p>
                              {amountPaidNow <= 0 ? (
                                <p className="text-slate-400">No PNB transfer needed for pay later.</p>
                              ) : (
                                <ol className="text-slate-400 space-y-1 list-decimal list-inside">
                                  <li>Open PNB on your phone</li>
                                  <li>
                                    Send <strong className="text-green-400">₱{amountPaidNow.toFixed(2)}</strong> to:{" "}
                                    <strong className="text-white">09XX-XXX-XXXX</strong>
                                  </li>
                                  <li>Account Name: <strong className="text-white">PickleZone Inc.</strong></li>
                                  <li>Screenshot the receipt and upload below</li>
                                </ol>
                              )}
                            </div>
                          </div>
                        </div>
                        {amountPaidNow > 0 && (
                          <>
                            <label className="label">Upload PNB receipt *</label>
                            <div
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  fileInputRef.current?.click();
                                }
                              }}
                              onClick={() => fileInputRef.current?.click()}
                              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer ${paymentImgUrl ? "border-green-500 bg-green-500/5" : "border-slate-700 hover:border-slate-500"
                                }`}
                            >
                              {paymentImgUrl ? (
                                <div>
                                  <img src={paymentImgUrl} alt="Receipt" className="max-h-40 mx-auto rounded-lg mb-3 object-contain" />
                                  <p className="text-green-400 text-sm font-medium flex items-center justify-center gap-1">
                                    <Check size={14} /> Receipt uploaded
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <Upload size={32} className="text-slate-600 mx-auto mb-2" />
                                  <p className="text-slate-400 text-sm">Upload PNB screenshot</p>
                                </div>
                              )}
                              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                            </div>
                            {paymentImgUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentImg(null);
                                  setPaymentImgUrl("");
                                  if (fileInputRef.current) fileInputRef.current.value = "";
                                }}
                                className="mt-2 text-red-400 hover:text-red-300 text-xs flex items-center gap-1"
                              >
                                <X size={12} /> Remove image
                              </button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>

                  <div
                    className={`transition-[max-height,opacity] duration-300 overflow-hidden ${form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode) ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                      }`}
                    aria-hidden={form.paymentMethod !== PAYMENT_CASH && !(form.paymentMethod === PAYMENT_PNB && adminMode)}
                  >
                    {(form.paymentMethod === PAYMENT_CASH || (form.paymentMethod === PAYMENT_PNB && adminMode)) && (
                      <div className="space-y-5">
                        <div className={`bg-${form.paymentMethod === PAYMENT_CASH ? 'amber' : 'green'}-500/5 border border-${form.paymentMethod === PAYMENT_CASH ? 'amber' : 'green'}-500/20 rounded-xl p-5`}>
                          <p className="text-white font-medium text-sm mb-1">{form.paymentMethod === PAYMENT_CASH ? 'Cash' : 'PNB'}</p>
                          <p className="text-slate-300 text-sm">
                            {form.paymentPlan === PLAN_LATER
                              ? `You will pay in ${form.paymentMethod === PAYMENT_CASH ? 'cash' : 'PNB'} at the facility before play.`
                              : `Bring ${form.paymentMethod === PAYMENT_CASH ? 'cash' : 'PNB'} — amount due now: ₱${cashDueNow.toFixed(2)} (total booking ₱${total.toFixed(2)})`}
                          </p>
                        </div>
                        {form.paymentPlan !== PLAN_LATER && (
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                              <label className="label">{form.paymentMethod === PAYMENT_CASH ? 'Cash' : 'PNB'} received *</label>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="input-field pl-8"
                                  placeholder="0.00"
                                  value={cashReceivedInput}
                                  onChange={(e) => setCashReceivedInput(e.target.value)}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="label">Change</label>
                              <div
                                className={`input-field flex items-center min-h-[42px] cursor-default ${cashChangeUi.variant === "danger"
                                  ? "text-red-400 border-red-500/30 bg-red-500/5"
                                  : cashChangeUi.variant === "ok"
                                    ? "text-emerald-400"
                                    : "text-slate-500"
                                  }`}
                              >
                                {cashChangeUi.text}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Nav Buttons */}
              <div className="flex gap-3">
                {step > 1 && (
                  <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1 py-3">
                    ← Back
                  </button>
                )}
                {step < 3 ? (
                  <button
                    onClick={() => {
                      if (step === 1 && isTournamentDay) return toast.error("Booking is unavailable on tournament days");
                      if (step === 1 && !form.timeSlot) return toast.error("Please select a time slot");
                      if (step === 1 && !form.playerName) return toast.error("Player name is required");
                      if (step === 1 && !String(form.contactNumber ?? "").trim()) {
                        return toast.error("Contact number is required");
                      }
                      setStep(step + 1);
                    }}
                    className="btn-primary flex-1 py-3 flex items-center justify-center gap-2"
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={syncState !== "idle" && syncState !== "error"}
                    className="btn-primary flex-1 py-3 flex items-center justify-center gap-2"
                  >
                    {syncState === "syncing" && (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                        </svg>
                        Syncing Booking...
                      </span>
                    )}
                    {syncState === "offline-saved" && (
                      <span className="flex items-center gap-2">
                        <Check size={16} /> Saved Offline — Will Sync Automatically
                      </span>
                    )}
                    {syncState === "reconnecting" && (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                        </svg>
                        Syncing Pending Booking...
                      </span>
                    )}
                    {syncState === "success" && (
                      <span className="flex items-center gap-2">
                        <Check size={16} /> Booking Synced Successfully
                      </span>
                    )}
                    {syncState === "error" && (
                      <span className="flex items-center gap-2">
                        Booking Failed — Retry
                      </span>
                    )}
                    {syncState === "idle" && (
                      <><Check size={16} /> Confirm Booking</>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Summary Sidebar */}
            <div className="space-y-4">
              <div className="card p-5 sticky top-24">
                <h3 className="text-white font-semibold mb-4 text-sm">Booking Summary</h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-slate-500 text-xs mb-1">Court</div>
                    <div className="text-white font-medium">{selectedCourtsList.length > 0 ? selectedCourtsList.map(c => c.name).join(", ") : "—"}</div>
                    {court && (
                      <div className="flex gap-2 mt-1">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${court.type === "Indoor"
                            ? "bg-blue-500/20 text-blue-400"
                            : court.type === "Outdoor"
                              ? "bg-orange-500/20 text-orange-400"
                              : "bg-slate-500/20 text-slate-400"
                            }`}
                        >
                          {court.type}
                        </span>
                      </div>
                    )}
                  </div>

                  {form.bookingMode === "recurring" ? (
                    <div>
                      <div className="text-slate-500 text-xs mb-1">Schedule</div>
                      <div className="text-white font-medium">
                        {form.recurringDays.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ")}
                      </div>
                      <div className="text-slate-300 text-xs mt-1">
                        {form.date} to {form.recurrenceEnd}
                      </div>
                      <div className="text-green-400 mt-2">{form.timeSlot || "Not selected"}</div>
                      <div className="text-slate-400 text-xs">{actualDuration} {actualDuration === 1 ? "hour" : "hours"}</div>
                    </div>
                  ) : form.date && (
                    <div>
                      <div className="text-slate-500 text-xs mb-1">Date & Time</div>
                      <div className="text-white">{form.date}</div>
                      <div className="text-green-400">{form.timeSlot || "Not selected"}</div>
                      <div className="text-slate-400 text-xs">{actualDuration} {actualDuration === 1 ? "hour" : "hours"}</div>
                    </div>
                  )}

                  <div>
                    <div className="text-slate-500 text-xs mb-1">Players</div>
                    <div className="text-white flex items-center gap-1">
                      <Users size={13} /> {form.players}
                    </div>
                  </div>

                  {form.playerName && (
                    <div>
                      <div className="text-slate-500 text-xs mb-1">Player Name</div>
                      <div className="text-white">{form.playerName}</div>
                    </div>
                  )}

                  {equipmentItems.length > 0 && (
                    <div>
                      <div className="text-slate-500 text-xs mb-1">Equipment</div>
                      {equipmentItems.map((e) => (
                        <div key={e.id} className="flex justify-between text-slate-300 text-xs gap-2">
                          <span className="truncate">{e.name}</span>
                          <span className="shrink-0">₱{getRentalItemPrice(e).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-800 mt-4 pt-4 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-400">
                    <span>Court ({actualDuration}hr) {sessionCount > 1 ? `× ${sessionCount}` : ''}</span>
                    <span>₱{courtTotal}</span>
                  </div>
                  {equipmentTotal > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>Equipment {sessionCount > 1 ? `× ${sessionCount}` : ''}</span>
                      <span>₱{equipmentTotal}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-green-400">
                      <span>Promo ({appliedPromo?.code})</span>
                      <span>-₱{discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-white font-semibold text-base pt-2 border-t border-slate-800">
                    <span>Total</span>
                    <span className="text-green-400">₱{total.toFixed(2)}</span>
                  </div>
                </div>

                {step === 3 && (
                  <div className="mt-4 space-y-2 text-xs border-t border-slate-800 pt-4">
                    <div className="flex justify-between text-slate-400">
                      <span>Paying now</span>
                      <span className="text-white">₱{amountPaidNow.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Balance</span>
                      <span className="text-amber-400">₱{remainingBalance.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Status</span>
                      <span className="text-slate-200 capitalize">{customerPaymentStatus}</span>
                    </div>
                  </div>
                )}
                <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                  <p className="text-blue-400 text-xs">
                    {form.paymentPlan === PLAN_LATER
                      ? "💡 Pay later: settle at the desk before your slot."
                      : form.paymentMethod === PAYMENT_CASH
                        ? "💡 Cash: pay at facility; booking stays pending until approved."
                        : "💡 PNB: pending until staff confirms your transfer."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
