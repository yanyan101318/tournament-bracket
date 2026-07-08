// src/admin/CourtManager.jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, serverTimestamp, query, orderBy, Timestamp
} from "firebase/firestore";
import { db } from "../firebase";
import { useOfflineSync } from "../hooks/useOfflineSync";
import toast from "react-hot-toast";
import { getEffectiveCourtStatus } from "../lib/bookingSlots";

const BLANK = { name: "", description: "", pricePerHour: "", amenities: "", isActive: true, activeStartTime: "06:00", activeEndTime: "22:00", picture: "" };

export default function CourtManager() {
  const [courts, setCourts] = useState([]);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const [overrideModal, setOverrideModal] = useState(null);
  const [overrideType, setOverrideType] = useState("indefinite");
  const [overrideDuration, setOverrideDuration] = useState(2);
  const [overrideStartDatetime, setOverrideStartDatetime] = useState("");
  const [overrideDatetime, setOverrideDatetime] = useState("");


  const { syncState, wrapSync } = useOfflineSync();

  useEffect(() => {
    document.title = "RANAW PICKLEBALL COURT | Court Management";
  }, []);

  useEffect(() => {
    const q = query(collection(db, "courts"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      setCourts(snap.docs.map(d => ({ id: d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data() })));
    });
    return () => unsub();
  }, []);

  function set(k, v) { setForm(p => ({ ...p, [k]: v })); }

  const handlePictureUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        set("picture", reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  function openAdd() { setForm(BLANK); setEditId(null); setShowForm(true); }
  function openEdit(c) {
    setForm({
      ...c,
      amenities: Array.isArray(c.amenities) ? c.amenities.join(", ") : c.amenities ?? "",
      activeStartTime: c.activeStartTime || "06:00",
      activeEndTime: c.activeEndTime || "22:00",
      picture: c.picture || ""
    });
    setEditId(c.id); setShowForm(true);
  }
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
      name: form.name.trim(),
      description: form.description.trim(),
      pricePerHour: Number(form.pricePerHour),
      amenities: form.amenities.split(",").map(a => a.trim()).filter(Boolean),
      isActive: form.isActive,
      activeStartTime: form.activeStartTime || "06:00",
      activeEndTime: form.activeEndTime || "22:00",
      picture: form.picture || "",
    };
    try {
      let promise;
      if (editId) {
        promise = updateDoc(doc(db, "courts", editId), payload);
      } else {
        promise = addDoc(collection(db, "courts"), { ...payload, createdAt: serverTimestamp() });
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
    } catch (err) { console.error(err); }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this court?")) return;
    const name = courts.find((c) => c.id === id)?.name || "Court";
    try {
      await wrapSync(deleteDoc(doc(db, "courts", id)), {
        successMsg: "Court deleted",
        offlineMsg: "Action Queued for Sync",
        errorMsg: "Could not delete court"
      });
      logCourtActivity("Court Deleted", `“${name}” was removed`);
    } catch (err) { console.error(err); }
  }

  function openOverrideModal(court) {
    setOverrideModal(court);
    setOverrideType("indefinite");
    setOverrideDuration(2);
    setOverrideStartDatetime("");
    setOverrideDatetime("");
  }
  function closeOverrideModal() {
    setOverrideModal(null);
  }

  async function handleOverrideSubmit(e) {
    e.preventDefault();
    if (!overrideModal) return;

    const nextStatus = !getEffectiveCourtStatus(overrideModal);
    let expiresAt = null;
    let newBaseStatus = overrideModal.base_status !== undefined ? overrideModal.base_status : overrideModal.isActive;
    let newOverrideStatus = null;

    let startsAt = null;

    if (overrideType === "indefinite") {
      newBaseStatus = nextStatus;
      newOverrideStatus = null;
    } else if (overrideType === "duration") {
      newOverrideStatus = nextStatus;
      startsAt = new Date();
      expiresAt = new Date(Date.now() + overrideDuration * 3600 * 1000);
    } else if (overrideType === "datetime") {
      newOverrideStatus = nextStatus;
      if (!overrideStartDatetime || !overrideDatetime) {
        toast.error("Please select a start and end time");
        return;
      }
      startsAt = new Date(overrideStartDatetime);
      expiresAt = new Date(overrideDatetime);
      if (expiresAt <= startsAt) {
        toast.error("End time must be after start time");
        return;
      }
    }

    const payload = {
      base_status: typeof newBaseStatus === "boolean" ? newBaseStatus : nextStatus,
      override_status: newOverrideStatus,
      override_starts_at: startsAt ? Timestamp.fromDate(startsAt) : null,
      override_expires_at: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      isActive: typeof newBaseStatus === "boolean" ? newBaseStatus : nextStatus, // keep legacy field in sync
    };

    await wrapSync(updateDoc(doc(db, "courts", overrideModal.id), payload), {
      successMsg: `Court ${nextStatus ? "activated" : "deactivated"}`,
      offlineMsg: "Status Update Saved Offline",
      errorMsg: "Could not update court status"
    });

    logCourtActivity(
      "Court Status Changed",
      `“${overrideModal.name}” ${nextStatus ? "activated" : "deactivated"} (${overrideType})`
    );
    closeOverrideModal();
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
        <input className="ad-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courts..." />
        <span className="ad-count">{filtered.length} court{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Court grid */}
      <div className="cm-grid">
        {filtered.length === 0 && <div className="ad-empty">No courts found. Add your first court!</div>}
        {filtered.map(court => {
          const isEffectiveActive = getEffectiveCourtStatus(court);
          return (
            <div key={court.id} className={`cm-card ${isEffectiveActive ? "" : "cm-inactive"}`}>
              {court.picture && <img src={court.picture} alt={court.name} style={{ width: "100%", height: "180px", objectFit: "cover", borderTopLeftRadius: "var(--ad-radius)", borderTopRightRadius: "var(--ad-radius)", borderBottom: "1px solid var(--ad-border)" }} />}
              <div className="cm-card-header">
                <div className="flex items-center gap-2">
                  <div className="cm-card-name">{court.name}</div>
                  {court.hasPendingWrites && <span className="ad-badge ad-badge-pending text-[10px] px-1 py-0 border border-amber-500/20">Pending Sync</span>}
                </div>
                <div className="flex items-center gap-2">
                  <div className={`ad-badge ${isEffectiveActive ? "ad-badge-approved" : "ad-badge-rejected"}`}>
                    {isEffectiveActive ? "Active" : "Inactive"}
                  </div>
                </div>
              </div>
              <div className="cm-price">₱{court.pricePerHour?.toLocaleString()}<span>/hour</span></div>
              <p className="cm-desc">{court.description || "No description."}</p>
              {court.amenities?.length > 0 && (
                <div className="cm-amenities">
                  {court.amenities.map((a, i) => (
                    <span key={i} className="cm-amenity-tag">{a}</span>
                  ))}
                </div>
              )}
              <div className="cm-actions">

                <button className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => openEdit(court)} disabled={syncState !== 'idle' && syncState !== 'error'}> Edit</button>
                <button className="ad-btn ad-btn-sm ad-btn-outline" onClick={() => openOverrideModal(court)} disabled={syncState !== 'idle' && syncState !== 'error'}>
                  {isEffectiveActive ? " Deactivate" : " Activate"}
                </button>
                <button className="ad-btn ad-btn-sm ad-btn-danger" onClick={() => handleDelete(court.id)} disabled={syncState !== 'idle' && syncState !== 'error'}>
                  {syncState === 'syncing' ? "..." : " Delete"}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="ad-modal-backdrop" onClick={e => e.target === e.currentTarget && closeForm()}>
          <div className="ad-modal">
            <div className="ad-modal-header">
              <h3>{editId ? "Edit Court" : "Add New Court"}</h3>
              <button className="ad-modal-close" onClick={closeForm}>✕</button>
            </div>
            <form className="ad-modal-form" onSubmit={handleSubmit}>
              <div className="af-group">
                <label className="af-label">Court Name *</label>
                <input className="af-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Court 1" required />
              </div>
              <div className="af-group">
                <label className="af-label">Court Picture (Base64)</label>
                {form.picture && <img src={form.picture} alt="Preview" style={{ width: "100%", maxHeight: "200px", objectFit: "cover", marginBottom: "10px", borderRadius: "8px" }} />}
                <input type="file" accept="image/*" className="af-input" onChange={handlePictureUpload} />
              </div>
              <div className="af-group">
                <label className="af-label">Description</label>
                <textarea className="af-input af-textarea" value={form.description} onChange={e => set("description", e.target.value)} placeholder="Describe this court..." rows={3} />
              </div>
              <div className="af-row">
                <div className="af-group">
                  <label className="af-label">Price per Hour (₱) *</label>
                  <input className="af-input" type="number" min="0" value={form.pricePerHour} onChange={e => set("pricePerHour", e.target.value)} placeholder="200" required />
                </div>
                <div className="af-group">
                  <label className="af-label">Status</label>
                  <select className="af-input" value={form.isActive} onChange={e => set("isActive", e.target.value === "true")}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="af-group">
                <label className="af-label">Amenities <span style={{ fontWeight: 400, fontSize: "0.78rem" }}>(comma separated)</span></label>
                <input className="af-input" value={form.amenities} onChange={e => set("amenities", e.target.value)} placeholder="Lights, Water Station, Parking" />
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

      {/* Status Override Modal */}
      {overrideModal && (
        <div className="ad-modal-backdrop" onClick={e => e.target === e.currentTarget && closeOverrideModal()}>
          <div className="ad-modal" style={{ maxWidth: "400px" }}>
            <div className="ad-modal-header">
              <h3>{getEffectiveCourtStatus(overrideModal) ? "Deactivate Court" : "Activate Court"}</h3>
              <button className="ad-modal-close" onClick={closeOverrideModal}>✕</button>
            </div>
            <form className="ad-modal-form" onSubmit={handleOverrideSubmit}>
              <div className="af-group">
                <label className="af-label">Duration Type</label>
                <select className="af-input" value={overrideType} onChange={e => setOverrideType(e.target.value)}>
                  <option value="indefinite">Indefinite (Permanent)</option>
                  <option value="duration">Set Duration (Hours)</option>
                  <option value="datetime">Scheduled Date Range</option>
                </select>
              </div>

              {overrideType === "duration" && (
                <div className="af-group">
                  <label className="af-label">Hours</label>
                  <input type="number" min="0.5" step="0.5" className="af-input" value={overrideDuration} onChange={e => setOverrideDuration(Number(e.target.value))} required />
                </div>
              )}

              {overrideType === "datetime" && (
                <>
                  <div className="af-group">
                    <label className="af-label">Start Date & Time</label>
                    <input type="datetime-local" className="af-input" value={overrideStartDatetime} onChange={e => setOverrideStartDatetime(e.target.value)} required />
                  </div>
                  <div className="af-group">
                    <label className="af-label">End Date & Time</label>
                    <input type="datetime-local" className="af-input" value={overrideDatetime} onChange={e => setOverrideDatetime(e.target.value)} required />
                  </div>
                </>
              )}

              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-outline" onClick={closeOverrideModal} disabled={syncState !== 'idle' && syncState !== 'error'}>Cancel</button>
                <button type="submit" className="ad-btn ad-btn-primary" disabled={syncState !== 'idle' && syncState !== 'error'}>
                  {syncState === 'syncing' ? "Saving..." : syncState === 'offline-saved' ? "Saved Offline" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



    </div>
  );
}