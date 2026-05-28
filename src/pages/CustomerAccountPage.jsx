import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../auth/AuthContext";
import {
  subscribeCustomerBalance,
  subscribePayLaterOrders,
} from "../services/marketplace/customerBalanceService";
import { FOODCOURT_PATH } from "../marketplace/constants";
import { roundMoney } from "../lib/bookingMoney";
import "../marketplace/marketplace.css";

export default function CustomerAccountPage() {
  const { user, profile } = useAuth();
  const [balance, setBalance] = useState({ outstandingBalance: 0, payLaterOrderIds: [] });
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    document.title = "My Account | Food Court";
    if (!user?.uid) return undefined;
    const u1 = subscribeCustomerBalance(user.uid, setBalance);
    const u2 = subscribePayLaterOrders(user.uid, setOrders);
    return () => {
      u1();
      u2();
    };
  }, [user?.uid]);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <p className="text-slate-400 mb-4">Sign in to view your food court account.</p>
        <Link to="/login" className="text-cyan-400 font-bold">
          Sign in
        </Link>
      </div>
    );
  }

  const name = profile?.name || profile?.fullName || user.email;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 p-4">
        <div className="max-w-lg mx-auto flex justify-between items-center">
          <h1 className="text-lg font-bold text-white">My account</h1>
          <Link to={FOODCOURT_PATH} className="text-sm text-cyan-400">
            Order food
          </Link>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-6">
        <p className="text-slate-400 text-sm">Hello, {name}</p>

        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
          <div className="text-xs text-slate-500 uppercase font-bold mb-1">Outstanding balance</div>
          <div className="text-3xl font-bold text-emerald-400 font-mono">
            ₱{roundMoney(balance.outstandingBalance).toFixed(2)}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Pay later orders are settled at the admin counter.
          </p>
          {balance.outstandingBalance > 0 && (
            <p className="text-xs text-amber-400 mt-3">
              Show this screen at the counter and tap &quot;Pay all balance&quot; when staff is ready.
            </p>
          )}
        </div>

        <div>
          <h2 className="font-bold text-white mb-3">Pay-later orders</h2>
          {orders.length === 0 ? (
            <p className="text-slate-500 text-sm">No open pay-later orders.</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="mkp-cart-group">
                  <div className="flex justify-between">
                    <span className="text-sm font-semibold text-white">#{o.id.slice(0, 8)}</span>
                    <span className="text-emerald-400 font-mono">₱{roundMoney(o.grandTotal).toFixed(2)}</span>
                  </div>
                  {(o.storeBreakdown || []).map((b) => (
                    <div key={b.storeId} className="text-xs text-slate-500 mt-1">
                      {b.storeName} — ₱{roundMoney(b.subtotal).toFixed(2)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <Link
          to={FOODCOURT_PATH}
          className="block w-full py-3 text-center bg-cyan-500 text-slate-950 font-bold rounded-xl"
        >
          Browse food court
        </Link>
      </main>
    </div>
  );
}
