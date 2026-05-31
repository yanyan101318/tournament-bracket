import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { subscribeStores } from "../services/marketplace/storesService";
import { subscribeStoreProducts, productStock, productPrice } from "../services/marketplace/storeProductsService";
import { STORE_CATEGORIES, STORE_STATUS, categoryLabel, PLATFORM_SERVICE_FEE_RATE } from "./constants";
import { roundMoney } from "../lib/bookingMoney";
import FoodCourtCheckout from "./FoodCourtCheckout";
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

export default function FoodCourtMarketplace({ user, profile, booking, onOrderPlaced }) {
  const [stores, setStores] = useState([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [productsByStore, setProductsByStore] = useState({});
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const [storeCategory, setStoreCategory] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({});
  const [itemNotes, setItemNotes] = useState({});
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderDone, setOrderDone] = useState(false);

  useEffect(() => {
    const unsub = subscribeStores((list) => {
      setStores(list);
      setLoadingStores(false);
    }, { activeOnly: false });
    return () => unsub();
  }, []);

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
    let list = stores.filter((s) => {
      const catOk = storeCategory === "all" || s.category === storeCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        (s.name || "").toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "prep") {
        return (Number(a.estimatedPrepMinutes) || 15) - (Number(b.estimatedPrepMinutes) || 15);
      }
      if (sortBy === "category") {
        return String(a.category || "").localeCompare(String(b.category || ""));
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }, [stores, storeCategory, search, sortBy]);

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

  const serviceFee = 0;
  const grandTotal = subtotal;

  const addToCart = useCallback((storeId, product) => {
    if (stores.find((s) => s.id === storeId)?.status === STORE_STATUS.CLOSED) {
      return toast.error("This stall is closed");
    }
    const key = `${storeId}:${product.id}`;
    const stock = productStock(product);
    if (stock <= 0) return toast.error("Out of stock");
    setCart((c) => {
      const cur = c[key] || 0;
      return { ...c, [key]: Math.min(cur + 1, stock) };
    });
  }, [stores]);

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

  function handleCheckoutSuccess() {
    setCart({});
    setItemNotes({});
    setCheckoutOpen(false);
    setOrderDone(true);
    onOrderPlaced?.();
  }

  if (orderDone) {
    return (
      <div className="text-center py-16 px-4">
        <span className="material-symbols-outlined text-6xl text-emerald-400 mb-4">check_circle</span>
        <h2 className="text-2xl font-bold text-white mb-2">Order received!</h2>
        <p className="text-slate-400 text-sm max-w-sm mx-auto mb-6">
          {user
            ? "Pay-later orders were sent to vendors. Pay-now orders: visit the admin counter to pay and dispatch."
            : "Please pay at the admin counter. Vendors will start preparing after payment."}
        </p>
        <button
          type="button"
          className="px-6 py-3 bg-cyan-500 text-slate-950 font-bold rounded-xl"
          onClick={() => setOrderDone(false)}
        >
          Order more
        </button>
      </div>
    );
  }

  if (loadingStores) {
    return (
      <div className="mkp-grid-stores p-2">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="mkp-skeleton h-36 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!selectedStoreId) {
    return (
      <div className="space-y-4 pb-28">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="search"
            placeholder="Search stalls or food…"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-3 text-white text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="name">Sort: Name</option>
            <option value="prep">Sort: Prep time</option>
            <option value="category">Sort: Category</option>
          </select>
        </div>
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
          <p className="text-center text-slate-500 py-12">No stalls match your search.</p>
        ) : (
          <div className="mkp-grid-stores">
            {filteredStores.map((store) => {
              const isOpen = store.status !== STORE_STATUS.CLOSED;
              const prep = Number(store.estimatedPrepMinutes) || 15;
              return (
                <button
                  key={store.id}
                  type="button"
                  disabled={!isOpen}
                  className={`mkp-store-card text-left transition-transform hover:scale-[1.02] ${!isOpen ? "opacity-50" : ""}`}
                  onClick={() => {
                    if (!isOpen) return toast.error("Stall is closed");
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
                  {store.description && (
                    <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{store.description}</p>
                  )}
                  <div className="mt-2 flex justify-center gap-1 flex-wrap">
                    <span className={isOpen ? "mkp-badge-open" : "mkp-badge-closed"}>
                      {isOpen ? "Open" : "Closed"}
                    </span>
                    <span className="text-[10px] text-slate-500">~{prep} min</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {Object.keys(cartGroups).length > 0 && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 z-30">
            <div className="max-w-3xl mx-auto">
              <button
                type="button"
                className="w-full py-3.5 bg-cyan-500 text-slate-950 font-bold rounded-xl shadow-lg"
                onClick={() => setCheckoutOpen(true)}
              >
                View cart · ₱{grandTotal.toFixed(2)}
              </button>
            </div>
          </div>
        )}

        <FoodCourtCheckout
          open={checkoutOpen}
          onClose={() => setCheckoutOpen(false)}
          cartGroups={cartGroups}
          subtotal={subtotal}
          serviceFee={serviceFee}
          grandTotal={grandTotal}
          user={user}
          profile={profile}
          booking={booking}
          onSuccess={handleCheckoutSuccess}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32">
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
            <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="aspect-square bg-slate-950">
                <ProductImage src={p.productImage} alt={p.name} />
              </div>
              <div className="p-2 flex-1">
                <div className="font-semibold text-white text-sm line-clamp-2">{p.name}</div>
                <div className="text-emerald-400 text-sm font-mono mt-1">₱{price.toFixed(2)}</div>
                <div className="text-cyan-400 text-xs mt-2 font-semibold">Stock Left: {stock}</div>
                {stock <= 5 && stock > 0 && <div className="text-amber-400 text-[10px] mt-1">Only {stock} left!</div>}
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
            </div>
          );
        })}
      </div>

      {Object.keys(cartGroups).length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 z-30">
          <div className="max-w-3xl mx-auto">
            <button
              type="button"
              className="w-full py-3.5 bg-cyan-500 text-slate-950 font-bold rounded-xl"
              onClick={() => setCheckoutOpen(true)}
            >
              Checkout · ₱{grandTotal.toFixed(2)}
            </button>
          </div>
        </div>
      )}

      <FoodCourtCheckout
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        cartGroups={cartGroups}
        subtotal={subtotal}
        serviceFee={serviceFee}
        grandTotal={grandTotal}
        user={user}
        profile={profile}
        booking={booking}
        onSuccess={handleCheckoutSuccess}
      />
    </div>
  );
}
