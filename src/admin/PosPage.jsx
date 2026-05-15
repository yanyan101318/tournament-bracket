import { useState, useEffect, useMemo, useCallback } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  writeBatch,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { db } from "../firebase";
import toast from "react-hot-toast";
import { buildReceiptHtml, formatReceiptCurrency, printReceiptHtml } from "./posReceipt";
import Pagination from "./Pagination";

function productStock(p) {
  const n = p?.stock ?? p?.quantity ?? p?.qty;
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function productPrice(p) {
  const v = Number(p?.price ?? p?.salePrice ?? 0);
  return Number.isFinite(v) ? v : 0;
}

const BLANK_PRODUCT_FORM = {
  name: "",
  category: "",
  price: "",
  stock: "",
};

export default function PosPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cashReceived, setCashReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const [productModal, setProductModal] = useState(null);
  const [productForm, setProductForm] = useState(BLANK_PRODUCT_FORM);
  const { syncState, wrapSync } = useOfflineSync();
  const [productPage, setProductPage] = useState(1);
  const PRODUCT_PAGE_SIZE = 10;

  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setProducts(snap.docs.map((d) => ({ id: d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Could not load products. Add an index on products.name if prompted.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const categories = useMemo(() => {
    const s = new Set();
    for (const p of products) {
      const c = (p.category || "").trim();
      if (c) s.add(c);
    }
    return ["All", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const catOk = category === "All" || (p.category || "").trim() === category;
      if (!catOk) return false;
      if (!q) return true;
      const name = (p.name || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      return name.includes(q) || cat.includes(q);
    });
  }, [products, search, category]);

  const productTotalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE));
  const productSafePage = Math.min(productPage, productTotalPages);
  const pageProducts = filteredProducts.slice((productSafePage - 1) * PRODUCT_PAGE_SIZE, productSafePage * PRODUCT_PAGE_SIZE);

  function handleProductSearch(v) { setSearch(v); setProductPage(1); }
  function handleProductCategory(c) { setCategory(c); setProductPage(1); }

  const cartLines = useMemo(() => {
    const lines = [];
    for (const [id, qty] of Object.entries(cart)) {
      if (qty <= 0) continue;
      const p = products.find((x) => x.id === id);
      if (!p) continue;
      const stock = productStock(p);
      const safeQty = Math.min(qty, stock);
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

  const changeDue = useMemo(() => {
    const cash = Number(cashReceived);
    if (!Number.isFinite(cash) || paymentMethod !== "Cash") return 0;
    return roundMoney(Math.max(0, cash - cartTotal));
  }, [cashReceived, cartTotal, paymentMethod]);

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

  const removeLine = useCallback((productId) => {
    setCart((c) => {
      const n = { ...c };
      delete n[productId];
      return n;
    });
  }, []);

  function openNewProduct() {
    setProductForm(BLANK_PRODUCT_FORM);
    setProductModal("new");
  }

  function openEditProduct(p) {
    setProductForm({
      name: p.name || "",
      category: (p.category || "").trim(),
      price: productPrice(p) ? String(productPrice(p)) : "",
      stock: productStock(p) ? String(productStock(p)) : "",
    });
    setProductModal(p.id);
  }

  async function saveProduct(e) {
    e.preventDefault();
    const name = productForm.name.trim();
    const category = productForm.category.trim();
    const price = Math.max(0, Number(productForm.price) || 0);
    const stock = Math.max(0, Math.floor(Number(productForm.stock) || 0));
    if (!name) {
      toast.error("Product name is required");
      return;
    }
    try {
      let promise;
      if (productModal === "new") {
        promise = addDoc(collection(db, "products"), {
          name,
          category,
          price,
          stock,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (productModal) {
        promise = updateDoc(doc(db, "products", productModal), {
          name,
          category,
          price,
          stock,
          updatedAt: serverTimestamp(),
        });
      }
      
      await wrapSync(promise, {
        successMsg: productModal === "new" ? "Product added" : "Product updated",
        offlineMsg: "Equipment Changes Saved Offline",
        errorMsg: "Could not save product"
      });

      setProductModal(null);
      setProductForm(BLANK_PRODUCT_FORM);
    } catch (err) {
      console.error(err);
    }
  }

  async function removeProduct(p) {
    if (!window.confirm(`Delete "${p.name || "this product"}"? This cannot be undone.`)) return;
    try {
      await wrapSync(deleteDoc(doc(db, "products", p.id)), {
        successMsg: "Product deleted",
        offlineMsg: "Action Queued for Sync",
        errorMsg: "Could not delete product"
      });
      setCart((c) => {
        const n = { ...c };
        delete n[p.id];
        return n;
      });
      setProductModal(null);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCheckout(e) {
    e.preventDefault();
    if (cartLines.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    const cashNum = Number(cashReceived);
    if (paymentMethod === "Cash") {
      if (!Number.isFinite(cashNum) || cashNum < cartTotal) {
        toast.error("Cash received must cover the total");
        return;
      }
    }

    try {
      const batch = writeBatch(db);
      
      const txRef = doc(collection(db, "salesTransactions"));
      const cashRec = paymentMethod === "Cash" ? cashNum : cartTotal;
      const ch = paymentMethod === "Cash" ? roundMoney(Math.max(0, cashRec - cartTotal)) : 0;

      batch.set(txRef, {
        type: "pos",
        items: cartLines.map((l) => ({
          productId: l.productId,
          name: l.name,
          category: l.category,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          lineTotal: l.lineTotal,
        })),
        total: cartTotal,
        paymentMethod,
        cashReceived: cashRec,
        change: ch,
        createdAt: serverTimestamp(),
      });

      for (const line of cartLines) {
        const p = products.find((x) => x.id === line.productId);
        const usesStock = p && Object.prototype.hasOwnProperty.call(p, "stock");
        const ref = doc(db, "products", line.productId);
        batch.update(ref, {
          [usesStock ? "stock" : "quantity"]: increment(-line.quantity),
          updatedAt: serverTimestamp(),
        });
      }

      await wrapSync(batch.commit(), {
        successMsg: "Sale completed",
        offlineMsg: "Payment Saved Offline — Pending Server Sync",
        errorMsg: "Checkout failed"
      });

      setCart({});
      setCashReceived("");
      setCheckoutOpen(false);

      const receiptPayload = {
        transactionId: txRef.id,
        createdAt: new Date(),
        items: cartLines,
        total: cartTotal,
        paymentMethod,
        cashReceived: cashRec,
        change: ch,
      };
      setLastReceipt(receiptPayload);

      const html = buildReceiptHtml(receiptPayload);
      printReceiptHtml(html);
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="ad-page-title">Point of sale</h1>
          <p className="ad-page-sub">
            Retail checkout using the <strong className="text-[var(--ad-text)]">products</strong> catalog.
            Booking and court payments stay under Sales → Payments.
          </p>
        </div>
        <button type="button" className="ad-btn ad-btn-primary shrink-0" onClick={openNewProduct}>
          + Add product
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-7 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <input
              className="af-input flex-1 min-w-0 bg-[var(--ad-surface)] border-[var(--ad-border)] text-[var(--ad-text)] placeholder:text-slate-500"
              placeholder="Search products…"
              value={search}
              onChange={(e) => handleProductSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all border ${
                  category === c
                    ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.15)]"
                    : "border-[var(--ad-border)] text-[var(--ad-muted)] hover:border-slate-500"
                }`}
                onClick={() => handleProductCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredProducts.length === 0 && (
              <div className="sm:col-span-2 ad-empty border border-dashed border-[var(--ad-border)] rounded-xl">
                No products match this search — or your catalog is empty. Use{" "}
                <strong className="text-[var(--ad-text)]">Add product</strong> to create items (name, category,
                price, stock).
              </div>
            )}
            {pageProducts.map((p) => {
              const stock = productStock(p);
              const price = productPrice(p);
              const inCart = cart[p.id] || 0;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 flex flex-col gap-2 transition-all ${
                    stock <= 0
                      ? "border-slate-700/80 opacity-60"
                      : "border-[var(--ad-border)] bg-[var(--ad-surface)] hover:border-cyan-500/40 hover:shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                  }`}
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-[var(--ad-text)] truncate">{p.name || "Unnamed"}</div>
                        {p.hasPendingWrites && <span className="ad-badge ad-badge-pending text-[10px] px-1 py-0 border border-amber-500/20">Pending Sync</span>}
                      </div>
                      <div className="text-[11px] text-[var(--ad-muted)]">{p.category || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-emerald-400 font-bold">{formatReceiptCurrency(price)}</div>
                      <div className={`text-[10px] font-semibold ${stock <= 5 ? "text-amber-400" : "text-slate-500"}`}>
                        Stock {stock}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="ad-btn ad-btn-outline ad-btn-sm flex-1 justify-center"
                      onClick={() => openEditProduct(p)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ad-btn ad-btn-danger ad-btn-sm flex-1 justify-center"
                      onClick={() => removeProduct(p)}
                    >
                      Delete
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={stock <= 0}
                    className="ad-btn ad-btn-primary ad-btn-sm w-full justify-center disabled:opacity-40"
                    onClick={() => addToCart(p)}
                  >
                    {stock <= 0 ? "Out of stock" : inCart ? `Add another (${inCart} in cart)` : "Add to cart"}
                  </button>
                </div>
              );
            })}
          </div>
          <Pagination page={productSafePage} totalPages={productTotalPages} onPage={setProductPage} />
        </section>

        <aside className="xl:col-span-5 xl:sticky xl:top-24 space-y-4">
          <div className="ad-card overflow-hidden border-cyan-500/20 shadow-[0_0_30px_rgba(34,211,238,0.06)]">
            <div className="ad-card-header">
              <h3 className="ad-card-title flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400">shopping_cart</span>
                Cart
              </h3>
              <span className="text-xs font-mono text-[var(--ad-muted)]">{cartLines.length} line(s)</span>
            </div>
            <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto custom-scrollbar">
              {cartLines.length === 0 ? (
                <p className="text-sm text-[var(--ad-muted)] text-center py-6">Cart is empty.</p>
              ) : (
                cartLines.map((line) => {
                  const p = products.find((x) => x.id === line.productId);
                  const maxStock = p ? productStock(p) : 0;
                  return (
                    <div
                      key={line.productId}
                      className="flex flex-col gap-2 rounded-lg border border-[var(--ad-border)] bg-[#0f141c] p-3"
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <span className="font-semibold text-sm text-[var(--ad-text)]">{line.name}</span>
                        <button
                          type="button"
                          className="text-[11px] text-red-400 hover:underline shrink-0"
                          onClick={() => removeLine(line.productId)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="ad-btn ad-btn-outline ad-btn-sm px-2 min-w-[2rem]"
                            onClick={() => setQty(line.productId, line.quantity - 1, maxStock)}
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={maxStock}
                            className="af-input w-16 py-1 text-center text-sm"
                            value={line.quantity}
                            onChange={(e) => setQty(line.productId, e.target.value, maxStock)}
                          />
                          <button
                            type="button"
                            className="ad-btn ad-btn-outline ad-btn-sm px-2 min-w-[2rem]"
                            onClick={() => setQty(line.productId, line.quantity + 1, maxStock)}
                          >
                            +
                          </button>
                        </div>
                        <span className="font-mono text-emerald-400 text-sm">{formatReceiptCurrency(line.lineTotal)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="border-t border-[var(--ad-border)] p-4 space-y-3">
              <div className="flex justify-between items-center text-lg font-black text-[var(--ad-text)]">
                <span>Total</span>
                <span className="font-mono text-cyan-300">{formatReceiptCurrency(cartTotal)}</span>
              </div>
              <button
                type="button"
                className="ad-btn ad-btn-primary w-full justify-center"
                disabled={cartLines.length === 0}
                onClick={() => {
                  setCheckoutOpen(true);
                  setCashReceived(cartTotal ? String(cartTotal) : "");
                }}
              >
                Checkout
              </button>
            </div>
          </div>

          {lastReceipt && (
            <div className="rounded-xl border border-[var(--ad-border)] bg-[var(--ad-surface)] p-4 text-sm">
              <div className="font-bold text-[var(--ad-text)] mb-2">Last receipt</div>
              <p className="text-[var(--ad-muted)] text-xs mb-2">
                ID <span className="font-mono text-cyan-400">{lastReceipt.transactionId}</span>
              </p>
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                onClick={() =>
                  printReceiptHtml(
                    buildReceiptHtml({
                      ...lastReceipt,
                      createdAt: lastReceipt.createdAt,
                    })
                  )
                }
              >
                Print again
              </button>
            </div>
          )}
        </aside>
      </div>

      {productModal && (
        <div
          className="ad-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && syncState === "idle" && setProductModal(null)}
        >
          <div className="ad-modal max-w-md border-cyan-500/20 shadow-[0_0_40px_rgba(34,211,238,0.12)]">
            <div className="ad-modal-header">
              <h3>{productModal === "new" ? "Add product" : "Edit product"}</h3>
              <button
                type="button"
                className="ad-modal-close"
                onClick={() => syncState === "idle" && setProductModal(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={saveProduct} className="ad-modal-form">
              <div className="af-group">
                <label className="af-label">Name *</label>
                <input
                  className="af-input"
                  value={productForm.name}
                  onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sports drink"
                  required
                />
              </div>
              <div className="af-group">
                <label className="af-label">Category</label>
                <input
                  className="af-input"
                  value={productForm.category}
                  onChange={(e) => setProductForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Beverages"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="af-group">
                  <label className="af-label">Price (₱) *</label>
                  <input
                    className="af-input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={productForm.price}
                    onChange={(e) => setProductForm((f) => ({ ...f, price: e.target.value }))}
                    required
                  />
                </div>
                <div className="af-group">
                  <label className="af-label">Stock *</label>
                  <input
                    className="af-input"
                    type="number"
                    min={0}
                    step={1}
                    value={productForm.stock}
                    onChange={(e) => setProductForm((f) => ({ ...f, stock: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="ad-modal-footer ad-modal-footer-between">
                {productModal !== "new" ? (
                  <button
                    type="button"
                    className="ad-btn ad-btn-danger"
                    disabled={syncState !== "idle" && syncState !== "error"}
                    onClick={() => {
                      const p = products.find((x) => x.id === productModal);
                      if (p) removeProduct(p);
                    }}
                  >
                    Delete
                  </button>
                ) : (
                  <span />
                )}
                <div className="ad-modal-footer-actions">
                  <button
                    type="button"
                    className="ad-btn ad-btn-outline"
                    onClick={() => setProductModal(null)}
                    disabled={syncState !== "idle" && syncState !== "error"}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="ad-btn ad-btn-primary" disabled={syncState !== "idle" && syncState !== "error"}>
                    {syncState === "syncing" ? "Saving…" : syncState === "offline-saved" ? "Saved Offline" : productModal === "new" ? "Add product" : "Save changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {checkoutOpen && (
        <div
          className="ad-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && syncState === "idle" && setCheckoutOpen(false)}
        >
          <div className="ad-modal max-w-md shadow-[0_0_40px_rgba(34,211,238,0.12)] border-cyan-500/20">
            <div className="ad-modal-header">
              <h3>Complete sale</h3>
              <button type="button" className="ad-modal-close" onClick={() => syncState === "idle" && setCheckoutOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCheckout} className="ad-modal-form">
              <div className="rounded-lg border border-[var(--ad-border)] p-3 space-y-2 text-sm">
                {cartLines.map((l) => (
                  <div key={l.productId} className="flex justify-between gap-2">
                    <span className="text-[var(--ad-muted)]">
                      {l.name} × {l.quantity}
                    </span>
                    <span className="font-mono">{formatReceiptCurrency(l.lineTotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-2 border-t border-[var(--ad-border)]">
                  <span>Total</span>
                  <span className="font-mono text-cyan-300">{formatReceiptCurrency(cartTotal)}</span>
                </div>
              </div>
              <div className="af-group">
                <label className="af-label">Payment method</label>
                <select
                  className="af-input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="Cash">Cash</option>
                  <option value="GCash">GCash</option>
                  <option value="Card">Card</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              {paymentMethod === "Cash" && (
                <>
                  <div className="af-group">
                    <label className="af-label">Cash received</label>
                    <input
                      className="af-input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      required
                    />
                  </div>
                  <p className="text-sm font-mono text-emerald-400">
                    Change: {formatReceiptCurrency(changeDue)}
                  </p>
                </>
              )}
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-outline" onClick={() => setCheckoutOpen(false)} disabled={syncState !== "idle" && syncState !== "error"}>
                  Cancel
                </button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={syncState !== "idle" && syncState !== "error"}>
                  {syncState === "syncing" ? "Processing…" : syncState === "offline-saved" ? "Saved Offline" : "Confirm & print receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
