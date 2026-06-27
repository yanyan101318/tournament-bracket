import React, { useState, useEffect, useMemo } from "react";
import { collection, addDoc, serverTimestamp, query, where, onSnapshot, updateDoc, doc, writeBatch, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useSystemCourts } from "../hooks/useSystemCourts";
import toast from "react-hot-toast";
import { buildReceiptHtml, printReceiptHtml, formatReceiptCurrency } from "./posReceipt";

export default function OpenPlayPage() {
  const { courts, loading: courtsLoading } = useSystemCourts();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);

  // Create Form State
  const [form, setForm] = useState({
    title: "",
    dateTime: "",
    fee: "",
    courts: [],
    category: "Beginner",
  });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Join Player State
  const [joinPlayerName, setJoinPlayerName] = useState("");
  const [joinCashReceived, setJoinCashReceived] = useState("");
  const [joining, setJoining] = useState(false);

  // Combine manual players and app participants
  const allJoinedPlayers = useMemo(() => {
    if (!selectedSession) return [];

    const manualPlayers = (selectedSession.players || []).map(p => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      type: 'manual'
    }));

    const appParticipants = (selectedSession.participants || []).map((p, idx) => ({
      id: p.uid || `app-${idx}`,
      name: p.displayName || 'Unknown',
      joinedAt: p.joinedAt,
      type: 'app'
    }));

    return [...manualPlayers, ...appParticipants].sort((a, b) => {
      const tsA = a.joinedAt?.toMillis ? a.joinedAt.toMillis() : new Date(a.joinedAt).getTime();
      const tsB = b.joinedAt?.toMillis ? b.joinedAt.toMillis() : new Date(b.joinedAt).getTime();
      return tsB - tsA; // newest first
    });
  }, [selectedSession]);

  // Fetch Open Play Sessions
  useEffect(() => {
    const q = query(collection(db, "matches"), where("type", "==", "open_play"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // sort client-side by dateTime descending
      data.sort((a, b) => b.dateTime?.toMillis() - a.dateTime?.toMillis());
      setSessions(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching open play sessions:", error);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Sync selected session if it updates in the background
  useEffect(() => {
    if (selectedSession) {
      const updated = sessions.find(s => s.id === selectedSession.id);
      if (updated) setSelectedSession(updated);
    }
  }, [sessions, selectedSession]);

  // Filter for open play courts
  const openPlayCourts = useMemo(() => {
    return courts.filter((c) => c.isOpenPlay === true);
  }, [courts]);

  const toggleCourt = (courtId) => {
    setForm((prev) => {
      const current = prev.courts;
      if (current.includes(courtId)) {
        return { ...prev, courts: current.filter((id) => id !== courtId) };
      } else {
        return { ...prev, courts: [...current, courtId] };
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Please enter an event title.");
    if (!form.dateTime) return toast.error("Please select a date and time.");
    if (form.courts.length === 0) return toast.error("Please select at least one court.");

    setSubmitting(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, "matches", editingId), {
          title: form.title.trim(),
          dateTime: new Date(form.dateTime),
          fee: form.fee === "" ? 0 : Number(form.fee),
          courts: form.courts,
          category: form.category,
        });
        toast.success("Open Play event updated!");
      } else {
        await addDoc(collection(db, "matches"), {
          title: form.title.trim(),
          dateTime: new Date(form.dateTime),
          fee: form.fee === "" ? 0 : Number(form.fee),
          courts: form.courts,
          category: form.category,
          type: "open_play",
          status: "upcoming",
          players: [],
          createdAt: serverTimestamp(),
        });
        toast.success("Open Play event created!");
      }

      setForm({ title: "", dateTime: "", fee: "", courts: [], category: "Beginner" });
      setEditingId(null);
      setShowCreateModal(false);
    } catch (error) {
      console.error("Error saving open play event:", error);
      toast.error("Failed to save Open Play event.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinPlayer = async (e) => {
    e.preventDefault();
    if (!selectedSession) return;

    const name = joinPlayerName.trim();
    if (!name) return toast.error("Player name is required");

    const cash = Number(joinCashReceived) || 0;
    const fee = Number(selectedSession.fee) || 0;

    if (cash < fee) {
      return toast.error("Cash received must be at least the entry fee.");
    }

    setJoining(true);
    try {
      const batch = writeBatch(db);

      // 1. Create Transaction (if fee > 0)
      let txRef = null;
      let changeDue = 0;

      if (fee > 0) {
        changeDue = cash - fee;
        txRef = doc(collection(db, "salesTransactions"));
        batch.set(txRef, {
          type: "pos",
          source: "open_play",
          sessionId: selectedSession.id,
          sessionTitle: selectedSession.title,
          playerName: name,
          items: [{ name: `Open Play: ${selectedSession.title}`, quantity: 1, lineTotal: fee }],
          total: fee,
          paymentMethod: "Cash",
          cashReceived: cash,
          change: changeDue,
          createdAt: serverTimestamp(),
        });
      }

      // 2. Add player to match document
      const newPlayer = {
        id: crypto.randomUUID?.() || String(Date.now()),
        name: name,
        joinedAt: new Date(),
        paidAmount: fee
      };

      const matchRef = doc(db, "matches", selectedSession.id);
      const updatedPlayers = [...(selectedSession.players || []), newPlayer];
      batch.update(matchRef, { players: updatedPlayers });

      await batch.commit();

      toast.success(`${name} successfully joined!`);

      // 3. Generate Receipt
      if (fee > 0 && txRef) {
        const receiptPayload = {
          transactionId: txRef.id,
          createdAt: new Date(),
          items: [{ name: "Open Play Entry", quantity: 1, lineTotal: fee }],
          total: fee,
          paymentMethod: "Cash",
          cashReceived: cash,
          change: changeDue,
          source: "open_play",
          headerTitle: "RANAW PICKLEBALL",
          headerLines: [
            `Open Play: ${selectedSession.title}`,
            `Player: ${name}`,
          ],
        };
        printReceiptHtml(buildReceiptHtml(receiptPayload));
      }

      setJoinPlayerName("");
      setJoinCashReceived("");
    } catch (error) {
      console.error("Error joining player:", error);
      toast.error("Failed to add player.");
    } finally {
      setJoining(false);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm("Are you sure you want to delete this Open Play session? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "matches", sessionId));
      toast.success("Open Play session deleted!");
      setSelectedSession(null);
    } catch (error) {
      console.error("Error deleting session:", error);
      toast.error("Failed to delete session.");
    }
  };

  const formatDate = (ts) => {
    if (!ts) return "TBD";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const handleEditClick = () => {
    if (!selectedSession) return;
    const d = selectedSession.dateTime?.toDate ? selectedSession.dateTime.toDate() : new Date(selectedSession.dateTime);
    const offset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - offset)).toISOString().slice(0, 16);
    
    setForm({
      title: selectedSession.title,
      dateTime: localISOTime,
      fee: selectedSession.fee,
      courts: selectedSession.courts || [],
      category: selectedSession.category || "Beginner",
    });
    setEditingId(selectedSession.id);
    setSelectedSession(null);
    setShowCreateModal(true);
  };

  const getCourtNames = (courtIds) => {
    if (!courtIds || !courtIds.length) return "No courts";
    return courtIds.map(id => {
      const c = courts.find(court => court.id === id);
      return c ? c.name : "Unknown Court";
    }).join(", ");
  };

  return (
    <div className="ad-page">
      <div className="ad-page-header flex justify-between items-end gap-4">
        <div>
          <h1 className="ad-page-title">Open Play</h1>
          <p className="ad-page-sub">Schedule sessions and manage player entries.</p>
        </div>
        <button 
          onClick={() => {
            setForm({ title: "", dateTime: "", fee: "", courts: [], category: "Beginner" });
            setEditingId(null);
            setShowCreateModal(false);
            // using setTimeout to let state settle if opening right away
            setTimeout(() => setShowCreateModal(true), 0);
          }} 
          className="ad-btn ad-btn-primary flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Create Open Play
        </button>
      </div>

      {loading ? (
        <div className="ad-loading"><div className="ad-spinner" /></div>
      ) : sessions.length === 0 ? (
        <div className="ad-empty border border-dashed border-slate-700 rounded-xl py-16">
          <span className="material-symbols-outlined text-slate-500 text-4xl mb-3 block">event_upcoming</span>
          <p className="text-slate-400">No Open Play sessions created yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => setSelectedSession(session)}
              className="ad-card p-5 cursor-pointer hover:border-cyan-500/50 transition-colors flex flex-col group"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-white text-lg group-hover:text-cyan-400 transition-colors">
                  {session.title}
                </h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-slate-800 text-slate-300 shrink-0 ml-2">
                  {session.category}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-slate-400 text-sm mb-4">
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                  {formatDate(session.dateTime)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px]">sports_tennis</span>
                  {getCourtNames(session.courts)}
                </span>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-800/50 flex justify-between items-center">
                <div className="text-sm">
                  <span className="text-slate-500">Players: </span>
                  <span className="font-bold text-white">{(session.players || []).length + (session.participants || []).length}</span>
                </div>
                <div className="text-emerald-400 font-bold font-mono">
                  {formatReceiptCurrency(session.fee || 0)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- CREATE MODAL --- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="ad-card p-0 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border-cyan-500/20" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-bold text-white">{editingId ? "Edit Open Play Session" : "Create Open Play Session"}</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800">
                <span className="material-symbols-outlined block">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <form id="create-open-play-form" onSubmit={handleSubmit} className="space-y-6">
                <div className="af-group">
                  <label className="af-label">Event Title *</label>
                  <input type="text" className="af-input" placeholder="e.g., Saturday Morning Open Play" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="af-group">
                    <label className="af-label">Date & Time *</label>
                    <input type="datetime-local" className="af-input" value={form.dateTime} onChange={(e) => setForm({ ...form, dateTime: e.target.value })} />
                  </div>
                  <div className="af-group">
                    <label className="af-label">Entry Fee *</label>
                    <input type="number" min="0" step="0.01" className="af-input" placeholder="e.g. 15.00" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
                  </div>
                  <div className="af-group">
                    <label className="af-label">Skill Category *</label>
                    <select className="af-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      <option value="Beginner">Beginner</option>
                      <option value="Novice">Novice</option>
                      <option value="Intermediate">Intermediate</option>
                      <option value="Pro">Pro</option>
                    </select>
                  </div>
                </div>

                <div className="af-group">
                  <label className="af-label mb-3">Select Courts *</label>
                  {courtsLoading ? (
                    <div className="text-slate-400 text-sm">Loading courts...</div>
                  ) : openPlayCourts.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-slate-700 bg-slate-800/30 text-center">
                      <span className="material-symbols-outlined text-slate-500 mb-2 block text-2xl">sports_tennis</span>
                      <p className="text-slate-400 text-sm">No courts are currently marked for Open Play.</p>
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {openPlayCourts.map((court) => {
                        const isSelected = form.courts.includes(court.id);
                        return (
                          <button
                            key={court.id}
                            type="button"
                            onClick={() => toggleCourt(court.id)}
                            className={`flex justify-between items-center p-3 rounded-lg border text-left transition-all ${isSelected ? "bg-cyan-500/10 border-cyan-500" : "bg-slate-800/50 border-slate-700 hover:border-slate-500"}`}
                          >
                            <span className={`font-bold ${isSelected ? "text-cyan-400" : "text-white"}`}>{court.name}</span>
                            {isSelected && <span className="material-symbols-outlined text-cyan-400 text-[18px]">check_circle</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </form>
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-xl flex justify-end gap-3">
              <button type="button" onClick={() => setShowCreateModal(false)} className="ad-btn ad-btn-outline">Cancel</button>
              <button type="submit" form="create-open-play-form" disabled={submitting} className="ad-btn ad-btn-primary">
                {submitting ? "Saving..." : (editingId ? "Save Changes" : "Create Event")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SESSION DETAILS MODAL --- */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedSession(null)}>
          <div className="ad-card p-0 max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border-cyan-500/20" onClick={e => e.stopPropagation()}>
            <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900 rounded-t-xl">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">{selectedSession.title}</h2>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">calendar_month</span> {formatDate(selectedSession.dateTime)}</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">local_offer</span> {selectedSession.category}</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">sports_tennis</span> {getCourtNames(selectedSession.courts)}</span>
                  <span className="flex items-center gap-1 font-mono text-emerald-400"><span className="material-symbols-outlined text-[16px]">payments</span> {formatReceiptCurrency(selectedSession.fee || 0)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleEditClick} 
                  className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
                  title="Edit Session"
                >
                  <span className="material-symbols-outlined block">edit</span>
                </button>
                <button 
                  onClick={() => handleDeleteSession(selectedSession.id)} 
                  className="text-red-400 hover:text-white p-2 rounded-lg hover:bg-red-500/20 transition-colors"
                  title="Delete Session"
                >
                  <span className="material-symbols-outlined block">delete</span>
                </button>
                <button onClick={() => setSelectedSession(null)} className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors">
                  <span className="material-symbols-outlined block">close</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Left Side: Add Player Form */}
              <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-800 p-6 bg-slate-900/50 flex flex-col">
                <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400">person_add</span>
                  Join Player
                </h3>

                <form onSubmit={handleJoinPlayer} className="space-y-4 flex-1">
                  <div className="af-group">
                    <label className="af-label">Player Name *</label>
                    <input
                      type="text"
                      required
                      className="af-input"
                      placeholder="e.g. John Doe"
                      value={joinPlayerName}
                      onChange={e => setJoinPlayerName(e.target.value)}
                    />
                  </div>

                  <div className="af-group">
                    <label className="af-label">Cash Received (Entry Fee: {formatReceiptCurrency(selectedSession.fee || 0)})</label>
                    <input
                      type="number"
                      min={selectedSession.fee || 0}
                      step="0.01"
                      required
                      className="af-input"
                      placeholder="0.00"
                      value={joinCashReceived}
                      onChange={e => setJoinCashReceived(e.target.value)}
                    />
                  </div>

                  {joinCashReceived && Number(joinCashReceived) >= (selectedSession.fee || 0) && (
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700 flex justify-between items-center text-sm">
                      <span className="text-slate-400">Change Due:</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {formatReceiptCurrency(Number(joinCashReceived) - (selectedSession.fee || 0))}
                      </span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={joining}
                    className="ad-btn ad-btn-primary w-full mt-4 flex justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                    {joining ? "Processing..." : "Join & Print Receipt"}
                  </button>
                </form>
              </div>

              {/* Right Side: Joined Players List */}
              <div className="w-full md:w-2/3 p-6 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-emerald-400">group</span>
                    Joined Players
                  </h3>
                  <span className="bg-slate-800 text-slate-300 text-xs font-bold px-2 py-1 rounded">
                    Total: {allJoinedPlayers.length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                  {allJoinedPlayers.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                      <p>No players have joined this session yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {allJoinedPlayers.map((player, idx) => (
                        <div key={player.id || idx} className="flex justify-between items-center p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:bg-slate-800/60 transition-colors">
                          <div>
                            <p className="font-bold text-white text-sm flex items-center gap-2">
                              {player.name}
                              {player.type === 'app' && (
                                <span className="text-[9px] uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded">Online User</span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              Joined: {player.joinedAt ? new Date(player.joinedAt.toDate ? player.joinedAt.toDate() : player.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-emerald-500 font-bold bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                              Paid
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
