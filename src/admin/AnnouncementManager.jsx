// src/admin/AnnouncementManager.jsx
import { useState, useEffect } from "react";
import {
  collection, addDoc, updateDoc, deleteDoc,
  doc, onSnapshot, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../auth/AuthContext";
import { useOfflineSync } from "../hooks/useOfflineSync";
import Pagination from "./Pagination";
import Background from "../components/Background";

const TYPES = ["info","warning","success"];
const TYPE_ICONS = { info:"ℹ️", warning:"⚠️", success:"✅" };
const TYPE_COLORS = { 
  info: { border: "#3b82f6", bg: "#1e3a5f33", text: "#93c5fd" },
  warning: { border: "#f97316", bg: "#3b1f0033", text: "#fdba74" },
  success: { border: "#22c55e", bg: "#22c55e22", text: "#4ade80" }
};
const BLANK = { title:"", message:"", type:"info", isActive:true };

// Card Component for each announcement
function AnnouncementCard({ announcement, onEdit, onToggle, onDelete }) {
  const colors = TYPE_COLORS[announcement.type] || TYPE_COLORS.info;
  
  return (
    <div className="an-card" style={{ borderLeft: `4px solid ${colors.border}` }}>
      <div className="an-card-header">
        <div className="an-card-type" style={{ background: colors.bg, color: colors.text }}>
          <span className="an-card-icon">{TYPE_ICONS[announcement.type]}</span>
          <span className="an-card-type-label">{announcement.type.toUpperCase()}</span>
        </div>
        <div className={`an-card-status ${announcement.isActive ? 'active' : 'inactive'}`}>
          {announcement.isActive ? '🟢 Active' : '🔒 Hidden'}
        </div>
        {announcement.hasPendingWrites && (
          <div className="ml-2">
            <span className="ad-badge ad-badge-pending text-[10px] px-1 py-0 border border-amber-500/20">Pending Sync</span>
          </div>
        )}
      </div>
      
      <div className="an-card-body">
        <h3 className="an-card-title">{announcement.title}</h3>
        <p className="an-card-message">{announcement.message}</p>
      </div>
      
      <div className="an-card-footer">
        <div className="an-card-meta">
          <span>By {announcement.createdBy ?? "Admin"}</span>
          <span className="an-card-date">
            {announcement.createdAt?.toDate?.()?.toLocaleDateString("en-PH", {
              month: "short", day: "numeric", year: "numeric"
            }) || "Recently"}
          </span>
        </div>
        <div className="an-card-actions">
          <button className="an-card-btn an-card-btn-edit" onClick={()=>onEdit(announcement)} disabled={announcement.disabled}> Edit</button>
          <button className="an-card-btn an-card-btn-toggle" onClick={()=>onToggle(announcement)} disabled={announcement.disabled}>
            {announcement.isActive ? " Hide" : " Show"}
          </button>
          <button className="an-card-btn an-card-btn-delete" onClick={()=>onDelete(announcement.id)} disabled={announcement.disabled}> Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementManager() {
  const { profile }   = useAuth();
  const [items, setItems]   = useState([]);
  const [form, setForm]     = useState(BLANK);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const { syncState, wrapSync } = useOfflineSync();
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const q = query(collection(db,"announcements"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, snap => {
      setItems(snap.docs.map(d=>({id:d.id, hasPendingWrites: d.metadata.hasPendingWrites, ...d.data()})));
      setPage(1);
    });
    return () => unsub();
  }, []);

  function set(k,v) { setForm(p=>({...p,[k]:v})); }
  function openAdd()  { setForm(BLANK); setEditId(null); setShowForm(true); }
  function openEdit(a){ setForm({title:a.title,message:a.message,type:a.type,isActive:a.isActive}); setEditId(a.id); setShowForm(true); }
  function close()    { setShowForm(false); setEditId(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    const payload = { title:form.title.trim(), message:form.message.trim(), type:form.type, isActive:form.isActive };
    try {
      let promise;
      if (editId) {
        promise = updateDoc(doc(db,"announcements",editId), payload);
      } else {
        promise = addDoc(collection(db,"announcements"), { ...payload, createdBy: profile?.name??"Admin", createdAt: serverTimestamp() });
      }
      
      await wrapSync(promise, {
        successMsg: editId ? "Announcement updated" : "Announcement posted",
        offlineMsg: "Action Saved Offline",
        errorMsg: "Could not save announcement"
      });
      close();
    } catch(err){ console.error(err); }
  }

  async function toggleActive(a) {
    await wrapSync(updateDoc(doc(db,"announcements",a.id), { isActive: !a.isActive }), {
      successMsg: `Announcement ${!a.isActive ? 'shown' : 'hidden'}`,
      offlineMsg: "Status Update Saved Offline",
      errorMsg: "Could not toggle visibility"
    });
  }

  async function handleDelete(id) {
    if(!window.confirm("Delete this announcement?")) return;
    await wrapSync(deleteDoc(doc(db,"announcements",id)), {
      successMsg: "Announcement deleted",
      offlineMsg: "Action Queued for Sync",
      errorMsg: "Could not delete announcement"
    });
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="page-with-bg">
      <Background />
      
      <div className="ad-page">
        <div className="ad-page-header">
          <div>
            <h1 className="ad-page-title">Announcements</h1>
            <p className="ad-page-sub">Post announcements visible to all players.</p>
          </div>
          <button className="ad-btn ad-btn-primary" onClick={openAdd}>+ New Announcement</button>
        </div>

        {items.length===0 ? (
          <div className="an-empty-state">
            <div className="an-empty-icon">📢</div>
            <h3>No announcements yet</h3>
            <p>Create your first announcement to get started!</p>
            <button className="ad-btn ad-btn-primary" onClick={openAdd}>+ Create Announcement</button>
          </div>
        ) : (
          <>
            <div className="an-cards-grid">
              {pageItems.map(a => (
                <AnnouncementCard
                  key={a.id}
                  announcement={{...a, disabled: syncState !== 'idle' && syncState !== 'error'}}
                  onEdit={openEdit}
                  onToggle={toggleActive}
                  onDelete={handleDelete}
                />
              ))}
            </div>
            <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
          </>
        )}

        {showForm && (
          <div className="ad-modal-backdrop" onClick={e=>e.target===e.currentTarget&&close()}>
            <div className="ad-modal">
              <div className="ad-modal-header">
                <h3>{editId?"Edit Announcement":"New Announcement"}</h3>
                <button className="ad-modal-close" onClick={close}>✕</button>
              </div>
              <form className="ad-modal-form" onSubmit={handleSubmit}>
                <div className="af-group">
                  <label className="af-label">Title *</label>
                  <input className="af-input" value={form.title} onChange={e=>set("title",e.target.value)} placeholder="Announcement title" required/>
                </div>
                <div className="af-group">
                  <label className="af-label">Message *</label>
                  <textarea className="af-input af-textarea" value={form.message} onChange={e=>set("message",e.target.value)} rows={4} placeholder="Announcement message..." required/>
                </div>
                <div className="af-row">
                  <div className="af-group">
                    <label className="af-label">Type</label>
                    <div className="an-type-row">
                      {TYPES.map(t=>(
                        <button key={t} type="button"
                          className={`an-type-btn an-type-${t} ${form.type===t?"active":""}`}
                          onClick={()=>set("type",t)}
                          style={{ borderColor: TYPE_COLORS[t].border, color: form.type===t ? TYPE_COLORS[t].text : 'var(--text-muted)' }}>
                          {TYPE_ICONS[t]} {t.charAt(0).toUpperCase()+t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="af-group">
                    <label className="af-label">Visibility</label>
                    <select className="af-input" value={form.isActive} onChange={e=>set("isActive",e.target.value==="true")}>
                      <option value="true">🟢 Visible to players</option>
                      <option value="false">🔒 Hidden</option>
                    </select>
                  </div>
                </div>
                <div className="ad-modal-footer">
                  <button type="button" className="ad-btn ad-btn-outline" onClick={close} disabled={syncState !== 'idle' && syncState !== 'error'}>Cancel</button>
                  <button type="submit" className="ad-btn ad-btn-primary" disabled={syncState !== 'idle' && syncState !== 'error'}>
                    {syncState === "syncing" ? "Saving..." : syncState === "offline-saved" ? "Saved Offline" : editId ? "Save Changes" : "Post Announcement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}