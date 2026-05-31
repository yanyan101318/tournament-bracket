import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { validateVendorToken } from "../services/marketplace/storesService";
import {
  subscribeStoreProducts,
  saveStoreProduct,
  deleteStoreProduct,
} from "../services/marketplace/storeProductsService";
import {
  subscribeVendorOrders,
  updateVendorOrderStatus,
} from "../services/marketplace/customerOrdersService";
import { getStoreSalesSummary } from "../services/marketplace/settlementService";
import { VENDOR_ORDER_STATUS, VENDOR_ORDER_STATUS_LABELS } from "../marketplace/constants";
import { roundMoney } from "../lib/bookingMoney";
import "../marketplace/marketplace.css";

const BLANK_PRODUCT = {
  name: "",
  description: "",
  category: "",
  price: "",
  stock: "",
  prepTimeMinutes: "15",
  available: true,
  existingImage: "",
  imageFile: null,
};

const STATUS_FLOW = [
  VENDOR_ORDER_STATUS.PENDING,
  VENDOR_ORDER_STATUS.ACCEPTED,
  VENDOR_ORDER_STATUS.PREPARING,
  VENDOR_ORDER_STATUS.READY,
  VENDOR_ORDER_STATUS.COMPLETED,
];

function playNewOrderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    o.stop(ctx.currentTime + 0.15);
  } catch {
    /* ignore */
  }
}

export default function VendorPortal() {
  const { storeId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [auth, setAuth] = useState({ loading: true, store: null, error: null });
  const [tab, setTab] = useState("orders");
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [productModal, setProductModal] = useState(null);
  const [productForm, setProductForm] = useState(BLANK_PRODUCT);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [orderPage, setOrderPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const prevOrderCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await validateVendorToken(storeId, token);
      if (cancelled) return;
      if (!res.ok) setAuth({ loading: false, store: null, error: res.error });
      else {
        setAuth({ loading: false, store: res.store, error: null });
        const s = await getStoreSalesSummary(storeId);
        if (!cancelled) setSummary(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, token]);

  useEffect(() => {
    if (!auth.store) return undefined;
    return subscribeStoreProducts(storeId, setProducts);
  }, [auth.store, storeId]);

  useEffect(() => {
    if (!auth.store) return undefined;
    return subscribeVendorOrders(storeId, (list) => {
      const pending = list.filter((o) => o.status === VENDOR_ORDER_STATUS.PENDING);
      if (list.length > prevOrderCount.current && pending.length > 0) {
        playNewOrderSound();
        toast.success("New order received!");
      }
      prevOrderCount.current = list.length;
      setOrders(list);
    });
  }, [auth.store, storeId]);

  async function saveProduct(e) {
    e.preventDefault();
    try {
      await saveStoreProduct(
        storeId,
        productModal?.product?.id,
        {
          ...productForm,
          existingImage: productForm.existingImage,
        },
        productForm.imageFile
      );
      toast.success("Product saved");
      setProductModal(null);
    } catch (err) {
      toast.error(err.message || "Save failed");
    }
  }

  if (auth.loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (auth.error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <h1 className="text-xl font-bold text-red-400 mb-2">Access denied</h1>
        <p className="text-slate-400">{auth.error}</p>
      </div>
    );
  }

  const store = auth.store;
  const todayPending = orders.filter((o) => o.status === VENDOR_ORDER_STATUS.PENDING).length;
  const ORDER_PAGE_SIZE = 10;

  // Active orders exclude completed ones (completed moved to History)
  const activeOrders = orders.filter((o) => o.status !== VENDOR_ORDER_STATUS.COMPLETED);
  const orderTotalPages = Math.max(1, Math.ceil(activeOrders.length / ORDER_PAGE_SIZE));
  const orderPageIndex = Math.min(orderPage, orderTotalPages);
  const orderRows = activeOrders.slice((orderPageIndex - 1) * ORDER_PAGE_SIZE, orderPageIndex * ORDER_PAGE_SIZE);

  // History (completed orders) listing
  const historyOrdersAll = orders
    .filter((o) => o.status === VENDOR_ORDER_STATUS.COMPLETED)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  const historyFiltered = historyOrdersAll.filter((o) => {
    const q = historySearch.trim().toLowerCase();
    if (q) {
      if (!((o.customerName || "").toLowerCase().includes(q) || (o.id || "").toLowerCase().includes(q))) return false;
    }
    if (historyFrom) {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      if (!d || d < new Date(historyFrom)) return false;
    }
    if (historyTo) {
      const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      // include entire day for 'to' by adding 1 day
      if (!d || d > new Date(new Date(historyTo).setHours(23, 59, 59, 999))) return false;
    }
    return true;
  });

  const historyTotalPages = Math.max(1, Math.ceil(historyFiltered.length / ORDER_PAGE_SIZE));
  const historyPageIndex = Math.min(historyPage, historyTotalPages);
  const historyRows = historyFiltered.slice((historyPageIndex - 1) * ORDER_PAGE_SIZE, historyPageIndex * ORDER_PAGE_SIZE);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 bg-slate-900/90 p-4 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          {store.logoUrl && <img src={store.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover" />}
          <div>
            <h1 className="font-bold text-white">{store.name}</h1>
            <p className="text-xs text-slate-500">Vendor portal</p>
          </div>
        </div>
        <div className="max-w-3xl mx-auto flex gap-2 mt-3">
          {["dashboard", "orders", "history", "products"].map((t) => (
            <button
              key={t}
              type="button"
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize ${tab === t ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "orders" && todayPending > 0 && (
                <span className="ml-1 bg-red-500 text-white px-1.5 rounded-full">{todayPending}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 pb-24">
        {tab === "dashboard" && summary && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Today orders</div>
              <div className="text-2xl font-bold text-white">{summary.orderCount}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Gross sales</div>
              <div className="text-2xl font-bold text-emerald-400">₱{summary.totalSales.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Commission</div>
              <div className="text-xl font-bold text-amber-400">₱{summary.commission.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500">Net earnings</div>
              <div className="text-xl font-bold text-cyan-400">₱{summary.net.toFixed(2)}</div>
            </div>
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-3">
            {activeOrders.length === 0 && (
              <p className="text-center text-slate-500 py-12">No active orders.</p>
            )}
            {orderRows.map((order) => (
              <div key={order.id} className="mkp-vendor-order-card p-3 bg-slate-900 border border-slate-800 rounded-xl">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="text-xs text-slate-500">#{order.id.slice(0, 6).toUpperCase()}</div>
                        <div className="font-bold text-white">{order.courtName}</div>
                        <div className="text-sm text-slate-400">{order.customerName}</div>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                          order.paymentBadge === "PAID"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : order.paymentBadge === "ACCOUNT_CHARGE"
                              ? "bg-violet-500/20 text-violet-300"
                              : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {order.paymentBadge || (order.paymentStatus === "paid" ? "PAID" : "PENDING")}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 mb-2">
                      {order.createdAt?.toDate
                        ? format(order.createdAt.toDate(), "MMM d, h:mm a")
                        : "—"}
                    </div>
                    <ul className="text-sm space-y-1 mb-2">
                      {(order.items || []).map((it, i) => (
                        <li key={i} className="flex justify-between">
                          <span>{it.quantity}× {it.name}</span>
                          <span>₱{roundMoney(it.lineTotal).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                    {order.specialNotes && (
                      <p className="text-xs text-amber-200/80 mb-2">Note: {order.specialNotes}</p>
                    )}
                    <div className="text-sm font-semibold text-cyan-400 mb-2">
                      {VENDOR_ORDER_STATUS_LABELS[order.status] || order.status}
                    </div>
                  </div>

                  {/* Actions sidebar: vertical */}
                  <div className="w-full sm:w-44 flex-shrink-0 flex flex-col items-stretch gap-2">
                    {(() => {
                      const visibleStatuses = STATUS_FLOW.filter((st) => st !== VENDOR_ORDER_STATUS.ACCEPTED && st !== VENDOR_ORDER_STATUS.READY);
                      return visibleStatuses.map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={order.status === st}
                          className="text-sm px-3 py-2 rounded-lg bg-slate-800 hover:bg-cyan-500/10 disabled:opacity-40 text-left"
                          onClick={() => updateVendorOrderStatus(storeId, order.id, st).then(() => toast.success("Status updated"))}
                        >
                          {VENDOR_ORDER_STATUS_LABELS[st]}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            ))}

            {orderTotalPages > 1 && (
              <div className="flex justify-end items-center gap-2 mt-4">
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                  disabled={orderPageIndex <= 1}
                  onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="text-xs text-slate-400">
                  Page {orderPageIndex} of {orderTotalPages}
                </span>
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                  disabled={orderPageIndex >= orderTotalPages}
                  onClick={() => setOrderPage((p) => Math.min(orderTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2 items-center">
              <input
                type="search"
                placeholder="Search order number or customer"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm"
                value={historySearch}
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
              />
              <input type="date" className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm" value={historyFrom} onChange={(e) => { setHistoryFrom(e.target.value); setHistoryPage(1); }} />
              <input type="date" className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm" value={historyTo} onChange={(e) => { setHistoryTo(e.target.value); setHistoryPage(1); }} />
            </div>

            {historyFiltered.length === 0 && (
              <p className="text-center text-slate-500 py-8">No completed orders found.</p>
            )}

            {historyRows.map((order) => (
              <div key={order.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-xs text-slate-500">#{order.id.slice(0, 6).toUpperCase()}</div>
                    <div className="font-bold text-white">{order.customerName}</div>
                    <div className="text-sm text-slate-400">{order.storeName || order.courtName}</div>
                  </div>
                  <div className="text-xs text-slate-500 text-right">
                    {order.createdAt?.toDate ? format(order.createdAt.toDate(), "MMM d, yyyy h:mm a") : "—"}
                  </div>
                </div>
                <ul className="text-sm space-y-1 mb-2">
                  {(order.items || []).map((it, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{it.quantity}× {it.name}</span>
                      <span>₱{roundMoney(it.lineTotal).toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between items-center text-sm text-slate-400">
                  <div>Total: ₱{(order.subtotal || order.totalAmount || 0).toFixed ? (order.subtotal || order.totalAmount || 0).toFixed(2) : order.subtotal}</div>
                  <div className="text-xs font-semibold text-cyan-400">{VENDOR_ORDER_STATUS_LABELS[order.status] || order.status}</div>
                </div>
              </div>
            ))}

            {historyTotalPages > 1 && (
              <div className="flex justify-end items-center gap-2 mt-4">
                <button type="button" className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50" disabled={historyPageIndex <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}>Previous</button>
                <span className="text-xs text-slate-400">Page {historyPageIndex} of {historyTotalPages}</span>
                <button type="button" className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50" disabled={historyPageIndex >= historyTotalPages} onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}>Next</button>
              </div>
            )}
          </div>
        )}

        {tab === "products" && (
          <>
            <button
              type="button"
              className="mb-4 w-full py-2 bg-cyan-500 text-slate-950 font-bold rounded-xl"
              onClick={() => {
                setProductForm(BLANK_PRODUCT);
                setProductModal({ mode: "add" });
              }}
            >
              + Add product
            </button>
            <div className="mkp-product-grid">
              {products.map((p) => (
                <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                  <div className="font-semibold text-white text-sm">{p.name}</div>
                  <div className="text-emerald-400 text-sm">₱{Number(p.price || 0).toFixed(2)}</div>
                  <div className="text-[10px] text-slate-500 mt-1">Stock: {p.stock ?? 0}</div>
                  <div className="flex gap-1 mt-2">
                    <button
                      type="button"
                      className="text-xs text-cyan-400"
                      onClick={() => {
                        setProductForm({
                          name: p.name || "",
                          description: p.description || "",
                          category: p.category || "",
                          price: String(p.price ?? ""),
                          stock: String(p.stock ?? ""),
                          prepTimeMinutes: String(p.prepTimeMinutes ?? 15),
                          available: p.available !== false,
                          existingImage: p.productImage || "",
                          imageFile: null,
                        });
                        setProductModal({ mode: "edit", product: p });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-400"
                      onClick={() => setDeleteConfirm(p)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">Delete product?</h3>
            <p className="text-sm text-slate-300">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 py-2 bg-slate-800 rounded-lg"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 py-2 bg-red-500 text-white rounded-lg"
                onClick={async () => {
                  try {
                    await deleteStoreProduct(storeId, deleteConfirm.id);
                    toast.success("Product deleted");
                  } catch (err) {
                    toast.error(err.message || "Delete failed");
                  } finally {
                    setDeleteConfirm(null);
                  }
                }}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
      {productModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4">
          <form className="bg-slate-900 border border-slate-700 rounded-2xl p-4 w-full max-w-md space-y-3" onSubmit={saveProduct}>
            <h3 className="font-bold text-white">{productModal.mode === "add" ? "Add product" : "Edit product"}</h3>
            <input className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm" placeholder="Name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required />
            <textarea className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm" placeholder="Description" rows={2} value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm" placeholder="Price" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} required />
              <input type="number" className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-sm" placeholder="Stock" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
            </div>
            <input type="file" accept="image/*" onChange={(e) => setProductForm({ ...productForm, imageFile: e.target.files?.[0] || null })} />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={productForm.available} onChange={(e) => setProductForm({ ...productForm, available: e.target.checked })} />
              Available
            </label>
            <div className="flex gap-2">
              <button type="button" className="flex-1 py-2 bg-slate-800 rounded-lg" onClick={() => setProductModal(null)}>Cancel</button>
              <button type="submit" className="flex-1 py-2 bg-cyan-500 text-slate-950 font-bold rounded-lg">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
