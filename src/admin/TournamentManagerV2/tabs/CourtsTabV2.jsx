import { useState, useEffect } from "react";
import { subscribeToMatchesV2, subscribeToTeams, updateMatchScore } from "../../../services/tournamentV2Service";
import toast from "react-hot-toast";
import { useSystemCourts } from "../../../hooks/useSystemCourts";

function formatPlayerNames(team) {
  if (!team || (!team.player1 && !team.player2)) return "TBD";
  const p1 = team.player1 ? team.player1.split(' ')[0] : '';
  const p2 = team.player2 ? team.player2.split(' ')[0] : '';
  if (p1 && p2) return `${p1} & ${p2}`;
  return p1 || p2;
}

export default function CourtsTabV2({ tournamentId }) {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const { courts: systemCourts } = useSystemCourts();

  useEffect(() => {
    const unsubM = subscribeToMatchesV2(tournamentId, (m) => {
      setMatches(m);
      setLoading(false);
    });
    const unsubTm = subscribeToTeams(tournamentId, setTeams);
    return () => { unsubM(); unsubTm(); };
  }, [tournamentId]);

  // Helper: check if a match is "ready" (has both teams, not BYE, and scheduled)
  const isMatchReady = (m) => {
    return m.status === 'scheduled' && 
           m.team1Id && m.team2Id && 
           m.team1Id !== 'bye' && m.team2Id !== 'bye';
  };

  const handleAutoAssign = async () => {
    if (processing) return;
    setProcessing(true);
    
    const assignedCourts = new Set(matches.filter(m => m.courtNumber && m.status !== 'completed').map(m => String(m.courtNumber)));

    // Find empty courts
    const emptyCourts = systemCourts.filter(c => {
      return !assignedCourts.has(String(c.id));
    });

    if (emptyCourts.length === 0) {
      toast.error("No empty courts available");
      setProcessing(false);
      return;
    }

    // Find unassigned ready matches
    const unassignedReady = matches.filter(m => !m.courtNumber && isMatchReady(m));
    
    // Prioritize pool play, then matchNum
    unassignedReady.sort((a, b) => {
      if (a.poolId && !b.poolId) return -1;
      if (!a.poolId && b.poolId) return 1;
      return (a.matchNum || 0) - (b.matchNum || 0);
    });

    if (unassignedReady.length === 0) {
      toast("No ready matches left to assign", { icon: '👏' });
      setProcessing(false);
      return;
    }

    // Assign matches to empty courts
    const assignments = Math.min(emptyCourts.length, unassignedReady.length);
    let assignedCount = 0;
    
    for (let i = 0; i < assignments; i++) {
      const courtId = emptyCourts[i].id;
      const match = unassignedReady[i];
      try {
        await updateMatchScore(tournamentId, match.id, { courtNumber: String(courtId) });
        assignedCount++;
      } catch (e) {
        console.error("Failed to auto assign", e);
      }
    }
    
    toast.success(`Auto-assigned ${assignedCount} matches!`);
    setProcessing(false);
  };

  const handleClearCourt = async (matchId) => {
    try {
      await updateMatchScore(tournamentId, matchId, { courtNumber: '' });
      toast.success("Court cleared");
    } catch (e) {
      toast.error("Failed to clear court");
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading courts...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="font-bold text-white text-lg">Court Assignments</h3>
          <p className="text-xs text-slate-400">Manage matches actively playing on courts</p>
        </div>
        <button 
          onClick={handleAutoAssign}
          disabled={processing}
          className="bg-[#CCFF00] hover:bg-[#b3e600] text-slate-900 px-4 py-2 rounded-lg font-bold text-sm shadow-[0_0_10px_rgba(204,255,0,0.2)] transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">bolt</span>
          Auto-Assign Courts
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {systemCourts.map(court => {
          const courtMatches = matches.filter(m => String(m.courtNumber) === String(court.id));
          const activeMatch = courtMatches.find(m => m.status === 'scheduled');
          const nextMatch = matches.find(m => String(m.courtNumber) === String(court.id) && m.status === 'scheduled' && (!activeMatch || m.id !== activeMatch.id));
          
          let statusText = "AVAILABLE";
          let statusColor = "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
          let indicator = "🟢";

          if (activeMatch) {
            const hasStarted = activeMatch.score1 > 0 || activeMatch.score2 > 0;
            if (hasStarted) {
              statusText = "IN PROGRESS";
              statusColor = "text-amber-400 bg-amber-400/10 border-amber-400/20";
              indicator = "🔴";
            } else {
              statusText = "SCHEDULED (WAITING)";
              statusColor = "text-cyan-400 bg-cyan-400/10 border-cyan-400/20";
              indicator = "⏳";
            }
          }

          let t1Names = "TBD", t2Names = "TBD";
          if (activeMatch) {
            const t1 = teams.find(t => t.id === activeMatch.team1Id);
            const t2 = teams.find(t => t.id === activeMatch.team2Id);
            t1Names = t1 ? formatPlayerNames(t1) : (activeMatch.team1Name || "TBD");
            t2Names = t2 ? formatPlayerNames(t2) : (activeMatch.team2Name || "TBD");
          }

          return (
            <div key={court.id} className="bg-[#151e2d] border border-[#CCFF00]/20 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#CCFF00]/50 to-transparent opacity-50"></div>
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#CCFF00]">sports_tennis</span>
                    {court.name}
                  </h3>
                </div>
                <div className={`px-2 py-1 rounded text-[10px] font-bold border flex items-center gap-1 ${statusColor}`}>
                  <span>{indicator}</span> {statusText}
                </div>
              </div>

              <div className="p-4 flex-1">
                {activeMatch ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                      <div className="flex-1 text-center">
                        <div className="text-sm font-bold text-white truncate px-1">{t1Names}</div>
                        <div className="text-2xl font-black text-[#CCFF00]">{activeMatch.score1 || 0}</div>
                      </div>
                      <div className="text-slate-500 font-bold text-xs px-2">VS</div>
                      <div className="flex-1 text-center">
                        <div className="text-sm font-bold text-white truncate px-1">{t2Names}</div>
                        <div className="text-2xl font-black text-[#CCFF00]">{activeMatch.score2 || 0}</div>
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center mt-2">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                        {activeMatch.poolId ? 'Pool Play' : 'Bracket'} • {activeMatch.round}
                      </div>
                      <button 
                        onClick={() => handleClearCourt(activeMatch.id)}
                        className="text-[10px] text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/30 px-2 py-1 rounded font-bold transition-colors"
                      >
                        Unassign
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[100px] flex items-center justify-center border-2 border-dashed border-slate-700 rounded-lg bg-slate-900/20">
                    <span className="text-slate-500 font-bold uppercase tracking-widest text-sm">No Match Assigned</span>
                  </div>
                )}
              </div>

              {nextMatch && (
                <div className="bg-slate-900 p-2 border-t border-slate-700 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-amber-500 uppercase">Up Next</span>
                  <span className="text-xs text-slate-300 font-bold">{nextMatch.team1Name} vs {nextMatch.team2Name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
