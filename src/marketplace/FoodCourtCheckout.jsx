import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";
import { createFoodCourtOrder, markCustomerOrderPaid } from "../services/marketplace/customerOrdersService";
import {
  CUSTOMER_TYPE,
  PAYMENT_MODE,
  DISPATCH_STATUS,
  ORDER_SOURCE,
} from "./constants";
import { roundMoney } from "../lib/bookingMoney";
import {
  Banknote,
  QrCode,
  ScanLine,
  CheckCircle2,
  ArrowLeft,
  Smartphone,
  Scan
} from "lucide-react";

export default function FoodCourtCheckout({
  open,
  onClose,
  cartGroups,
  subtotal,
  serviceFee,
  grandTotal,
  user,
  profile,
  booking,
  onSuccess,
}) {
  const isRegistered = !!user;
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  // New States
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODE.CASH);
  const [step, setStep] = useState("checkout"); // 'checkout', 'cash_success', 'gcash_paymongo', 'gcash_success'
  const [submitting, setSubmitting] = useState(false);
  
  // PayMongo States
  const [paymongoQrImageUrl, setPaymongoQrImageUrl] = useState(null);
  const [paymongoPaymentId, setPaymongoPaymentId] = useState(null);
  const [paymongoStatus, setPaymongoStatus] = useState("loading");
  const [placedOrderId, setPlacedOrderId] = useState(null);
  const pollingRef = useRef(null);

  const displayName =
    profile?.name || profile?.fullName || user?.displayName || guestName || "Guest";

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setStep("checkout");
      setPaymentMode(PAYMENT_MODE.CASH);
      setSubmitting(false);
      setPaymongoQrImageUrl(null);
      setPaymongoPaymentId(null);
      setPaymongoStatus("loading");
      setPlacedOrderId(null);
    }
  }, [open]);

  // Polling PayMongo Status
  useEffect(() => {
    if (step === "gcash_paymongo" && paymongoStatus === "pending" && paymongoPaymentId) {
      pollingRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/check-status/${paymongoPaymentId}`);
          if (response.ok) {
            const data = await response.json();
            if (data.status === "paid") {
              setPaymongoStatus("paid");
              clearInterval(pollingRef.current);

              if (placedOrderId) {
                markCustomerOrderPaid(placedOrderId).catch(console.error);
              }
              
              // Silent print via local kiosk print server
              const itemsList = [];
              Object.values(cartGroups).forEach(g => {
                g.items.forEach(it => {
                  itemsList.push({ name: it.name, quantity: it.quantity, lineTotal: it.lineTotal });
                });
              });

              fetch('http://127.0.0.1:3002/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId: placedOrderId || 'Unknown',
                  customerName: displayName,
                  items: itemsList,
                  total: grandTotal
                })
              }).then(res => {
                if (!res.ok) console.warn('Kiosk print server returned error');
              }).catch(err => {
                console.warn('Kiosk print server not reachable:', err.message);
              });

              setTimeout(() => {
                onSuccess?.();
              }, 2000);
            }
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 3000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [step, paymongoStatus, paymongoPaymentId, cartGroups, grandTotal, displayName, placedOrderId]);

  if (!open) return null;



  async function executeOrderPlacement(mode, skipSuccess = false) {
    setSubmitting(true);
    try {
      const result = await createFoodCourtOrder({
        storeGroups: cartGroups,
        customerType: isRegistered ? CUSTOMER_TYPE.REGISTERED : CUSTOMER_TYPE.GUEST,
        paymentMode: mode,
        customerName: isRegistered ? displayName : guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        userId: user?.uid || null,
        userEmail: user?.email || profile?.email || null,
        bookingId: booking?.id || null,
        courtId: booking?.courtId || null,
        courtName: booking?.courtName || null,
        orderSource: booking?.id ? ORDER_SOURCE.COURT_QR : ORDER_SOURCE.FOODCOURT,
      });
      if (!skipSuccess) {
        onSuccess?.(result);
      }
      return result;
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Could not place order");
      throw e;
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePlaceOrderClick() {
    if (!Object.keys(cartGroups).length) {
      toast.error("Cart is empty");
      return;
    }
    if (!isRegistered && !guestName.trim()) {
      toast.error("Please enter your name");
      return;
    }

    if (paymentMode === PAYMENT_MODE.CASH) {
      try {
        await executeOrderPlacement(PAYMENT_MODE.CASH);
        setStep("cash_success");
      } catch (e) {
        // error handled in executeOrderPlacement
      }
    } else if (paymentMode === PAYMENT_MODE.GCASH) {
      setStep("gcash_paymongo");
      setPaymongoStatus("loading");
      
      try {
        const orderResult = await executeOrderPlacement(PAYMENT_MODE.GCASH, true);
        const orderId = orderResult?.customerOrderId || orderResult?.id || "unknown";
        setPlacedOrderId(orderId);

        const response = await fetch('/api/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Math.round(grandTotal * 100), orderId: orderId })
        });
        
        const data = await response.json();
        if (!response.ok) {
          const errMsg = typeof data.error === 'object' ? JSON.stringify(data.error) : data.error;
          throw new Error(errMsg || "PayMongo Error");
        }

        setPaymongoQrImageUrl(data.qrImageUrl);
        setPaymongoPaymentId(data.paymentId);
        setPaymongoStatus("pending");
      } catch (e) {
        console.error(e);
        setPaymongoStatus("error");
      }
    }
  }

  const renderCheckout = () => (
    <>
      <div className="p-4 space-y-4">
        {Object.values(cartGroups).map((g) => (
          <div key={g.storeId} className="mkp-cart-group">
            <div className="text-xs font-bold text-cyan-400 mb-1">{g.storeName}</div>
            {g.items.map((it, i) => (
              <div key={i} className="flex justify-between text-sm text-slate-300">
                <span>
                  {it.quantity}× {it.name}
                </span>
                <span>₱{it.lineTotal?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="text-sm space-y-1 border-t border-slate-800 pt-3">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal</span>
            <span>₱{roundMoney(subtotal).toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-white font-bold text-lg">
            <span>Total</span>
            <span className="text-emerald-400">₱{roundMoney(grandTotal).toFixed(2)}</span>
          </div>
        </div>

        {isRegistered ? (
          <div className="space-y-2 pb-2">
            <p className="text-xs text-cyan-300">
              Signed in as <strong>{displayName}</strong>
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-2 border-b border-slate-800 mb-4">
            <p className="text-xs text-amber-300/90">
              Please enter your details for the receipt.
            </p>
            <input
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-cyan-500 outline-none transition-colors"
              placeholder="Your name *"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
            <input
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:border-cyan-500 outline-none transition-colors"
              placeholder="Phone (optional)"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
            />
          </div>
        )}

        {/* PAYMENT OPTIONS - Vertical Stack */}
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">Payment Method</h3>

          <button
            type="button"
            className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-300 ${paymentMode === PAYMENT_MODE.CASH
                ? "border-cyan-500 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                : "border-slate-700 bg-slate-900/50 hover:bg-slate-800"
              }`}
            onClick={() => setPaymentMode(PAYMENT_MODE.CASH)}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${paymentMode === PAYMENT_MODE.CASH ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"
              }`}>
              <Banknote size={24} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-white text-base mb-0.5">Cash</div>
              <div className="text-xs text-slate-400">Pay at cashier - Receipt will be provided at counter</div>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${paymentMode === PAYMENT_MODE.CASH ? "border-cyan-400" : "border-slate-600"
              }`}>
              {paymentMode === PAYMENT_MODE.CASH && <div className="w-3 h-3 bg-cyan-400 rounded-full" />}
            </div>
          </button>

          <button
            type="button"
            className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all duration-300 ${paymentMode === PAYMENT_MODE.GCASH
                ? "border-cyan-500 bg-cyan-500/10 shadow-[0_0_15px_rgba(34,211,238,0.15)]"
                : "border-slate-700 bg-slate-900/50 hover:bg-slate-800"
              }`}
            onClick={() => setPaymentMode(PAYMENT_MODE.GCASH)}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${paymentMode === PAYMENT_MODE.GCASH ? "bg-[#007DFE] text-white" : "bg-slate-800 text-slate-400"
              }`}>
              <QrCode size={24} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-white text-base mb-0.5">GCash</div>
              <div className="text-xs text-slate-400">Scan QR or show your GCash QR - Receipt will be printed</div>
            </div>
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${paymentMode === PAYMENT_MODE.GCASH ? "border-cyan-400" : "border-slate-600"
              }`}>
              {paymentMode === PAYMENT_MODE.GCASH && <div className="w-3 h-3 bg-cyan-400 rounded-full" />}
            </div>
          </button>
        </div>

        <div className="pt-4">
          <button
            type="button"
            className="w-full py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-lg rounded-xl disabled:opacity-60 transition-colors shadow-lg"
            disabled={submitting}
            onClick={handlePlaceOrderClick}
          >
            {submitting ? "Processing…" : "Place order"}
          </button>
        </div>
      </div>
    </>
  );

  const renderCashSuccess = () => (
    <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500 min-h-[400px]">
      <div className="w-24 h-24 bg-cyan-500/20 rounded-full flex items-center justify-center mb-6">
        <CheckCircle2 size={48} className="text-cyan-400" />
      </div>
      <h3 className="text-2xl font-bold text-white mb-4">Order Confirmed!</h3>
      <p className="text-slate-300 mb-8 max-w-[280px]">
        Please proceed to the cashier to complete your payment. Your receipt will be provided at the counter.
      </p>
      <button
        onClick={onClose}
        className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors border border-slate-700 w-full"
      >
        Close
      </button>
    </div>
  );

  const renderGCashPaymongo = () => (
    <div className="p-6 flex flex-col items-center animate-in slide-in-from-right-8 duration-300 min-h-[400px]">
      <div className="w-full flex items-center mb-6">
        {paymongoStatus === 'error' && (
          <button onClick={() => setStep("checkout")} className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </button>
        )}
        <h3 className="flex-1 text-center text-xl font-bold text-white mr-8">GCash Payment</h3>
      </div>

      {paymongoStatus === 'loading' && (
        <div className="flex flex-col items-center justify-center flex-1 py-10">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#007DFE] mb-4"></div>
          <p className="text-slate-300">Initializing secure payment...</p>
        </div>
      )}

      {paymongoStatus === 'pending' && paymongoQrImageUrl && (
        <div className="flex flex-col items-center justify-center flex-1 w-full">
          <p className="text-slate-300 text-center mb-6">
            Open GCash app and scan to pay <strong className="text-emerald-400">₱{roundMoney(grandTotal).toFixed(2)}</strong>
          </p>

          <div className="bg-white p-4 rounded-3xl shadow-[0_0_30px_rgba(0,125,254,0.3)] mb-8">
            <img 
              src={paymongoQrImageUrl} 
              alt="QR Code" 
              className="w-[200px] h-[200px] object-contain"
            />
          </div>

          <p className="text-sm text-slate-400 animate-pulse text-center">
            Waiting for payment...
          </p>
        </div>
      )}

      {paymongoStatus === 'error' && (
        <div className="flex flex-col items-center justify-center flex-1 py-10">
          <p className="text-red-400 mb-2">Payment initialization failed.</p>
          <p className="text-slate-400 text-sm">Please try again or use cash.</p>
        </div>
      )}
      
      {paymongoStatus === 'paid' && (
        <div className="flex flex-col items-center justify-center flex-1 py-10">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>
          <p className="text-emerald-400 font-bold text-xl">Payment Verified</p>
        </div>
      )}
    </div>
  );

  const renderGCashSuccess = () => (
    <div className="p-8 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500 min-h-[400px]">
      <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6">
        <CheckCircle2 size={48} className="text-emerald-400" />
      </div>
      <h3 className="text-2xl font-bold text-white mb-2">Payment Successful!</h3>
      <p className="text-slate-300 mb-8 max-w-[280px]">
        Your receipt is being printed below. Please take it and wait for your order to be called.
      </p>

      {/* Mock Receipt Animation */}
      <div className="w-32 h-20 bg-slate-100 rounded-t-sm shadow-inner mb-8 relative overflow-hidden animate-[slide-up_1s_ease-out_forwards]">
        <div className="w-full h-full flex flex-col pt-2 px-2 gap-1 opacity-50">
          <div className="h-1 bg-slate-300 w-full" />
          <div className="h-1 bg-slate-300 w-3/4" />
          <div className="h-1 bg-slate-300 w-5/6" />
        </div>
      </div>

      <button
        onClick={onClose}
        className="px-8 py-3 bg-[#007DFE] hover:bg-[#0066cc] text-white font-bold rounded-xl transition-colors border-none w-full shadow-lg"
      >
        Finish
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl relative">
        {step === "checkout" && (
          <div className="p-4 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900 z-10">
            <h2 className="text-lg font-bold text-white">Checkout</h2>
            <button type="button" className="text-slate-400 hover:text-white text-xl" onClick={onClose}>
              ✕
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto hide-scrollbar">
          {step === "checkout" && renderCheckout()}
          {step === "cash_success" && renderCashSuccess()}
          {step === "gcash_paymongo" && renderGCashPaymongo()}
          {step === "gcash_success" && renderGCashSuccess()}
        </div>
      </div>

      {/* Global styles for animations since index.css might not have them */}
      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); }
          50% { transform: translateY(180px); }
          100% { transform: translateY(0); }
        }
        @keyframes slide-up {
          0% { transform: translateY(100%); }
          100% { transform: translateY(0); }
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
