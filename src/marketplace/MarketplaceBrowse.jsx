import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { subscribeStores } from "../services/marketplace/storesService";
import { subscribeStoreProducts, productStock, productPrice } from "../services/marketplace/storeProductsService";
import { createMarketplaceCustomerOrder } from "../services/marketplace/customerOrdersService";
import { STORE_CATEGORIES, categoryLabel } from "./constants";
import { roundMoney } from "../lib/bookingMoney";
import "./marketplace.css";

function ProductImage({ src, alt }) {
  if (!src) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-600">
        <span className="material-symbols-outlined text-3xl opacity-40">fastfood</span>
      </div>
    );
  }
  return <img src={src} alt={alt || ""} className="w-full h-full object-cover" loading="lazy" />;
}

/** cart key: `${storeId}:${productId}` */
export default function MarketplaceBrowse({ booking, onOrderPlaced }) {
  const [stores, setStores] = useState([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [productsByStore, setProductsByStore] = useState({});
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [storeCategory, setStoreCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = subscribeStores((list) => {
      setStores(list);
      setLoadingStores(false);
    }, { activeOnly: true });
    return () => unsub();
  }, []);

  // One product listener at a time (avoids Firestore listener churn / internal assertion errors)
  useEffect(() => {
    if (!selectedStoreId) return undefined;
    const unsub = subscribeStoreProducts(selectedStoreId, (products) => {
      setProductsByStore((prev) => ({ ...prev, [selectedStoreId]: products }));
    });
    return () => unsub();
  }, [selectedStoreId]);

  const selectedStore = stores.find((s) => s.id === selectedStoreId);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      const catOk = storeCategory === "all" || s.category === storeCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (s.name || "").toLowerCase().includes(q);
    });
  }, [stores, storeCategory, search]);

  const storeProducts = useMemo(() => {
    if (!selectedStoreId) return [];
    const list = productsByStore[selectedStoreId] || [];
    const q = search.trim().toLowerCase();
    return list.filter((p) => {
      if (p.available === false) return false;
      if (!q) return true;
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    });
  }, [selectedStoreId, productsByStore, search]);

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
        lineTotal: roundMoney(unit * safeQty),
        notes: itemNotes[key] || "",
      };
      if (!groups[storeId]) {
        groups[storeId] = { storeId, storeName: store.name, items: [] };
      }
      groups[storeId].items.push(line);
    }
    return groups;
  }, [cart, stores, productsByStore, itemNotes]);

  const subtotal = useMemo(
    () =>
      roundMoney(
        Object.values(cartGroups).reduce(
          (s, g) => s + g.items.reduce((a, it) => a + it.lineTotal, 0),
          0
        )
      ),
    [cartGroups]
  );

  const addToCart = useCallback((storeId, product) => {
    const key = `${storeId}:${product.id}`;
    const stock = productStock(product);
    if (stock <= 0) return toast.error("Out of stock");
    setCart((c) => {
      const cur = c[key] || 0;
      return { ...c, [key]: Math.min(cur + 1, stock) };
    });
  }, []);

  const setQty = useCallback((key, qty, maxStock) => {
    const q = Math.floor(Number(qty) || 0);
    if (q <= 0) {
      setCart((c) => {
        const n = { ...c };
        delete n[key];
        return n;
      });
      return;
    }
    setCart((c) => ({ ...c, [key]: Math.min(q, maxStock) }));
  }, []);

  const handleCheckout = async () => {
    if (Object.keys(cartGroups).length === 0) {
      toast.error("Your cart is empty");
      return;
    }
    setSubmitting(true);
    try {
      await createMarketplaceCustomerOrder({
        bookingId: booking.id,
        courtId: booking.courtId,
        courtName: booking.courtName,
        customerName: booking.playerName || "Guest",
        storeGroups: cartGroups,
        serviceFee: 0,
      });
      setCart({});
      setItemNotes({});
      toast.success("Order placed! Pay at the admin counter.");
      onOrderPlaced?.();
    } catch (e) {
      console.error(e);
      toast.error("Could not place order");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStores) {
    return (
      <div className="space-y-3 p-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="mkp-skeleton h-24" />
        ))}
      </div>
    );
  }

  if (!selectedStoreId) {
    return (
      <div className="space-y-4">
        <input
          type="search"
          placeholder="Search stalls or food…"
          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
          <button
            type="button"
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${storeCategory === "all" ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}
            onClick={() => setStoreCategory("all")}
          >
            All
          </button>
          {STORE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${storeCategory === c.id ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}
              onClick={() => setStoreCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        {filteredStores.length === 0 ? (
          <p className="text-center text-slate-500 py-8 text-sm">No food stalls open right now.</p>
        ) : (
          <div className="mkp-grid-stores">
            {filteredStores.map((store) => {
              const prep = Number(store.estimatedPrepMinutes) || 15;
              return (
                <button
                  key={store.id}
                  type="button"
                  className="mkp-store-card text-left"
                  onClick={() => {
                    setSelectedStoreId(store.id);
                    setSearch("");
                  }}
                >
                  {store.logoUrl ? (
                    <img src={store.logoUrl} alt="" className="mkp-store-logo" />
                  ) : (
                    <div className="mkp-store-logo flex items-center justify-center text-cyan-400 font-bold text-xl">
                      {(store.name || "S")[0]}
                    </div>
                  )}
                  <div className="font-bold text-white text-sm line-clamp-2">{store.name}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{categoryLabel(store.category)}</div>
                  <div className="mt-2 flex justify-center gap-1 flex-wrap">
                    <span className="mkp-badge-open">Open</span>
                    <span className="text-[10px] text-slate-500">~{prep} min</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="text-cyan-400 text-sm font-semibold flex items-center gap-1"
        onClick={() => setSelectedStoreId(null)}
      >
        ← All stalls
      </button>
      <div className="flex items-center gap-3">
        {selectedStore?.logoUrl && (
          <img src={selectedStore.logoUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
        )}
        <div>
          <h2 className="font-bold text-white">{selectedStore?.name}</h2>
          <p className="text-xs text-slate-500">{categoryLabel(selectedStore?.category)}</p>
        </div>
      </div>
      <input
        type="search"
        placeholder="Search products…"
        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-white text-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="mkp-product-grid">
        {storeProducts.map((p) => {
          const key = `${selectedStoreId}:${p.id}`;
          const stock = productStock(p);
          const price = productPrice(p);
          const inCart = cart[key] || 0;
          return (
            <div
              key={p.id}
              className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-slate-950">
                <ProductImage src={p.productImage} alt={p.name} />
              </div>
              <div className="p-2 flex-1">
                <div className="font-semibold text-white text-sm line-clamp-2">{p.name}</div>
                <div className="text-emerald-400 text-sm font-mono mt-1">₱{price.toFixed(2)}</div>
              </div>
              {inCart > 0 ? (
                <div className="p-2 border-t border-slate-800 flex items-center justify-between gap-1">
                  <button type="button" className="w-7 h-7 bg-slate-700 rounded text-white" onClick={() => setQty(key, inCart - 1, stock)}>−</button>
                  <span className="font-bold text-white text-sm">{inCart}</span>
                  <button type="button" className="w-7 h-7 bg-cyan-500 rounded text-slate-950 font-bold" disabled={inCart >= stock} onClick={() => setQty(key, inCart + 1, stock)}>+</button>
                </div>
              ) : (
                <button
                  type="button"
                  className="p-2 text-xs font-bold text-cyan-400 border-t border-slate-800 disabled:opacity-40"
                  disabled={stock <= 0}
                  onClick={() => addToCart(selectedStoreId, p)}
                >
                  {stock <= 0 ? "Out of stock" : "Add"}
                </button>
              )}
              {inCart > 0 && (
                <input
                  className="mx-2 mb-2 w-[calc(100%-1rem)] text-xs bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white"
                  placeholder="Notes (optional)"
                  value={itemNotes[key] || ""}
                  onChange={(e) => setItemNotes((n) => ({ ...n, [key]: e.target.value }))}
                />
              )}
            </div>
          );
        })}
      </div>

      {Object.keys(cartGroups).length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 z-30 pointer-events-none">
          <div className="max-w-xl mx-auto bg-slate-800 border border-slate-700 rounded-2xl p-4 pointer-events-auto shadow-2xl max-h-[50vh] overflow-y-auto">
            <h3 className="font-bold text-white mb-2">Your cart</h3>
            {Object.values(cartGroups).map((g) => (
              <div key={g.storeId} className="mkp-cart-group">
                <div className="text-xs font-bold text-cyan-400 mb-1">{g.storeName}</div>
                {g.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-sm text-slate-300">
                    <span>{it.quantity}× {it.name}</span>
                    <span>₱{it.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
                <div className="text-right text-xs text-slate-500 mt-1">
                  Subtotal ₱{roundMoney(g.items.reduce((s, x) => s + x.lineTotal, 0)).toFixed(2)}
                </div>
              </div>
            ))}
            <div className="flex justify-between font-bold text-white mb-3 pt-2 border-t border-slate-700">
              <span>Total (pay at counter)</span>
              <span className="text-emerald-400">₱{subtotal.toFixed(2)}</span>
            </div>
            <button
              type="button"
              className="w-full py-3 bg-cyan-500 text-slate-950 font-bold rounded-xl disabled:opacity-60"
              disabled={submitting}
              onClick={handleCheckout}
            >
              {submitting ? "Placing order…" : "Place marketplace order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
