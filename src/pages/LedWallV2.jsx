import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { subscribeToTournamentV2, subscribeToMatchesV2, subscribeToTeams, subscribeToPools, subscribeToDivisions } from "../services/tournamentV2Service";
import RanawLogo from "../components/RanawLogo";

function formatPlayerNames(team) {
  if (!team || (!team.player1 && !team.player2)) return { p1: "TBD", p2: "" };
  const p1 = team.player1 ? team.player1.split(' ')[0].toUpperCase() : '';
  const p2 = team.player2 ? team.player2.split(' ')[0].toUpperCase() : '';
  return { p1, p2 };
}

export default function LedWallV2() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [pools, setPools] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusedCourt, setFocusedCourt] = useState(null);

  useEffect(() => {
    const unsubT = subscribeToTournamentV2(id, setTournament);
    const unsubM = subscribeToMatchesV2(id, (m) => {
      setMatches(m);
      setLoading(false);
    });
    const unsubTm = subscribeToTeams(id, setTeams);
    const unsubP = subscribeToPools(id, setPools);
    const unsubD = subscribeToDivisions(id, setDivisions);
    return () => { unsubT(); unsubM(); unsubTm(); unsubP(); unsubD(); };
  }, [id]);

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white text-2xl font-black tracking-widest uppercase">Loading LED Wall...</div>;
  }

  if (!tournament) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-red-500 text-2xl font-black">Tournament not found</div>;
  }

  // Get active match for a specific court
  const getActiveMatch = (courtNum) => {
    return matches.find(m => String(m.courtNumber) === String(courtNum) && m.status !== 'completed');
  };

  // Get next match assigned to a court
  const getNextMatch = (courtNum, activeMatchId) => {
    const upcoming = matches.filter(m => String(m.courtNumber) === String(courtNum) && m.status === 'scheduled' && m.id !== activeMatchId);
    // Sort by poolId (so initial brackets go first) then matchNum
    upcoming.sort((a, b) => {
      if (a.poolId && !b.poolId) return -1;
      if (!a.poolId && b.poolId) return 1;
      return (a.matchNum || 0) - (b.matchNum || 0);
    });
    return upcoming[0];
  };

  const courts = [1, 2, 3, 4, 5, 6];
  const displayedCourts = focusedCourt ? [focusedCourt] : courts;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans overflow-hidden">
      <div className="bg-[#0a0f18] border-b border-slate-800 p-3 flex justify-between items-center shrink-0">
        <RanawLogo variant="nav" />
        <h1 className="text-[#CCFF00] font-black text-3xl tracking-widest uppercase m-0 leading-none">
          {tournament.name}
        </h1>
        <div className="flex gap-2">
          {focusedCourt && (
            <button 
              onClick={() => setFocusedCourt(null)}
              className="text-white px-3 py-1 rounded bg-[#CCFF00]/20 border border-[#CCFF00] text-xs font-bold transition-colors"
            >
              Back to All Courts
            </button>
          )}
          <button 
            onClick={() => navigate(`/tournament-v2/${id}`)}
            className="text-[#CCFF00] hover:text-black px-3 py-1 rounded bg-[#CCFF00]/10 border border-[#CCFF00] hover:bg-[#CCFF00] text-xs font-bold transition-colors"
          >
            Bracket View
          </button>
          <button 
            onClick={() => navigate(`/admin/tournament-v2?id=${id}`)}
            className="text-slate-500 hover:text-white px-3 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-bold transition-colors"
          >
            Exit LED
          </button>
        </div>
      </div>

      <div className={`flex-1 grid gap-4 p-4 bg-[#0a0f18] ${focusedCourt ? 'grid-cols-1 grid-rows-1' : 'grid-cols-3 grid-rows-2'}`}>
        {displayedCourts.map(courtNum => {
          const activeMatch = getActiveMatch(courtNum);
          const nextMatch = getNextMatch(courtNum, activeMatch?.id);
          
          let t1Names = { p1: "TBD", p2: "" };
          let t2Names = { p1: "TBD", p2: "" };
          
          if (activeMatch) {
            if (activeMatch.team1Id === 'bye') {
              t1Names = { p1: "BYE", p2: "" };
            } else if (activeMatch.team1Id) {
              const team1 = teams.find(t => t.id === activeMatch.team1Id);
              if (team1) t1Names = formatPlayerNames(team1);
              else t1Names = { p1: activeMatch.team1Name || "TBD", p2: "" };
            }
            
            if (activeMatch.team2Id === 'bye') {
              t2Names = { p1: "BYE", p2: "" };
            } else if (activeMatch.team2Id) {
              const team2 = teams.find(t => t.id === activeMatch.team2Id);
              if (team2) t2Names = formatPlayerNames(team2);
              else t2Names = { p1: activeMatch.team2Name || "TBD", p2: "" };
            }
          }

          let nextNames = "";
          if (nextMatch) {
            let n1 = { p1: "TBD", p2: "" };
            let n2 = { p1: "TBD", p2: "" };
            const nt1 = teams.find(t => t.id === nextMatch.team1Id);
            const nt2 = teams.find(t => t.id === nextMatch.team2Id);
            if (nt1) n1 = formatPlayerNames(nt1);
            else n1 = { p1: nextMatch.team1Name || "TBD", p2: "" };
            if (nt2) n2 = formatPlayerNames(nt2);
            else n2 = { p1: nextMatch.team2Name || "TBD", p2: "" };
            
            const n1Str = n1.p2 ? `${n1.p1} & ${n1.p2}` : n1.p1;
            const n2Str = n2.p2 ? `${n2.p1} & ${n2.p2}` : n2.p1;
            nextNames = `${n1Str} vs ${n2Str}`;
          }

          const hasMatch = !!activeMatch;
          const isTbd = hasMatch && (activeMatch.team1Id == null || activeMatch.team2Id == null);

          let bracketNameLabel = 'MEDAL BRACKET';
          let divisionNameLabel = '';
          if (activeMatch) {
            const division = divisions.find(d => d.id === activeMatch.divisionId);
            if (division) divisionNameLabel = `${division.name.toUpperCase()} • `;
            if (activeMatch.poolId) {
              const pool = pools.find(p => p.id === activeMatch.poolId);
              bracketNameLabel = pool ? pool.name.toUpperCase().replace('POOL', 'BRACKET') : 'INITIAL BRACKET';
            }
          }

          return (
            <div 
              key={courtNum} 
              onClick={() => {
                if (!focusedCourt) setFocusedCourt(courtNum);
              }}
              className={`rounded-3xl border-2 flex flex-col overflow-hidden relative shadow-2xl transition-all duration-500 ${hasMatch ? 'bg-[#121b29] border-slate-700 hover:border-[#CCFF00]/50' : 'bg-black/50 border-slate-900'} ${!focusedCourt ? 'cursor-pointer' : ''}`}
            >
              
              <div className={`py-3 text-center border-b-2 flex flex-col justify-center items-center ${hasMatch ? 'bg-[#152336] border-slate-700' : 'bg-slate-900 border-slate-900'}`}>
                <h2 className={`text-4xl ${focusedCourt ? 'text-6xl' : ''} font-black tracking-[0.2em] uppercase m-0 leading-none transition-all ${hasMatch ? 'text-[#CCFF00]' : 'text-slate-600'}`}>
                  COURT {courtNum}
                </h2>
                {hasMatch && (
                  <div className={`text-xs ${focusedCourt ? 'text-xl mt-2' : 'mt-1'} font-bold text-cyan-400 uppercase tracking-widest`}>
                    {divisionNameLabel}{activeMatch.poolId ? 'INITIAL BRACKET' : 'MEDAL BRACKET'} • {bracketNameLabel}
                  </div>
                )}
              </div>

              {hasMatch ? (
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 flex items-center justify-between px-6">
                    {/* PLAYER 1 */}
                    <div className={`flex flex-col items-center justify-center text-center ${isTbd ? 'opacity-50' : ''} ${focusedCourt ? 'w-[40%]' : 'w-[32%]'}`}>
                      <div className={`font-bold leading-tight uppercase text-white break-words drop-shadow-md flex flex-col items-center justify-center ${focusedCourt ? 'text-6xl' : 'text-3xl'}`}>
                        <span>{t1Names.p1}</span>
                        {t1Names.p2 && <span className={`text-[#CCFF00] font-black ${focusedCourt ? 'text-4xl my-2' : 'text-xl my-1'}`}>&</span>}
                        {t1Names.p2 && <span>{t1Names.p2}</span>}
                      </div>
                    </div>

                    {/* SCORE */}
                    <div className={`flex flex-col items-center justify-center shrink-0 ${focusedCourt ? 'w-[20%]' : 'w-[36%]'}`}>
                      <div className="flex items-center justify-center gap-4 w-full">
                        <div className={`font-black text-[#CCFF00] drop-shadow-[0_0_15px_rgba(204,255,0,0.5)] flex-1 text-right ${focusedCourt ? 'text-[12rem]' : 'text-7xl xl:text-8xl'}`}>
                          {activeMatch.score1 || 0}
                        </div>
                        <div className={`text-slate-500 font-black shrink-0 ${focusedCourt ? 'text-8xl' : 'text-5xl'}`}>-</div>
                        <div className={`font-black text-[#CCFF00] drop-shadow-[0_0_15px_rgba(204,255,0,0.5)] flex-1 text-left ${focusedCourt ? 'text-[12rem]' : 'text-7xl xl:text-8xl'}`}>
                          {activeMatch.score2 || 0}
                        </div>
                      </div>
                      <div className={`mt-2 font-black text-slate-400 tracking-[0.3em] uppercase ${focusedCourt ? 'text-2xl mt-6' : 'text-sm'}`}>
                        GAME SCORE
                      </div>
                    </div>

                    {/* PLAYER 2 */}
                    <div className={`flex flex-col items-center justify-center text-center ${isTbd ? 'opacity-50' : ''} ${focusedCourt ? 'w-[40%]' : 'w-[32%]'}`}>
                      <div className={`font-bold leading-tight uppercase text-white break-words drop-shadow-md flex flex-col items-center justify-center ${focusedCourt ? 'text-6xl' : 'text-3xl'}`}>
                        <span>{t2Names.p1}</span>
                        {t2Names.p2 && <span className={`text-[#CCFF00] font-black ${focusedCourt ? 'text-4xl my-2' : 'text-xl my-1'}`}>&</span>}
                        {t2Names.p2 && <span>{t2Names.p2}</span>}
                      </div>
                    </div>
                  </div>

                  {/* NEXT UP BAR */}
                  <div className={`bg-[#0f1722] border-t border-slate-800 text-center flex items-center justify-center gap-3 ${focusedCourt ? 'py-6 px-8' : 'py-2 px-4'}`}>
                    <span className={`text-amber-500 font-bold tracking-widest uppercase ${focusedCourt ? 'text-2xl' : 'text-sm'}`}>UP NEXT:</span>
                    <span className={`text-slate-300 font-semibold truncate uppercase ${focusedCourt ? 'text-2xl' : 'text-sm'}`}>
                      {nextMatch ? nextNames : "NO MATCH SCHEDULED"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-5xl font-black text-slate-800 tracking-widest uppercase">NO MATCH</span>
                </div>
              )}
              
            </div>
          );
        })}
      </div>
    </div>
  );
}
