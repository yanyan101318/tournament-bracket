import { useState } from "react";
import toast from "react-hot-toast";
import { createFoodCourtOrder } from "../services/marketplace/customerOrdersService";
import {
  CUSTOMER_TYPE,
  PAYMENT_MODE,
  DISPATCH_STATUS,
  ORDER_SOURCE,
} from "./constants";
import { roundMoney } from "../lib/bookingMoney";

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
  const [paymentMode, setPaymentMode] = useState(PAYMENT_MODE.PAY_NOW);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const displayName =
    profile?.name || profile?.fullName || user?.displayName || guestName || "Guest";

  async function handlePlaceOrder() {
    if (!Object.keys(cartGroups).length) {
      toast.error("Cart is empty");
      return;
    }
    if (!isRegistered && !guestName.trim()) {
      toast.error("Please enter your name");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createFoodCourtOrder({
        storeGroups: cartGroups,
        customerType: isRegistered ? CUSTOMER_TYPE.REGISTERED : CUSTOMER_TYPE.GUEST,
        paymentMode: isRegistered ? paymentMode : PAYMENT_MODE.PAY_NOW,
        customerName: isRegistered ? displayName : guestName.trim(),
        guestPhone: guestPhone.trim() || null,
        userId: user?.uid || null,
        userEmail: user?.email || profile?.email || null,
        bookingId: booking?.id || null,
        courtId: booking?.courtId || null,
        courtName: booking?.courtName || null,
        orderSource: booking?.id ? ORDER_SOURCE.COURT_QR : ORDER_SOURCE.FOODCOURT,
      });

      if (result.dispatchStatus === DISPATCH_STATUS.DISPATCHED) {
        toast.success("Order sent to vendors! Charged to your account.");
      } else {
        toast.success("Order placed! Pay at the admin counter to send to kitchens.");
      }
      onSuccess?.(result);
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900 z-10">
          <h2 className="text-lg font-bold text-white">Checkout</h2>
          <button type="button" className="text-slate-400 hover:text-white text-xl" onClick={onClose}>
            ✕
          </button>
        </div>

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
            <div className="flex justify-between text-slate-400">
              <span>Service fee</span>
              <span>₱{roundMoney(serviceFee).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-white font-bold text-lg">
              <span>Total</span>
              <span className="text-emerald-400">₱{roundMoney(grandTotal).toFixed(2)}</span>
            </div>
          </div>

          {isRegistered ? (
            <div className="space-y-2">
              <p className="text-xs text-cyan-300">
                Signed in as <strong>{displayName}</strong>
              </p>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="payMode"
                  checked={paymentMode === PAYMENT_MODE.PAY_NOW}
                  onChange={() => setPaymentMode(PAYMENT_MODE.PAY_NOW)}
                />
                <div>
                  <div className="font-semibold text-white text-sm">Pay now</div>
                  <div className="text-xs text-slate-500">Pay at counter before vendors prepare</div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5 cursor-pointer">
                <input
                  type="radio"
                  name="payMode"
                  checked={paymentMode === PAYMENT_MODE.PAY_LATER}
                  onChange={() => setPaymentMode(PAYMENT_MODE.PAY_LATER)}
                />
                <div>
                  <div className="font-semibold text-white text-sm">Pay later</div>
                  <div className="text-xs text-slate-500">Sent to vendors now · settle at admin POS</div>
                </div>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-amber-300/90">
                Guest orders must be paid at the counter before vendors receive them.
              </p>
              <input
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm"
                placeholder="Your name *"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
              <input
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm"
                placeholder="Phone (optional)"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
              />
            </div>
          )}

          <button
            type="button"
            className="w-full py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-xl disabled:opacity-60"
            disabled={submitting}
            onClick={handlePlaceOrder}
          >
            {submitting ? "Placing order…" : "Place order"}
          </button>
        </div>
      </div>
    </div>
  );
}
