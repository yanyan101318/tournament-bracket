import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where, orderBy, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import MarketplaceBrowse from "../marketplace/MarketplaceBrowse";
import { FOODCOURT_PATH } from "../marketplace/constants";
import { findActiveBookingForCourt } from "../lib/bookingSession";
import { matchesBookerIdentity } from "../lib/bookerVerify";

function productPrice(p) {
  const v = Number(p?.price ?? p?.salePrice ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function productStock(p) {
  const n = p?.stock ?? p?.quantity ?? p?.qty;
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function OrderProductImage({ src, alt }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt || "Product"}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
    );
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-600 gap-1" aria-hidden>
      <span className="material-symbols-outlined text-3xl opacity-50">image</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide">No photo</span>
    </div>
  );
}

export default function OrderPage() {
  const [searchParams] = useSearchParams();
  const courtIdParam =
    searchParams.get("courtId") ||
    searchParams.get("courtID") ||
    searchParams.get("courtid") ||
    searchParams.get("court") ||
    searchParams.get("court_id") ||
    searchParams.get("id");
  const courtNameParam =
    searchParams.get("courtName") ||
    searchParams.get("courtname") ||
    searchParams.get("court_name");

  const [booking, setBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(Boolean(courtIdParam || courtNameParam));
  const [bookingLoadError, setBookingLoadError] = useState(null);
  const [courtName, setCourtName] = useState("");

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [category, setCategory] = useState("All");

  const [cart, setCart] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);

  const [showApprovals, setShowApprovals] = useState(false);
  const [verifiedAsBooker, setVerifiedAsBooker] = useState(false);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [orderMode, setOrderMode] = useState("snacks");
  const [marketplacePlaced, setMarketplacePlaced] = useState(false);


  useEffect(() => {
    if (!courtIdParam && !courtNameParam) {
      setLoadingBooking(false);
      return undefined;
    }

    setLoadingBooking(true);
    setBookingLoadError(null);

    const merged = new Map();
    let courtLabel = courtNameParam || "";
    let unsubById = () => {};
    let unsubByName = () => {};

    const apply = () => {
      const active = findActiveBookingForCourt(
        Array.from(merged.values()),
        courtIdParam,
        new Date(),
        courtLabel
      );
      setBooking(active);
      setLoadingBooking(false);
    };

    const onBookingsSnap = (snap) => {
      snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));
      apply();
    };

    const onBookingsErr = (err) => {
      console.error("Error loading court session:", err);
      setBooking(null);
      setBookingLoadError(err?.code === "permission-denied" ? "permission" : "unknown");
      setLoadingBooking(false);
    };

    let cancelled = false;

    (async () => {
      if (courtIdParam) {
        try {
          const courtSnap = await getDoc(doc(db, "courts", courtIdParam));
          if (cancelled) return;
          if (courtSnap.exists()) {
            courtLabel = courtSnap.data().name || courtLabel;
            setCourtName(courtLabel);
          }
        } catch {
          /* court doc optional */
        }
      }

      if (courtNameParam && !courtLabel) {
        courtLabel = courtNameParam;
        setCourtName(courtNameParam);
      }

      if (cancelled) return;

      if (courtIdParam) {
        unsubById = onSnapshot(
          query(collection(db, "bookings"), where("courtId", "==", courtIdParam)),
          onBookingsSnap,
          onBookingsErr
        );
      }

      if (courtNameParam || courtLabel) {
        const nameQuery = courtNameParam || courtLabel;
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
  }, [courtIdParam, courtNameParam]);

  useEffect(() => {
    if (!booking?.id) return undefined;
    const q = query(collection(db, "orders"), where("bookingId", "==", booking.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const awaiting = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((o) => o.status === "awaiting_approval");
        awaiting.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        setPendingApprovalCount(awaiting.length);
        if (verifiedAsBooker) setPendingOrders(awaiting);
      },
      (err) => console.error("Pending orders listener:", err)
    );
    return () => unsub();
  }, [booking?.id, verifiedAsBooker]);

  const handleVerify = () => {
    if (matchesBookerIdentity(verifyInput, booking)) {
      setVerifiedAsBooker(true);
      setVerifyError("");
    } else {
      setVerifyError("Incorrect phone number or email used when booking.");
    }
  };

  const handleApproveOrder = async (orderId) => {
    try {
      await updateDoc(doc(db, "orders", orderId), { status: "approved" });
      toast.success("Order approved and sent to admin!");
    } catch (err) {
      toast.error("Failed to approve order.");
    }
  };

  const handleRejectOrder = async (orderId) => {
    try {
      await updateDoc(doc(db, "orders", orderId), { status: "rejected" });
      toast.success("Order rejected.");
    } catch (err) {
      toast.error("Failed to reject order.");
    }
  };


  useEffect(() => {
    if (!booking) return; // don't load products if invalid session
    const q = query(collection(db, "products"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingProducts(false);
    }, (err) => {
      console.error("Error loading products:", err);
      setLoadingProducts(false);
    });
    return () => unsub();
  }, [booking]);

  const categories = useMemo(() => {
    const s = new Set();
    for (const p of products) {
      const c = (p.category || "").trim();
      if (c) s.add(c);
    }
    return ["All", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const catOk = category === "All" || (p.category || "").trim() === category;
      return catOk;
    });
  }, [products, category]);

  const cartLines = useMemo(() => {
    const lines = [];
    for (const [id, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const p = products.find((x) => x.id === id);
      if (!p) continue;
      const stock = productStock(p);
      const safeQty = Math.min(qty, stock); // enforce max stock
      const unit = productPrice(p);
      lines.push({
        productId: id,
        name: p.name || "Item",
        category: p.category || "",
        unitPrice: unit,
        quantity: safeQty,
        lineTotal: roundMoney(unit * safeQty),
      });
    }
    return lines;
  }, [cart, products]);

  const cartTotal = useMemo(
    () => roundMoney(cartLines.reduce((s, l) => s + l.lineTotal, 0)),
    [cartLines]
  );

  const addToCart = useCallback((p) => {
    const stock = productStock(p);
    if (stock <= 0) {
      toast.error("Out of stock");
      return;
    }
    setCart((c) => {
      const cur = c[p.id] || 0;
      const next = Math.min(cur + 1, stock);
      return { ...c, [p.id]: next };
    });
  }, []);

  const setQty = useCallback((productId, qty, maxStock) => {
    const q = Math.floor(Number(qty) || 0);
    if (q <= 0) {
      setCart((c) => {
        const n = { ...c };
        delete n[productId];
        return n;
      });
      return;
    }
    setCart((c) => ({ ...c, [productId]: Math.min(q, maxStock) }));
  }, []);

  const handleCheckout = async () => {
    if (cartLines.length === 0) return toast.error("Your cart is empty");
    setSubmitting(true);
    try {
      await addDoc(collection(db, "orders"), {
        bookingId: booking.id,
        courtId: booking.courtId || "Unknown",
        courtName: booking.courtName || "Unknown",
        playerName: booking.playerName || "Unknown",
        items: cartLines,
        totalAmount: cartTotal,
        status: "awaiting_approval",
        placedByGuest: true,
        createdAt: serverTimestamp(),
      });
      setOrderPlaced(true);
      setCart({});
    } catch (err) {
      console.error(err);
      toast.error("Could not place order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if ((courtIdParam || courtNameParam) && loadingBooking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if ((courtIdParam || courtNameParam) && !booking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
        <div className="w-16 h-16 bg-red-500/20 border-2 border-red-500 rounded-full flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-red-400 text-3xl">error</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">No Active Booking</h1>
        <p className="text-slate-400 max-w-sm">
          {bookingLoadError === "permission"
            ? "Could not verify your court session. Ask staff to update Firestore rules, or sign in and try again."
            : "There is no booking for this court today. Book a court first, then scan the QR again — you can order food any time on your booking day (pending or approved)."}
        </p>
      </div>
    );
  }

  if (orderPlaced) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
        <div className="w-20 h-20 bg-emerald-500/20 border-2 border-emerald-500 rounded-full flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-emerald-400 text-4xl">check_circle</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">Order Placed!</h1>
        <p className="text-slate-400 max-w-md mb-8">
          Your order was sent to <strong className="text-white">{booking.playerName}</strong> for approval.
          They can tap <strong className="text-cyan-400">Approve Orders</strong> on this page and confirm with their booking email or phone.
          The kitchen will prepare it after approval.
        </p>
        <button
          onClick={() => setOrderPlaced(false)}
          className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl transition-colors"
        >
          Order Something Else
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-32">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 p-4 shadow-lg">
        <div className="max-w-xl mx-auto">
          <div className="mb-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            <strong className="text-cyan-300">Open to everyone</strong> — no login needed to order.
            Court snacks require approval from <strong className="text-white">{booking.playerName}</strong> before the kitchen prepares them.
          </div>
          <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Court ordering</h1>
            <p className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">
              {booking.courtName}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <button 
              type="button"
              onClick={() => setShowApprovals(true)}
              className="relative text-[10px] sm:text-xs bg-slate-800 text-cyan-400 hover:bg-slate-700 transition-colors border border-cyan-500/50 px-3 py-1.5 rounded-full font-bold uppercase tracking-wide"
            >
              {booking.playerName ? `${booking.playerName.split(" ")[0]}'s approvals` : "Approve Orders"}
              {pendingApprovalCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold flex items-center justify-center">
                  {pendingApprovalCount}
                </span>
              )}
            </button>
            <div className="w-10 h-10 bg-cyan-500/20 rounded-full flex items-center justify-center border border-cyan-500/50 shrink-0">
              <span className="material-symbols-outlined text-cyan-400">restaurant</span>
            </div>
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4">
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            className={`flex-1 py-2 rounded-xl text-sm font-bold ${orderMode === "marketplace" ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}
            onClick={() => setOrderMode("marketplace")}
          >
            Food court stalls
          </button>
          <button
            type="button"
            className={`flex-1 py-2 rounded-xl text-sm font-bold ${orderMode === "snacks" ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}
            onClick={() => setOrderMode("snacks")}
          >
            Court snacks (needs approval)
          </button>
        </div>

        {orderMode === "marketplace" ? (
          <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
            All food court stalls are on one menu.{" "}
            <Link to={FOODCOURT_PATH} className="font-bold text-cyan-300 underline">
              Open food court →
            </Link>
          </div>
        ) : null}
        {orderMode === "marketplace" ? (
          marketplacePlaced ? (
            <div className="text-center py-12">
              <p className="text-emerald-400 font-semibold mb-4">Marketplace order placed!</p>
              <p className="text-slate-400 text-sm mb-6">Pay at the admin counter. Vendors prepare after payment (no court booker approval needed).</p>
              <button
                type="button"
                className="px-6 py-3 bg-cyan-500 text-slate-950 font-bold rounded-xl"
                onClick={() => setMarketplacePlaced(false)}
              >
                Order more
              </button>
            </div>
          ) : (
            <MarketplaceBrowse
              booking={booking}
              onOrderPlaced={() => setMarketplacePlaced(true)}
            />
          )
        ) : (
          <>
        {/* Categories */}
        <div className="flex overflow-x-auto gap-2 pb-4 hide-scrollbar">
          {categories.map((c) => (
            <button
              key={c}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${category === c
                ? "bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(34,211,238,0.4)]"
                : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Menu Items */}
        {loadingProducts ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-2">
            {filteredProducts.map((p) => {
              const stock = productStock(p);
              const price = productPrice(p);
              const inCart = cart[p.id] || 0;
              return (
                <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col transition-all hover:border-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)]">
                  <div className="aspect-[4/3] w-full overflow-hidden bg-slate-950 border-b border-slate-800">
                    <OrderProductImage src={p.productImage} alt={p.name} />
                  </div>
                  <div className="p-3 sm:p-4 flex-1">
                    <div className="text-xs text-slate-500 font-semibold mb-1 uppercase">{p.category || "General"}</div>
                    <div className="font-bold text-white leading-tight mb-2 line-clamp-2">{p.name || "Unnamed"}</div>
                    <div className="text-emerald-400 font-mono font-semibold">₱{price.toFixed(2)}</div>
                    <div className="text-slate-400 text-xs mt-1">Stock Left: {stock}</div>

                  </div>

                  {inCart > 0 ? (
                    <div className="bg-slate-800/50 border-t border-slate-800 p-2 flex items-center justify-between">
                      <button onClick={() => setQty(p.id, inCart - 1, stock)} className="w-8 h-8 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center text-white">−</button>
                      <span className="font-bold text-white">{inCart}</span>
                      <button onClick={() => setQty(p.id, inCart + 1, stock)} className="w-8 h-8 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg flex items-center justify-center font-bold" disabled={inCart >= stock}>+</button>
                    </div>
                  ) : (
                    <button
                      className="bg-slate-800 hover:bg-slate-700 border-t border-slate-800 p-3 text-sm font-bold text-cyan-400 transition-colors disabled:opacity-50 disabled:text-slate-500"
                      disabled={stock <= 0}
                      onClick={() => addToCart(p)}
                    >
                      {stock <= 0 ? "Out of Stock" : "Add to Cart"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
          </>
        )}
      </div>

      {/* Floating Checkout Bar */}
      {orderMode === "snacks" && cartLines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent pointer-events-none z-20">
          <div className="max-w-xl mx-auto bg-slate-800 border border-slate-700 shadow-2xl rounded-2xl p-4 pointer-events-auto">
            <div className="flex justify-between items-center mb-3">
              <div className="text-slate-300 font-semibold">{cartLines.reduce((s, l) => s + l.quantity, 0)} items</div>
              <div className="text-xl font-bold text-emerald-400 font-mono">₱{cartTotal.toFixed(2)}</div>
            </div>
            <button
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-70 shadow-[0_0_20px_rgba(34,211,238,0.2)]"
              disabled={submitting}
              onClick={handleCheckout}
            >
              {submitting ? (
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">shopping_cart_checkout</span>
                  Send for approval
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Approval Modal Overlay */}
      {showApprovals && (
        <div className="fixed inset-0 bg-slate-950/95 z-50 flex flex-col p-4 overflow-y-auto">
          <div className="max-w-xl mx-auto w-full pt-4 pb-8 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-8 border-b border-slate-800 pb-4">
              <h2 className="text-xl font-bold text-white">Order Approvals</h2>
              <button 
                onClick={() => setShowApprovals(false)}
                className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            {!verifiedAsBooker ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex-1 flex flex-col justify-center">
                <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-cyan-500/30">
                  <span className="material-symbols-outlined text-cyan-400 text-3xl">shield_person</span>
                </div>
                <h3 className="text-center text-xl font-bold text-white mb-2">Court booker only</h3>
                <p className="text-center text-slate-400 text-sm mb-6">
                  Guests can place orders without logging in. Only <strong className="text-white">{booking.playerName}</strong> can approve them — enter the email or phone number from the booking.
                </p>
                <div className="space-y-4 max-w-sm mx-auto w-full">
                  <input
                    type="text"
                    placeholder="Email or Phone Number"
                    className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3 outline-none focus:border-cyan-500 transition-colors"
                    value={verifyInput}
                    onChange={(e) => setVerifyInput(e.target.value)}
                  />
                  {verifyError && <p className="text-red-400 text-xs text-center">{verifyError}</p>}
                  <button 
                    onClick={handleVerify}
                    className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-3 rounded-xl transition-colors"
                  >
                    Verify & Continue
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col space-y-4">
                {pendingOrders.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 border-dashed rounded-2xl p-8 text-center flex-1 flex flex-col justify-center">
                    <span className="material-symbols-outlined text-slate-600 text-5xl mb-4">inbox</span>
                    <h3 className="text-lg font-bold text-slate-300 mb-1">No Orders Awaiting Approval</h3>
                    <p className="text-slate-500 text-sm">When your friends place orders, they will appear here for you to approve before the kitchen starts preparing them.</p>
                  </div>
                ) : (
                  pendingOrders.map(order => (
                    <div key={order.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                      <div className="flex justify-between items-start mb-3 border-b border-slate-800 pb-3">
                        <div>
                          <p className="text-xs text-slate-500 mb-1">
                            {order.createdAt ? format(order.createdAt.toDate(), "hh:mm a") : "Just now"}
                          </p>
                          <h4 className="font-bold text-white">₱{(order.totalAmount || 0).toFixed(2)}</h4>
                        </div>
                        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/50 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded">
                          Awaiting Approval
                        </span>
                      </div>
                      
                      <div className="space-y-2 mb-4">
                        {order.items?.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span className="text-slate-300">{item.quantity}x {item.name}</span>
                            <span className="text-slate-500">₱{item.lineTotal?.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleRejectOrder(order.id)}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-red-400 font-bold py-2 rounded-xl transition-colors text-sm"
                        >
                          Reject
                        </button>
                        <button 
                          onClick={() => handleApproveOrder(order.id)}
                          className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold py-2 rounded-xl transition-colors shadow-[0_0_12px_rgba(34,211,238,0.3)] text-sm"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
