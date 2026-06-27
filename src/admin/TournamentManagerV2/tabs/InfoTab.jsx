import { useState } from "react";
import { updateTournamentV2, deleteTournamentV2 } from "../../../services/tournamentV2Service";
import toast from "react-hot-toast";

export default function InfoTab({ tournament, onBack }) {
  // force hot reload
  const [form, setForm] = useState({
    name: tournament.name || "",
    date: tournament.date || "",
    venue: tournament.venue || "",
    status: tournament.status || "draft"
  });
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateTournamentV2(tournament.id, form);
      toast.success("Tournament info saved.");
    } catch (err) {
      toast.error("Failed to save.");
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!window.confirm("Are you sure you want to delete this tournament? This action cannot be undone.")) return;
    setSaving(true);
    try {
      await deleteTournamentV2(tournament.id);
      toast.success("Tournament deleted.");
      if (onBack) onBack();
    } catch (err) {
      toast.error("Failed to delete tournament.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h3 className="text-lg font-bold text-white mb-4">Tournament Settings</h3>
      <form onSubmit={handleSave} className="space-y-4">
        <div className="af-group">
          <label className="af-label">Tournament Name *</label>
          <input className="af-input" required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
        </div>
        <div className="af-group">
          <label className="af-label">Date</label>
          <input className="af-input" type="date" value={form.date?.split("T")[0] || ""} onChange={(e) => setForm({...form, date: e.target.value})} />
        </div>
        <div className="af-group">
          <label className="af-label">Venue</label>
          <input className="af-input" value={form.venue} onChange={(e) => setForm({...form, venue: e.target.value})} />
        </div>
        <div className="af-group">
          <label className="af-label">Status</label>
          <select className="af-input" value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div className="flex gap-4 pt-4 border-t border-slate-800">
          <button type="submit" disabled={saving} className="ad-btn ad-btn-primary flex-1">
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button type="button" disabled={saving} onClick={handleDelete} className="ad-btn bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 px-4">
            Delete Tournament
          </button>
        </div>
      </form>
    </div>
  );
}
