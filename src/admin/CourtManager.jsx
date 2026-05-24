// src/admin/CourtManager.jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { useOfflineSync } from "../hooks/useOfflineSync";
import toast from "react-hot-toast";
import { QRCodeCanvas } from "qrcode.react";

const BLANK = { name:"", description:"", pricePerHour:"", amenities:"", isActive:true };

export default function CourtManager() {
  const [courts, setCourts]   = useState([]);
  const [form, setForm]       = useState(BLANK);
  const [editId, setEditId]   = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [qrCourt, setQrCourt]   = useState(null);
  const [search, setSearch]   = useState("");
  const { syncState, wrapSync } = useOfflineSync();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Court Management";
  }, []);

  useEffect(() => {
    const q = query(collection(db,"courts"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      setCourts(snap.docs.map(d=>({id:d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data()})));
    });
    return () => unsub();
  }, []);

  function set(k,v) { setForm(p=>({...p,[k]:v})); }

  function openAdd()   { setForm(BLANK); setEditId(null); setShowForm(true); }
  function openEdit(c) { setForm({...c, amenities: Array.isArray(c.amenities)?c.amenities.join(", "):c.amenities??""}); setEditId(c.id); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditId(null); }

  async function logCourtActivity(title, description) {
    try {
      await addDoc(collection(db, "activityLogs"), {
        title,
        description,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Activity log failed:", err);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      name:         form.name.trim(),
      description:  form.description.trim(),
      pricePerHour: Number(form.pricePerHour),
      amenities:    form.amenities.split(",").map(a=>a.trim()).filter(Boolean),
      isActive:     form.isActive,
    };
    try {
      let promise;
      if (editId) {
        promise = updateDoc(doc(db,"courts",editId), payload);
      } else {
        promise = addDoc(collection(db,"courts"), { ...payload, createdAt: serverTimestamp() });
      }
      await wrapSync(promise, {
        successMsg: editId ? "Court updated" : "Court added",
        offlineMsg: "Court Changes Saved Offline",
        errorMsg: "Could not save court"
      });
      // Log activity in background — non-blocking
      logCourtActivity(
        editId ? "Court Updated" : "Court Added",
        editId
          ? `“${payload.name}” — price ₱${payload.pricePerHour}/hr${payload.isActive ? "" : " (inactive)"}`
          : `“${payload.name}” added at ₱${payload.pricePerHour}/hr`
      );
      closeForm();
    } catch(err) { console.error(err); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this court?")) return;
    const name = courts.find((c) => c.id === id)?.name || "Court";
    try {
      await wrapSync(deleteDoc(doc(db,"courts",id)), {
        successMsg: "Court deleted",
        offlineMsg: "Action Queued for Sync",
        errorMsg: "Could not delete court"
      });
      logCourtActivity("Court Deleted", `“${name}” was removed`);
    } catch(err){ console.error(err); }
  }

  async function toggleActive(court) {
    const next = !court.isActive;
    await wrapSync(updateDoc(doc(db,"courts",court.id), { isActive: next }), {
      successMsg: `Court ${next ? "activated" : "deactivated"}`,
      offlineMsg: "Status Update Saved Offline",
      errorMsg: "Could not update court status"
    });
    logCourtActivity(
      "Court Status Changed",
      `“${court.name}” ${next ? "activated" : "deactivated"}`
    );
  }

  const filtered = courts.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ad-page">
      <div className="ad-page-header">
        <div>
          <h1 className="ad-page-title">Court Management</h1>
          <p className="ad-page-sub">Add, edit, and manage your pickleball courts.</p>
        </div>
        <button className="ad-btn ad-btn-primary" onClick={openAdd}>+ Add Court</button>
      </div>

      {/* Search */}
      <div className="ad-search-row">
        <input className="ad-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search courts..."/>
        <span className="ad-count">{filtered.length} court{filtered.length!==1?"s":""}</span>
      </div>

      {/* Court grid */}
      <div className="cm-grid">
        {filtered.length === 0 && <div className="ad-empty">No courts found. Add your first court!</div>}
        {filtered.map(court => (
          <div key={court.id} className={`cm-card ${court.isActive?"":"cm-inactive"}`}>
            <div className="cm-card-header">
              <div className="flex items-center gap-2">
                <div className="cm-card-name">{court.name}</div>
                {court.hasPendingWrites && <span className="ad-badge ad-badge-pending text-[10px] px-1 py-0 border border-amber-500/20">Pending Sync</span>}
              </div>
              <div className={`ad-badge ${court.isActive?"ad-badge-approved":"ad-badge-rejected"}`}>
                {court.isActive ? "Active" : "Inactive"}
              </div>
            </div>
            <div className="cm-price">₱{court.pricePerHour?.toLocaleString()}<span>/hour</span></div>
            <p className="cm-desc">{court.description || "No description."}</p>
            {court.amenities?.length > 0 && (
              <div className="cm-amenities">
                {court.amenities.map((a,i)=>(
                  <span key={i} className="cm-amenity-tag">{a}</span>
                ))}
              </div>
            )}
            <div className="cm-actions">
              {court.isActive && (
                <Link
                  className="ad-btn ad-btn-sm"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  to={`/admin/new-booking?court=${encodeURIComponent(court.id)}`}
                >
                  📅 Book
                </Link>
              )}
              <button className="ad-btn ad-btn-sm ad-btn-outline" onClick={()=>openEdit(court)} disabled={syncState !== 'idle' && syncState !== 'error'}> Edit</button>
              <button className="ad-btn ad-btn-sm ad-btn-outline" onClick={()=>setQrCourt(court)}>QR</button>
              <button className="ad-btn ad-btn-sm ad-btn-outline" onClick={()=>toggleActive(court)} disabled={syncState !== 'idle' && syncState !== 'error'}>
                {court.isActive ? " Deactivate" : " Activate"}
              </button>
              <button className="ad-btn ad-btn-sm ad-btn-danger" onClick={()=>handleDelete(court.id)} disabled={syncState !== 'idle' && syncState !== 'error'}>
                {syncState === 'syncing' ? "..." : " Delete"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="ad-modal-backdrop" onClick={e=>e.target===e.currentTarget&&closeForm()}>
          <div className="ad-modal">
            <div className="ad-modal-header">
              <h3>{editId ? "Edit Court" : "Add New Court"}</h3>
              <button className="ad-modal-close" onClick={closeForm}>✕</button>
            </div>
            <form className="ad-modal-form" onSubmit={handleSubmit}>
              <div className="af-group">
                <label className="af-label">Court Name *</label>
                <input className="af-input" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. Court 1" required/>
              </div>
              <div className="af-group">
                <label className="af-label">Description</label>
                <textarea className="af-input af-textarea" value={form.description} onChange={e=>set("description",e.target.value)} placeholder="Describe this court..." rows={3}/>
              </div>
              <div className="af-row">
                <div className="af-group">
                  <label className="af-label">Price per Hour (₱) *</label>
                  <input className="af-input" type="number" min="0" value={form.pricePerHour} onChange={e=>set("pricePerHour",e.target.value)} placeholder="200" required/>
                </div>
                <div className="af-group">
                  <label className="af-label">Status</label>
                  <select className="af-input" value={form.isActive} onChange={e=>set("isActive",e.target.value==="true")}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="af-group">
                <label className="af-label">Amenities <span style={{fontWeight:400,fontSize:"0.78rem"}}>(comma separated)</span></label>
                <input className="af-input" value={form.amenities} onChange={e=>set("amenities",e.target.value)} placeholder="Lights, Water Station, Parking"/>
              </div>
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-outline" onClick={closeForm} disabled={syncState !== 'idle' && syncState !== 'error'}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={syncState !== 'idle' && syncState !== 'error'}>
                  {syncState === 'syncing' ? "Saving..." : syncState === 'offline-saved' ? "Saved Offline" : editId ? "Save Changes" : "Add Court"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {qrCourt && (
        <div className="ad-modal-backdrop" onClick={(e) => e.target === e.currentTarget && setQrCourt(null)}>
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #print-section, #print-section * { visibility: visible; }
              #print-section {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                display: flex !important;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                padding-top: 4rem;
                background: white;
              }
              .print-text {
                display: block !important;
                color: black;
                text-align: center;
              }
              .print-title { font-size: 3rem; font-weight: bold; margin-bottom: 2rem; }
              .print-subtitle { font-size: 2rem; font-weight: 600; margin-top: 2rem; }
            }
          `}</style>
          <div className="ad-modal flex flex-col items-center">
            <div className="ad-modal-header w-full">
              <h3>{qrCourt.name} QR Code</h3>
              <button className="ad-modal-close" onClick={() => setQrCourt(null)}>✕</button>
            </div>
            <div id="print-section" className="p-8 bg-white rounded-xl my-4 flex flex-col items-center">
              <div className="print-text print-title hidden">{qrCourt.name}</div>
              <QRCodeCanvas id="court-qr-canvas" value={`${window.location.origin}/order?courtId=${qrCourt.id}`} size={256} />
              <div className="print-text print-subtitle hidden">Scan to Order</div>
            </div>
            <p className="text-sm text-slate-400 text-center px-4 mb-4">
              Print this QR code and place it at {qrCourt.name}.<br/>
              Players can scan it to order food and drinks during their booked time.
            </p>
            <div className="ad-modal-footer w-full flex justify-center">
              <button className="ad-btn ad-btn-primary" onClick={() => {
                const canvas = document.getElementById("court-qr-canvas");
                if (canvas) {
                  const dataUrl = canvas.toDataURL("image/png");
                  wrapSync(updateDoc(doc(db, "courts", qrCourt.id), { qrCodeImage: dataUrl }), {
                    successMsg: "QR code saved to database",
                    offlineMsg: "Saved offline",
                    errorMsg: "Failed to save QR code"
                  });
                }
                setTimeout(() => window.print(), 100);
              }}>Print & Save QR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}