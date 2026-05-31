import { useState, useEffect, useMemo } from "react";
import { QRCodeCanvas } from "qrcode.react";
import toast from "react-hot-toast";
import {
  subscribeStores,
  createStore,
  updateStore,
  deleteStore,
  rotateVendorToken,
  uploadStoreLogo,
} from "../../services/marketplace/storesService";
import { listStoreProducts } from "../../services/marketplace/storeProductsService";
import { getStoreSalesSummary } from "../../services/marketplace/settlementService";
import { STORE_CATEGORIES, STORE_STATUS } from "../../marketplace/constants";
import { vendorPortalUrl } from "../../services/marketplace/tokenUtils";
import { foodCourtPublicUrl } from "../../services/marketplace/foodCourtConfigService";
import "../../marketplace/marketplace.css";

const BLANK = {
  name: "",
  ownerName: "",
  contactNumber: "",
  stallNumber: "",
  description: "",
  category: "food",
  commissionRate: "10",
  status: STORE_STATUS.ACTIVE,
  logoFile: null,
  logoPreview: "",
};

function formatPeso(v) {
  return `₱${Number(v || 0).toFixed(2)}`;
}

function copyTextToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text).catch(() => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    });
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function VendorStoresPage() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [vendorLinkModal, setVendorLinkModal] = useState(null);
  const [facilityQrOpen, setFacilityQrOpen] = useState(false);
  const [productsModal, setProductsModal] = useState(null);
  const [salesByStore, setSalesByStore] = useState({});

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Vendor Stores";
    const unsub = subscribeStores((list) => {
      setStores(list);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const summaryEntries = await Promise.all(
        stores.map(async (s) => [s.id, await getStoreSalesSummary(s.id)])
      );
      if (cancelled) return;
      const m = {};
      for (const [id, summary] of summaryEntries) m[id] = summary;
      setSalesByStore(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [stores]);

  const storeCards = useMemo(
    () =>
      stores.map((s) => ({
        ...s,
        todayOrders: salesByStore[s.id]?.orderCount || 0,
        todayEarnings: salesByStore[s.id]?.net || 0,
      })),
    [stores, salesByStore]
  );

  function openAdd() {
    setForm(BLANK);
    setModal({ mode: "add" });
  }

  function openEdit(store) {
    setForm({
      name: store.name || "",
      ownerName: store.ownerName || "",
      contactNumber: store.contactNumber || "",
      stallNumber: store.stallNumber || "",
      description: store.description || "",
      category: store.category || "food",
      commissionRate: String(store.commissionRate ?? 10),
      status: store.status || STORE_STATUS.ACTIVE,
      logoFile: null,
      logoPreview: store.logoUrl || "",
    });
    setModal({ mode: "edit", store });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let logoUrl = form.logoPreview || null;
      if (form.logoFile) {
        const tempId = modal.store?.id || "new";
        logoUrl = await uploadStoreLogo(tempId, form.logoFile);
      }

      const payload = {
        name: form.name,
        ownerName: form.ownerName,
        contactNumber: form.contactNumber,
        stallNumber: form.stallNumber,
        description: form.description,
        category: form.category,
        commissionRate: Number(form.commissionRate) || 0,
        status: form.status,
        logoUrl,
      };

      if (modal.mode === "add") {
        await createStore(payload);
        toast.success("Store created");
      } else {
        await updateStore(modal.store.id, payload);
        toast.success("Store updated");
      }
      setModal(null);
    } catch (err) {
      console.error(err);
      toast.error("Could not save store");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(store) {
    const next =
      store.status === STORE_STATUS.ACTIVE ? STORE_STATUS.CLOSED : STORE_STATUS.ACTIVE;
    await updateStore(store.id, { status: next });
    toast.success(next === STORE_STATUS.ACTIVE ? "Store activated" : "Store disabled");
  }

  async function handleDelete(store) {
    if (!window.confirm(`Delete "${store.name}"? This cannot be undone.`)) return;
    await deleteStore(store.id);
    toast.success("Store deleted");
  }

  async function handleRotateToken(store) {
    const { token, portalUrl } = await rotateVendorToken(store.id);
    toast.success("Vendor link regenerated");
    setVendorLinkModal({ ...store, token, portalUrl });
  }

  async function viewProducts(store) {
    const products = await listStoreProducts(store.id);
    setProductsModal({ store, products });
  }

  const facilityUrl = foodCourtPublicUrl();
  const vendorPortalLink = vendorLinkModal
    ? vendorLinkModal.portalUrl || vendorPortalUrl(vendorLinkModal.id, vendorLinkModal.token || "")
    : "";

  if (loading) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page mkp-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Vendor Stores</h1>
          <p className="ad-page-sub">Centralized food court vendor management.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="ad-btn ad-btn-outline" onClick={() => setFacilityQrOpen(true)}>
            View Facility QR
          </button>
          <button type="button" className="ad-btn ad-btn-primary" onClick={openAdd}>
            + Add Store
          </button>
        </div>
      </div>

      {storeCards.length === 0 ? (
        <div className="ad-empty border border-dashed border-[var(--ad-border)] rounded-xl py-12">
          No vendor stores yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {storeCards.map((s) => (
            <article key={s.id} className="mkp-vendor-order-card hover:border-cyan-500/40 transition-all">
              <div className="flex items-start gap-3">
                {s.logoUrl ? (
                  <img src={s.logoUrl} alt="" className="w-14 h-14 rounded-xl object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center text-cyan-400 font-bold">
                    {(s.name || "S")[0]}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-bold text-white truncate">{s.name}</h3>
                  <p className="text-xs text-slate-500">{s.description || "No description"}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`ad-badge ad-badge-${s.status === STORE_STATUS.ACTIVE ? "approved" : "rejected"}`}>
                      {s.status === STORE_STATUS.ACTIVE ? "Active" : "Inactive"}
                    </span>
                    <span className="text-[11px] text-slate-500">{s.commissionRate || 0}% commission</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-sm space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Owner</span>
                  <span className="text-slate-300">{s.ownerName || "—"}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Orders today</span>
                  <span className="text-white">{s.todayOrders}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Earnings today</span>
                  <span className="text-emerald-400 font-mono">{formatPeso(s.todayEarnings)}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => openEdit(s)}>Edit</button>
                <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => toggleStatus(s)}>
                  {s.status === STORE_STATUS.ACTIVE ? "Disable" : "Activate"}
                </button>
                <button type="button" className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => viewProducts(s)}>View Orders</button>
                <button type="button" className="ad-btn ad-btn-sm ad-btn-primary" onClick={() => setVendorLinkModal(s)}>Open Store</button>
                <button type="button" className="ad-btn ad-btn-sm ad-btn-danger" onClick={() => handleDelete(s)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {facilityQrOpen && (
        <div className="ad-modal-backdrop" onClick={() => setFacilityQrOpen(false)}>
          <div className="ad-modal max-w-xl text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Facility Food Court QR</h3>
            <p className="text-sm text-slate-400 mb-4 break-all">{facilityUrl}</p>
            <div className="inline-block p-5 bg-white rounded-xl">
              <QRCodeCanvas id="facility-foodcourt-qr" value={facilityUrl} size={260} />
            </div>
            <div className="flex gap-2 justify-center mt-4 flex-wrap">
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                onClick={() => {
                  copyTextToClipboard(facilityUrl);
                  toast.success("Link copied");
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                onClick={() => window.print()}
              >
                Print QR
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-primary ad-btn-sm"
                onClick={() => {
                  const canvas = document.getElementById("facility-foodcourt-qr");
                  if (canvas) {
                    const a = document.createElement("a");
                    a.href = canvas.toDataURL("image/png");
                    a.download = "foodcourt-facility-qr.png";
                    a.click();
                  }
                }}
              >
                Download QR
              </button>
            </div>
          </div>
        </div>
      )}

      {vendorLinkModal && (
        <div className="ad-modal-backdrop" onClick={() => setVendorLinkModal(null)}>
          <div className="ad-modal text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Vendor portal — {vendorLinkModal.name}</h3>
            <p className="text-xs text-slate-500 mb-2 px-4">
              Kitchen staff only. Customers use the facility food court QR.
            </p>
            <p className="text-xs text-slate-400 mb-4 break-all px-4">{vendorPortalLink}</p>
            <div className="inline-block p-4 bg-white rounded-xl">
              <QRCodeCanvas
                id={`vendor-qr-${vendorLinkModal.id}`}
                value={vendorPortalLink}
                size={200}
                level="M"
              />
            </div>
            <div className="flex gap-2 justify-center mt-4 flex-wrap">
              <button
                type="button"
                className="ad-btn ad-btn-outline ad-btn-sm"
                onClick={() => {
                  copyTextToClipboard(vendorPortalLink);
                  toast.success("Link copied");
                }}
              >
                Copy link
              </button>
              <button type="button" className="ad-btn ad-btn-outline ad-btn-sm" onClick={() => handleRotateToken(vendorLinkModal)}>
                Regenerate token
              </button>
              <button
                type="button"
                className="ad-btn ad-btn-primary ad-btn-sm"
                onClick={() => {
                  const canvas = document.getElementById(`vendor-qr-${vendorLinkModal.id}`);
                  if (canvas) {
                    const a = document.createElement("a");
                    a.href = canvas.toDataURL("image/png");
                    a.download = `${vendorLinkModal.name}-vendor-qr.png`;
                    a.click();
                  }
                }}
              >
                Download QR
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="ad-modal-backdrop" onClick={() => setModal(null)}>
          <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ad-modal-header">
              <h3>{modal.mode === "add" ? "Add Store" : "Edit Store"}</h3>
              <button type="button" className="ad-modal-close" onClick={() => setModal(null)}>
                ✕
              </button>
            </div>
            <form className="p-4 space-y-3" onSubmit={handleSave}>
              <div className="af-group">
                <label className="af-label">Store name *</label>
                <input className="af-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="af-group">
                  <label className="af-label">Owner</label>
                  <input className="af-input" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
                </div>
                <div className="af-group">
                  <label className="af-label">Contact</label>
                  <input className="af-input" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} />
                </div>
              </div>
              <div className="af-group">
                <label className="af-label">Description</label>
                <textarea className="af-input min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="af-group">
                  <label className="af-label">Stall #</label>
                  <input className="af-input" value={form.stallNumber} onChange={(e) => setForm({ ...form, stallNumber: e.target.value })} />
                </div>
                <div className="af-group">
                  <label className="af-label">Commission %</label>
                  <input type="number" min="0" max="100" className="af-input" value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="af-group">
                  <label className="af-label">Category</label>
                  <select className="af-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {STORE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="af-group">
                  <label className="af-label">Status</label>
                  <select className="af-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value={STORE_STATUS.ACTIVE}>Active</option>
                    <option value={STORE_STATUS.CLOSED}>Closed</option>
                  </select>
                </div>
              </div>
              <div className="af-group">
                <label className="af-label">Logo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setForm({ ...form, logoFile: f, logoPreview: URL.createObjectURL(f) });
                  }}
                />
                {form.logoPreview && (
                  <img src={form.logoPreview} alt="" className="mt-2 h-16 w-16 rounded object-cover" />
                )}
              </div>
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-outline" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {productsModal && (
        <div className="ad-modal-backdrop" onClick={() => setProductsModal(null)}>
          <div className="ad-modal max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-white p-4 border-b border-slate-700">
              Products — {productsModal.store.name}
            </h3>
            <div className="p-4 max-h-96 overflow-y-auto">
              {productsModal.products.length === 0 ? (
                <p className="text-slate-500 text-sm">No products. Vendor adds via portal.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {productsModal.products.map((p) => (
                    <li key={p.id} className="flex justify-between text-slate-300">
                      <span>{p.name}</span>
                      <span>{formatPeso(p.price || 0)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
