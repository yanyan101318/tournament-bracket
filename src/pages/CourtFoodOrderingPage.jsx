import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  MapPin, AlertCircle, ShoppingCart, Plus, Minus, Check, 
  ChevronRight, Utensils, Store as StoreIcon
} from 'lucide-react';
import { subscribeStores } from "../services/marketplace/storesService";
import { subscribeStoreProducts, productStock, productPrice } from "../services/marketplace/storeProductsService";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { findActiveBookingForCourt } from "../lib/bookingSession";
import { STORE_STATUS } from "../marketplace/constants";
import { createCourtOrderPendingApproval } from "../services/marketplace/courtOrdersService";
import toast from "react-hot-toast";
import { useAuth } from "../auth/AuthContext";

const ORDER_STEPS = ['Your Order', 'Booker Approval', 'Kitchen', 'Ready'];

export default function CourtFoodOrderingPage() {
  const { courtId } = useParams();
  const { user, profile } = useAuth();
  
  const [stores, setStores] = useState([]);
  const [productsByStore, setProductsByStore] = useState({});
  const [activeStoreId, setActiveStoreId] = useState(null);
  const [cart, setCart] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderDone, setOrderDone] = useState(false);
  const [guestName, setGuestName] = useState(user?.displayName || profile?.name || profile?.fullName || "");
  const [submitting, setSubmitting] = useState(false);

  const [booking, setBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [courtName, setCourtName] = useState(`Court ${courtId || ''}`);

  // Fetch Booking and Court Info
  useEffect(() => {
    if (!courtId) {
      setLoadingBooking(false);
      return;
    }

    let isSubscribed = true;
    const merged = new Map();
    let currentCourtName = `Court ${courtId}`;

    getDoc(doc(db, "courts", courtId)).then(snap => {
      if (snap.exists() && isSubscribed) {
        currentCourtName = snap.data().name || currentCourtName;
        setCourtName(currentCourtName);
      }
    });

    const unsub = onSnapshot(
      query(collection(db, "bookings"), where("courtId", "==", courtId)),
      (snap) => {
        snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() }));
        const activeBooking = findActiveBookingForCourt(
          Array.from(merged.values()),
          courtId,
          new Date(),
          currentCourtName
        );
        if (isSubscribed) {
          setBooking(activeBooking);
          setLoadingBooking(false);
        }
      }
    );

    return () => {
      isSubscribed = false;
      unsub();
    };
  }, [courtId]);

  // Fetch Stores
  useEffect(() => {
    const unsub = subscribeStores((list) => {
      const openStores = list.filter(s => s.status !== STORE_STATUS.CLOSED);
      setStores(openStores);
      setActiveStoreId(prev => prev ? prev : (openStores.length > 0 ? openStores[0].id : null));
    }, { activeOnly: false });
    return () => unsub();
  }, []);

  // Fetch Products for all open stores
  const storeIdsJoined = useMemo(() => stores.map(s => s.id).sort().join(","), [stores]);

  useEffect(() => {
    if (!storeIdsJoined) return;
    const ids = storeIdsJoined.split(",");
    const unsubs = ids.map(id => 
      subscribeStoreProducts(id, (products) => {
        setProductsByStore(prev => ({ ...prev, [id]: products }));
      })
    );
    return () => unsubs.forEach(unsub => unsub());
  }, [storeIdsJoined]);

  // Cart Handlers
  const handleQuantityChange = useCallback((storeId, product, delta) => {
    const key = `${storeId}:${product.id}`;
    const stock = productStock(product);
    
    setCart(prev => {
      const current = prev[key] || 0;
      const next = current + delta;
      
      if (next > stock) {
        toast.error("Not enough stock!");
        return prev;
      }
      
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  // Compute Cart Groups for Checkout Component
  const cartGroups = useMemo(() => {
    const groups = {};
    for (const [key, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const [storeId, productId] = key.split(":");
      const store = stores.find((s) => s.id === storeId);
      const product = (productsByStore[storeId] || []).find((p) => p.id === productId);
      if (!store || !product) continue;
      const stock = productStock(product);
      const safeQty = Math.min(qty, stock);
      const unit = productPrice(product);
      const line = {
        productId,
        name: product.name,
        unitPrice: unit,
        quantity: safeQty,
        lineTotal: unit * safeQty,
        notes: "",
      };
      if (!groups[storeId]) {
        groups[storeId] = { storeId, storeName: store.name, items: [] };
      }
      groups[storeId].items.push(line);
    }
    return groups;
  }, [cart, stores, productsByStore]);

  const cartTotal = useMemo(() => {
    return Object.values(cartGroups).reduce(
      (total, group) => total + group.items.reduce((sum, item) => sum + item.lineTotal, 0),
      0
    );
  }, [cartGroups]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const handleSubmitOrder = async () => {
    if (!guestName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    setSubmitting(true);
    try {
      await createCourtOrderPendingApproval({
        courtId,
        courtName,
        bookingId: booking.id,
        bookerName: booking.playerName,
        bookerUid: booking.userId || null,
        userId: booking.userId || null,
        cartGroups,
        cartTotal,
        guestName: guestName.trim()
      });
      setCart({});
      setCheckoutOpen(false);
      setOrderDone(true);
    } catch (e) {
      console.error(e);
      toast.error("Failed to submit order");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingBooking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="w-8 h-8 border-4 border-[#84CC16] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0F172A] p-6 text-center">
        <div className="w-16 h-16 bg-rose-500/20 border-2 border-rose-500 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="text-rose-500" size={32} />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">No active booking found</h1>
        <p className="text-slate-400 max-w-sm">
          There is no active booking for {courtName} right now. Court orders require an active booking.
        </p>
        <Link to="/foodcourt" className="mt-6 px-6 py-3 bg-[#84CC16] text-[#0F172A] font-bold rounded-xl shadow-lg shadow-[#84CC16]/20">
          Open General Food Court
        </Link>
      </div>
    );
  }

  if (orderDone) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#0F172A] p-6 text-center">
        <div className="w-24 h-24 bg-[#84CC16]/20 border-4 border-[#84CC16] rounded-full flex items-center justify-center mb-6">
          <Check className="text-[#84CC16]" size={48} strokeWidth={3} />
        </div>
        <h2 className="text-3xl font-black text-white mb-3">Order Sent!</h2>
        <p className="text-slate-400 text-sm max-w-sm mx-auto mb-8 leading-relaxed">
          Your order has been submitted for approval. Once approved by the court booker, it will be prepared by the stalls.
        </p>
        <button
          onClick={() => setOrderDone(false)}
          className="px-8 py-4 bg-[#84CC16] hover:bg-[#65a30d] text-[#0F172A] font-bold rounded-xl shadow-[0_0_20px_rgba(132,204,22,0.3)] transition-all active:scale-95"
        >
          Order More Items
        </button>
      </div>
    );
  }

  const activeProducts = productsByStore[activeStoreId] || [];

  return (
    <div className="min-h-screen bg-[#0F172A] text-white font-sans pb-32">
      {/* Header Section */}
      <div className="pt-6 px-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 bg-slate-800/80 pr-4 pl-2 py-1.5 rounded-full border border-slate-700 shadow-md">
            <div className="bg-rose-500/20 p-1.5 rounded-full text-rose-500">
              <MapPin size={16} />
            </div>
            <span className="font-bold text-sm tracking-wide line-clamp-1">{courtName}</span>
          </div>
          
          <div className="flex items-center gap-1.5 bg-[#84CC16]/10 px-3 py-1.5 rounded-full border border-[#84CC16]/20 shadow-inner shrink-0">
            <div className="w-2 h-2 rounded-full bg-[#84CC16] animate-pulse"></div>
            <span className="text-[#84CC16] text-xs font-bold">Active Booking</span>
          </div>
        </div>
        
        <h1 className="text-3xl font-black mb-1 tracking-tight">Food & Drinks</h1>
        <p className="text-slate-400 text-sm mb-5">Delivered right to your court</p>
        
        {/* Notice Banner */}
        <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl flex items-start gap-3 shadow-sm">
          <AlertCircle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
          <p className="text-amber-200/80 text-xs leading-relaxed font-medium">
            <strong className="text-amber-500">Booker Approval:</strong> Orders require approval from <span className="text-white font-bold">{booking.playerName}</span> before processing.
          </p>
        </div>
      </div>

      {/* Order Status Flow Indicator */}
      <div className="px-4 mt-8 mb-6">
        <div className="flex justify-between items-start relative px-2">
          <div className="absolute left-6 right-6 top-[11px] h-0.5 bg-slate-700 -z-10"></div>
          <div className="absolute left-6 top-[11px] h-0.5 bg-[#84CC16] -z-10 transition-all duration-500 ease-out" style={{ width: `0%` }}></div>
          {ORDER_STEPS.map((step, idx) => {
            const isActive = idx === 0;
            const isPast = idx < 0;
            return (
              <div key={step} className="flex flex-col items-center gap-2 z-10 w-16">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300
                  ${isActive ? 'bg-[#84CC16] text-slate-900 ring-4 ring-[#84CC16]/20 shadow-[0_0_15px_rgba(132,204,22,0.4)] scale-110' : 
                    isPast ? 'bg-[#84CC16] text-slate-900' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                  {isPast ? <Check size={12} strokeWidth={3} /> : idx + 1}
                </div>
                <span className={`text-[10px] text-center leading-tight font-medium ${isActive ? 'text-[#84CC16]' : isPast ? 'text-slate-300' : 'text-slate-500'}`}>
                  {step}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stall Categories Tabs */}
      <div className="sticky top-0 z-40 bg-[#0F172A]/90 backdrop-blur-md pt-2 pb-4 border-b border-slate-800 shadow-sm">
        <div className="flex overflow-x-auto no-scrollbar gap-3 px-4">
          {stores.map(store => (
            <button 
              key={store.id}
              onClick={() => setActiveStoreId(store.id)}
              className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                activeStoreId === store.id 
                  ? 'bg-[#84CC16] text-[#0F172A] shadow-[0_4px_10px_rgba(132,204,22,0.3)]' 
                  : 'bg-slate-800/80 text-slate-300 border border-slate-700 hover:bg-slate-700'
              }`}
            >
              {store.logoUrl ? (
                <img src={store.logoUrl} className="w-5 h-5 rounded-full object-cover" alt="" />
              ) : <StoreIcon size={14} />}
              {store.name}
            </button>
          ))}
          {stores.length === 0 && (
            <div className="text-slate-500 text-sm py-2">No active stalls available.</div>
          )}
        </div>
      </div>

      {/* Menu Section */}
      <div className="grid grid-cols-2 gap-4 px-4 pt-6">
        {activeProducts.map(item => {
          const qty = cart[`${activeStoreId}:${item.id}`] || 0;
          const stock = productStock(item);
          const price = productPrice(item);
          
          return (
            <div key={item.id} className={`bg-slate-800/60 rounded-2xl overflow-hidden border border-slate-700/50 shadow-lg flex flex-col backdrop-blur-sm transition-transform ${stock <= 0 ? 'opacity-60' : 'active:scale-[0.98]'}`}>
              <div className="relative h-36">
                {item.productImage ? (
                  <img src={item.productImage} alt={item.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center text-slate-700">
                    <Utensils size={32} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A] to-transparent"></div>
              </div>
              
              <div className="p-3 flex-1 flex flex-col justify-between z-10 -mt-6 bg-gradient-to-t from-slate-800/80 to-transparent">
                <div className="pt-2">
                  <h3 className="font-semibold text-sm text-white leading-tight line-clamp-2">{item.name}</h3>
                  <p className="text-[#84CC16] font-bold text-sm mt-1 tracking-wide">₱{price.toFixed(2)}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Stock: {stock}</p>
                </div>
                
                <div className="mt-4">
                  {qty > 0 ? (
                    <div className="flex items-center justify-between bg-slate-900/80 rounded-xl p-1 border border-slate-700 shadow-inner">
                      <button 
                        onClick={() => handleQuantityChange(activeStoreId, item, -1)} 
                        className="p-1.5 text-slate-300 hover:text-white active:bg-slate-800 rounded-lg transition-colors"
                      >
                        <Minus size={16} />
                      </button>
                      <span className="font-bold text-sm px-2 text-white">{qty}</span>
                      <button 
                        onClick={() => handleQuantityChange(activeStoreId, item, 1)} 
                        disabled={qty >= stock}
                        className={`p-1.5 rounded-lg shadow-sm transition-transform ${qty >= stock ? 'bg-slate-700 text-slate-500' : 'text-[#0F172A] bg-[#84CC16] active:scale-95'}`}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleQuantityChange(activeStoreId, item, 1)} 
                      disabled={stock <= 0}
                      className={`w-full py-2.5 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2 shadow-sm ${stock <= 0 ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-600 active:bg-slate-500 text-white'}`}
                    >
                      <Plus size={14} /> {stock <= 0 ? 'Out of Stock' : 'Add to Order'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {activeProducts.length === 0 && activeStoreId && (
          <div className="col-span-2 text-center py-10 text-slate-500">
            No products available in this stall.
          </div>
        )}
      </div>

      {/* Cart / Footer */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#0F172A] via-[#0F172A] to-transparent pointer-events-none z-50">
          <div className="bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-4 flex items-center justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.5)] pointer-events-auto transform transition-all duration-300">
            <div className="flex flex-col relative">
              <span className="text-slate-400 text-xs font-medium mb-0.5">Total Amount</span>
              <div className="flex items-baseline gap-2">
                <span className="text-white font-black text-2xl leading-none">₱{cartTotal.toFixed(2)}</span>
              </div>
              <div className="absolute -top-6 -left-2 bg-[#84CC16] text-[#0F172A] text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                <ShoppingCart size={10} /> {cartCount} items
              </div>
            </div>
            
            <button 
              onClick={() => setCheckoutOpen(true)}
              className="px-5 py-3.5 bg-[#84CC16] hover:bg-[#65a30d] active:scale-95 text-[#0F172A] rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#84CC16]/20"
            >
              <span>View Cart</span>
              <ChevronRight size={18} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}

      {/* Custom Checkout Modal for Court Orders */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <h2 className="text-lg font-bold text-white">Review Order</h2>
              <button type="button" className="text-slate-400 hover:text-white text-xl" onClick={() => setCheckoutOpen(false)}>
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {Object.values(cartGroups).map((g) => (
                <div key={g.storeId} className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                  <div className="text-xs font-bold text-[#84CC16] mb-2">{g.storeName}</div>
                  {g.items.map((it, i) => (
                    <div key={i} className="flex justify-between text-sm text-slate-300 mb-1">
                      <span>{it.quantity}× {it.name}</span>
                      <span className="font-medium text-white">₱{it.lineTotal?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ))}

              <div className="border-t border-slate-800 pt-3">
                <div className="flex justify-between text-white font-bold text-lg">
                  <span>Total Amount</span>
                  <span className="text-[#84CC16]">₱{cartTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-800">
                <p className="text-xs text-amber-300/90 leading-relaxed">
                  Please enter your name. This order will be sent to <strong>{booking.playerName}</strong> for approval before it goes to the kitchen.
                </p>
                <input
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-[#84CC16] outline-none transition-colors"
                  placeholder="Your Name *"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </div>

              <div className="pt-4">
                <button
                  type="button"
                  className="w-full py-4 bg-[#84CC16] hover:bg-[#65a30d] text-[#0F172A] font-bold text-lg rounded-xl disabled:opacity-60 transition-colors shadow-lg"
                  disabled={submitting}
                  onClick={handleSubmitOrder}
                >
                  {submitting ? "Sending..." : "Submit for Approval"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
