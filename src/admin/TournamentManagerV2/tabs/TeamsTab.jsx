import { useState } from "react";
import { addTeam, deleteTeam, updateTeam } from "../../../services/tournamentV2Service";
import toast from "react-hot-toast";

export default function TeamsTab({ tournamentId, divisions, teams }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    divisionId: divisions[0]?.id || "",
    player1: "",
    player2: "",
    club: ""
  });
  const [saving, setSaving] = useState(false);
  const [activeDiv, setActiveDiv] = useState(divisions[0]?.id || null);

  const selectedDiv = divisions.find(d => d.id === form.divisionId);
  const isDoubles = selectedDiv?.formatType === "doubles" || selectedDiv?.gender === "mixed";

  async function handleRegister(e) {
    e.preventDefault();
    if (!form.divisionId || !form.player1) return toast.error("Missing required fields");
    
    // Auto-generate name
    const p1First = form.player1.split(" ")[0] || form.player1;
    const p2First = form.player2 ? (form.player2.split(" ")[0] || form.player2) : null;
    const teamName = isDoubles && p2First ? `${p1First} & ${p2First}` : p1First;

    setSaving(true);
    try {
      const payload = {
        divisionId: form.divisionId,
        name: teamName,
        player1: form.player1,
        player2: isDoubles ? form.player2 : null,
        club: form.club || "No Club",
      };

      if (editingId) {
        await updateTeam(tournamentId, editingId, payload);
        toast.success("Team updated");
      } else {
        payload.seed = 0; // Only set seed on creation
        await addTeam(tournamentId, payload);
        toast.success("Team registered");
      }
      setForm({ ...form, player1: "", player2: "", club: "" });
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      toast.error(editingId ? "Update failed" : "Registration failed");
    }
    setSaving(false);
  }

  async function handleRemove(teamId) {
    if (!window.confirm("Remove this team?")) return;
    try {
      await deleteTeam(tournamentId, teamId);
    } catch (e) {
      toast.error("Failed to remove");
    }
  }

  if (divisions.length === 0) return <p className="text-slate-400">Please create a division first.</p>;

  const filteredTeams = teams.filter(t => t.divisionId === activeDiv);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-white">Teams</h3>
        <button className="ad-btn ad-btn-primary" onClick={() => {
          setShowForm(!showForm);
          if (showForm) {
            setForm({
              divisionId: activeDiv || divisions[0]?.id || "",
              player1: "",
              player2: "",
              club: ""
            });
            setEditingId(null);
          }
        }}>
          {showForm ? "Cancel" : "+ Register Team"}
        </button>
      </div>

      {showForm && (
        <div className="ad-card p-4 sm:p-6 mb-8 border-cyan-500/30">
          <h4 className="font-bold text-white mb-4">{editingId ? "Edit Team" : "Register New Team"}</h4>
          <form onSubmit={handleRegister} className="grid sm:grid-cols-2 gap-4">
            <div className="af-group">
              <label className="af-label">Division *</label>
              <select className="af-input" value={form.divisionId} onChange={(e) => setForm({...form, divisionId: e.target.value})} required>
                {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="af-group">
              <label className="af-label">Club Name (Optional)</label>
              <input className="af-input" value={form.club} onChange={(e) => setForm({...form, club: e.target.value})} placeholder="e.g. Smashers Club" />
            </div>
            <div className="af-group">
              <label className="af-label">Player 1 Name *</label>
              <input className="af-input" value={form.player1} onChange={(e) => setForm({...form, player1: e.target.value})} required />
            </div>
            {isDoubles && (
              <div className="af-group">
                <label className="af-label">Player 2 Name *</label>
                <input className="af-input" value={form.player2} onChange={(e) => setForm({...form, player2: e.target.value})} required />
              </div>
            )}
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className="ad-btn ad-btn-primary w-full">
                {saving ? "Saving..." : (editingId ? "Update Team" : "Register")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Division filter tabs for teams list */}
      <div className="flex flex-wrap gap-2 mb-4">
        {divisions.map(d => {
          const count = teams.filter(t => t.divisionId === d.id).length;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDiv(d.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeDiv === d.id ? "bg-cyan-500 text-slate-900" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
            >
              {d.name} <span className="ml-1 opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Teams Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTeams.map(t => (
          <div key={t.id} className="ad-card p-4 relative group">
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => {
                setForm({
                  divisionId: t.divisionId,
                  player1: t.player1 || "",
                  player2: t.player2 || "",
                  club: t.club || ""
                });
                setEditingId(t.id);
                setShowForm(true);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }} className="text-slate-400 hover:text-white transition-colors">
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button onClick={() => handleRemove(t.id)} className="text-slate-600 hover:text-red-400">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
            <h4 className="font-bold text-white text-base mb-1 pr-4">{t.name}</h4>
            <div className="text-[11px] text-slate-400 space-y-0.5">
              <p className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">person</span> {t.player1}</p>
              {t.player2 && <p className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">person</span> {t.player2}</p>}
              <p className="flex items-center gap-1 text-slate-500 mt-2">
                <span className="material-symbols-outlined text-[12px]">shield</span> {t.club}
              </p>
            </div>
          </div>
        ))}
        {filteredTeams.length === 0 && (
          <p className="text-slate-500 col-span-full">No teams in this division yet.</p>
        )}
      </div>
    </div>
  );
}
