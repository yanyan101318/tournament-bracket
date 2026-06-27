import { useState } from "react";
import { createDivision, deleteDivision, updateDivision } from "../../../services/tournamentV2Service";
import toast from "react-hot-toast";

const BLANK_DIV = {
  name: "",
  gender: "mixed",
  formatType: "doubles",
  skillLevel: "open",
  ageGroup: "",
  tournamentFormat: "pool+medal",
  scoring: "traditional",
  maxTeams: 16
};

export default function DivisionsTab({ tournamentId, divisions }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK_DIV);
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name required");
    setSaving(true);
    try {
      if (editingId) {
        await updateDivision(tournamentId, editingId, form);
        toast.success("Division updated");
      } else {
        await createDivision(tournamentId, form);
        toast.success("Division created");
      }
      setForm(BLANK_DIV);
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      toast.error(editingId ? "Failed to update" : "Failed to create");
    }
    setSaving(false);
  }

  async function handleDelete(divId) {
    if (!window.confirm("Delete this division and all its teams/matches?")) return;
    try {
      await deleteDivision(tournamentId, divId);
      toast.success("Division deleted");
    } catch (e) {
      toast.error("Delete failed");
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-white">Divisions</h3>
        <button className="ad-btn ad-btn-primary" onClick={() => {
          setShowForm(!showForm);
          if (showForm) {
            setForm(BLANK_DIV);
            setEditingId(null);
          }
        }}>
          {showForm ? "Cancel" : "+ Add Division"}
        </button>
      </div>

      {showForm && (
        <div className="ad-card p-4 sm:p-6 mb-8 border-cyan-500/30">
          <h4 className="font-bold text-white mb-4">{editingId ? "Edit Division" : "Create New Division"}</h4>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="af-group">
                <label className="af-label">Division Name *</label>
                <input className="af-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mixed Doubles Open" required />
              </div>
              <div className="af-group">
                <label className="af-label">Max Teams</label>
                <input className="af-input" type="number" min="2" value={form.maxTeams} onChange={(e) => setForm({ ...form, maxTeams: Number(e.target.value) })} />
              </div>

              <div className="af-group">
                <label className="af-label">Gender</label>
                <div className="flex gap-2">
                  {['men', 'women', 'mixed'].map(g => (
                    <button key={g} type="button" onClick={() => setForm({ ...form, gender: g })} className={`flex-1 py-2 text-xs rounded-lg font-bold uppercase transition-colors ${form.gender === g ? 'bg-cyan-500 text-slate-900' : 'bg-slate-800 text-slate-400'}`}>{g}</button>
                  ))}
                </div>
              </div>

              <div className="af-group">
                <label className="af-label">Skill Level</label>
                <div className="flex gap-2">
                  {['beginner', 'novice', 'advanced', 'open'].map(s => (
                    <button key={s} type="button" onClick={() => setForm({ ...form, skillLevel: s })} className={`flex-1 py-2 text-xs rounded-lg font-bold uppercase transition-colors ${form.skillLevel === s ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-400'}`}>{s}</button>
                  ))}
                </div>
              </div>

              <div className="af-group">
                <label className="af-label">Tournament Format</label>
                <select className="af-input" value={form.tournamentFormat} onChange={(e) => setForm({ ...form, tournamentFormat: e.target.value })}>
                  <option value="pool+medal">Round Robin + Single Elimination</option>
                  <option value="single-elim">Single Elimination</option>
                  <option value="round-robin">Round Robin</option>
                </select>
              </div>
            </div>

            <button type="submit" disabled={saving} className="ad-btn ad-btn-primary w-full mt-4">
              {saving ? "Saving..." : (editingId ? "Update Division" : "Create Division")}
            </button>
          </form>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {divisions.map(d => (
          <div key={d.id} className="ad-card p-4 relative">
            <div className="absolute top-3 right-3 flex gap-2">
              <button onClick={() => {
                setForm(d);
                setEditingId(d.id);
                setShowForm(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-[18px]">edit</span>
              </button>
              <button onClick={() => handleDelete(d.id)} className="text-red-400 hover:text-red-300 transition-colors">
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
            <h4 className="font-bold text-white text-lg mb-1 pr-16">{d.name}</h4>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">{d.gender}</span>
              <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{d.skillLevel}</span>
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <p>Format: <span className="text-slate-300">{d.tournamentFormat}</span></p>
              <p>Max Teams: <span className="text-slate-300">{d.maxTeams}</span></p>
              <p>Status: <span className={`font-semibold ${d.status === 'active' ? 'text-[#CCFF00]' : 'text-slate-300'}`}>{d.status}</span></p>
            </div>
          </div>
        ))}
        {divisions.length === 0 && !showForm && (
          <p className="text-slate-400 col-span-full">No divisions created yet.</p>
        )}
      </div>
    </div>
  );
}
