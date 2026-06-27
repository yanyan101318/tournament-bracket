import { useState, useEffect } from "react";
import { subscribeToTournamentsV2, createTournamentV2 } from "../../services/tournamentV2Service";
import TournamentTabs from "./TournamentTabs";

export default function TournamentManagerV2() {
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToTournamentsV2((data) => {
      setTournaments(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function handleCreate() {
    const name = prompt("Enter tournament name:");
    if (!name) return;
    try {
      const id = await createTournamentV2(name, new Date().toISOString(), "");
      setSelectedId(id);
    } catch (e) {
      alert("Failed to create tournament");
      console.error(e);
    }
  }

  if (loading) {
    return <div className="ad-loading"><div className="ad-spinner" /></div>;
  }

  if (selectedId) {
    return (
      <TournamentTabs 
        tournamentId={selectedId} 
        onBack={() => setSelectedId(null)} 
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ad-page-title">Tournament System V2</h1>
          <p className="ad-page-sub">Manage multi-division Pickleball tournaments.</p>
        </div>
        <button className="ad-btn ad-btn-primary" onClick={handleCreate}>
          + New Tournament
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tournaments.length === 0 && (
          <p className="text-slate-400">No tournaments found.</p>
        )}
        {tournaments.map(t => (
          <div key={t.id} className="ad-card p-5 hover:border-cyan-500/50 transition-colors cursor-pointer" onClick={() => setSelectedId(t.id)}>
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-white text-lg">{t.name}</h3>
              <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded-full ${
                t.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' :
                t.status === 'completed' ? 'bg-slate-700 text-slate-300' :
                'bg-amber-500/20 text-amber-400 border border-amber-500/20'
              }`}>{t.status}</span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {new Date(t.date).toLocaleDateString()} {t.venue && `• ${t.venue}`}
            </p>
            <div className="text-cyan-400 text-xs font-semibold">Manage &rarr;</div>
          </div>
        ))}
      </div>
    </div>
  );
}
