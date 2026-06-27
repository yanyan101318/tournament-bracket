import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { subscribeToTournamentV2, subscribeToDivisions, subscribeToTeams, subscribeToPools, subscribeToMatchesV2 } from "../services/tournamentV2Service";
import RanawLogo from "../components/RanawLogo";
import { calculateStandings } from "../utils/poolGenerator";

export default function PublicTournamentView() {
  const { id } = useParams();
  const [tournament, setTournament] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const [teams, setTeams] = useState([]);
  const [pools, setPools] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const focusId = searchParams.get("focus");

  const [activeTab, setActiveTab] = useState("divisions"); // divisions, pools, bracket

  useEffect(() => {
    const unsubT = subscribeToTournamentV2(id, (data) => {
      setTournament(data);
      setLoading(false);
    });
    const unsubD = subscribeToDivisions(id, setDivisions);
    const unsubTm = subscribeToTeams(id, setTeams);
    const unsubP = subscribeToPools(id, setPools);
    const unsubM = subscribeToMatchesV2(id, setMatches);

    return () => { unsubT(); unsubD(); unsubTm(); unsubP(); unsubM(); };
  }, [id]);

  if (loading) return <div className="ad-loading bg-[#0a0f18] min-h-screen text-white"><div className="ad-spinner" /></div>;
  if (!tournament) return <div className="bg-[#0a0f18] min-h-screen flex items-center justify-center text-white"><p>Tournament not found.</p></div>;

  if (focusId) {
    const focusMatch = matches.find(m => m.id === focusId);
    if (focusMatch) {
      return (
        <div className="vp2-page led-page led-page-focus" style={{ minHeight: '100vh', background: '#0a0f18' }}>
          <div className="led-focus-view">
            <button type="button" className="led-focus-close" onClick={() => navigate(`/tournament-v2/${id}`)} aria-label="Close">
              <span className="material-symbols-outlined">close</span>
            </button>
            <div className={`led-card led-card-zoomed ${focusMatch.status === 'completed' ? "led-done" : ""}`} style={{ background: '#151e2d', border: '1px solid #334155' }}>
              <div className="led-card-topbar">
                <span className="led-court-label">{focusMatch.round} • Match {focusMatch.matchNum || "Play"}</span>
              </div>
              <div className="led-card-center">
                <div className="led-team-col">
                  <div className="led-team-name">{focusMatch.team1Name || "TBD"}</div>
                  {focusMatch.winnerId === focusMatch.team1Id && <div className="led-winner-tag">WINNER</div>}
                </div>
                <div className="led-score-col">
                  <div className="led-main-score">
                    <span className="led-score-num led-score-a">{focusMatch.score1 || 0}</span>
                    <span className="led-score-sep">-</span>
                    <span className="led-score-num led-score-b">{focusMatch.score2 || 0}</span>
                  </div>
                </div>
                <div className="led-team-col led-team-col-right">
                  <div className="led-team-name">{focusMatch.team2Name || "TBD"}</div>
                  {focusMatch.winnerId === focusMatch.team2Id && <div className="led-winner-tag">WINNER</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f18] text-white">
      <nav className="bg-[#151e2d] border-b border-slate-800 p-4">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 sm:gap-6">
            <RanawLogo variant="nav" />
            <div>
              <h1 className="font-bold text-xl text-[#CCFF00] m-0 leading-tight">{tournament.name}</h1>
              <p className="text-xs text-slate-400 mt-1">
                {new Date(tournament.date).toLocaleDateString()} {tournament.venue && `• ${tournament.venue}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => navigate(`/tournament-v2/${id}/led-wall`)}
              className="text-[#CCFF00] hover:text-black px-4 py-2 rounded-lg bg-[#CCFF00]/10 border border-[#CCFF00] hover:bg-[#CCFF00] text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_15px_rgba(204,255,0,0.15)] flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">tv</span> LED View
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-[1200px] mx-auto p-4 sm:p-6">
        <div className="flex flex-wrap gap-2 mb-8">
          {[
            { id: 'divisions', label: 'Divisions' },
            { id: 'pools', label: 'Initial Brackets' },
            { id: 'bracket', label: 'Medal Bracket' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition-colors ${activeTab === t.id ? 'bg-[#CCFF00] text-slate-900 shadow-[0_0_15px_rgba(204,255,0,0.3)]' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "divisions" && <PublicDivisions divisions={divisions} teams={teams} />}
        {activeTab === "pools" && <PublicPools divisions={divisions} pools={pools} matches={matches} />}
        {activeTab === "bracket" && <PublicBracket divisions={divisions} matches={matches} />}
      </div>
    </div>
  );
}

function PublicDivisions({ divisions, teams }) {
  if (divisions.length === 0) return <p className="text-slate-400">No divisions announced yet.</p>;
  return (
    <div className="space-y-8">
      {divisions.map(d => {
        const divTeams = teams.filter(t => t.divisionId === d.id);
        return (
          <div key={d.id} className="bg-[#151e2d] rounded-xl border border-slate-800 overflow-hidden shadow-lg">
            <div className="bg-slate-800/50 p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-bold text-lg text-white">{d.name}</h3>
              <span className="text-xs font-bold text-slate-400">{divTeams.length} / {d.maxTeams} Teams</span>
            </div>
            <div className="p-4 grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {divTeams.map((t, idx) => (
                <div key={t.id} className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg flex gap-3 items-center">
                  <div className="w-6 h-6 rounded bg-[#CCFF00]/10 text-[#CCFF00] font-bold text-[10px] flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate text-white">{t.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{t.club}</p>
                  </div>
                </div>
              ))}
              {divTeams.length === 0 && <p className="text-xs text-slate-500">No teams registered yet.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PublicPools({ divisions, pools, matches }) {
  const [activeDiv, setActiveDiv] = useState(divisions[0]?.id || null);

  if (divisions.length === 0) return <p className="text-slate-400">No divisions yet.</p>;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-4 mb-4">
        {divisions.map(d => (
          <button key={d.id} onClick={() => setActiveDiv(d.id)} className={`px-4 py-2 shrink-0 rounded-full text-xs font-bold ${activeDiv === d.id ? 'bg-cyan-500 text-slate-900' : 'bg-slate-800 text-slate-400'}`}>
            {d.name}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {pools.filter(p => p.divisionId === activeDiv).map(pool => {
          const poolMatches = matches.filter(m => m.poolId === pool.id);
          const bracketName = pool.name.replace('Pool', 'Bracket');
          return (
            <div key={pool.id} className="bg-[#151e2d] border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-3 bg-slate-800/50 border-b border-slate-800 font-bold text-[#CCFF00]">{bracketName}</div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/50 text-slate-400">
                  <tr>
                    <th className="p-2 font-semibold pl-4">Team</th>
                    <th className="p-2 font-semibold text-center w-8">W</th>
                    <th className="p-2 font-semibold text-center w-8">L</th>
                    <th className="p-2 font-semibold text-center w-12">Diff</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {calculateStandings(pool, poolMatches).map((s, idx) => (
                    <tr key={s.teamId} className="hover:bg-slate-800/30">
                      <td className="p-2 pl-4 text-slate-200">
                        <span className="text-slate-500 mr-2">{idx + 1}.</span>
                        {s.name}
                      </td>
                      <td className="p-2 text-center font-bold text-emerald-400">{s.wins}</td>
                      <td className="p-2 text-center font-bold text-red-400">{s.losses}</td>
                      <td className="p-2 text-center text-slate-400">{s.pointDifferential > 0 ? `+${s.pointDifferential}` : s.pointDifferential}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="p-3 bg-slate-900/30 border-t border-slate-800 space-y-2 max-h-[300px] overflow-y-auto">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Matches</p>
                {poolMatches.map(m => (
                  <div key={m.id} className="flex justify-between items-center text-xs p-2 bg-slate-800/40 rounded border border-slate-700">
                    <span className={m.winnerId === m.team1Id ? "text-emerald-400 font-bold" : "text-slate-300"}>{m.team1Name}</span>
                    {m.status === 'completed' ? (
                      <span className="font-bold px-2 bg-slate-900 rounded">{m.score1} - {m.score2}</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">VS</span>
                    )}
                    <span className={m.winnerId === m.team2Id ? "text-emerald-400 font-bold" : "text-slate-300"}>{m.team2Name}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PublicBracket({ divisions, matches }) {
  const [activeDiv, setActiveDiv] = useState(divisions[0]?.id || null);

  if (divisions.length === 0) return <p className="text-slate-400">No divisions yet.</p>;

  const divMatches = matches.filter(m => m.divisionId === activeDiv && !m.poolId);
  const rounds = {};
  divMatches.forEach(m => {
    if (!rounds[m.roundNum]) rounds[m.roundNum] = { name: m.round, matches: [] };
    rounds[m.roundNum].matches.push(m);
  });
  const sortedRounds = Object.keys(rounds).sort((a,b) => Number(a) - Number(b));

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-4 mb-4">
        {divisions.map(d => (
          <button key={d.id} onClick={() => setActiveDiv(d.id)} className={`px-4 py-2 shrink-0 rounded-full text-xs font-bold ${activeDiv === d.id ? 'bg-cyan-500 text-slate-900' : 'bg-slate-800 text-slate-400'}`}>
            {d.name}
          </button>
        ))}
      </div>

      {divMatches.length === 0 ? (
        <p className="text-slate-400 text-center py-10">Bracket not generated yet.</p>
      ) : (
        <div className="relative overflow-x-auto pb-12 pt-4">
          <div className="flex gap-12 min-w-max px-4">
            {sortedRounds.map(rNum => {
              const roundData = rounds[rNum];
              const roundMatches = [...roundData.matches].sort((a,b) => a.matchNum - b.matchNum);
              
              return (
                <div key={rNum} className="flex flex-col relative w-[320px]">
                  <div className="flex justify-center mb-6">
                    <span className="px-4 py-1.5 rounded-full bg-slate-800 text-slate-300 text-xs font-bold tracking-widest uppercase border border-slate-700">
                      {roundData.name}
                    </span>
                  </div>

                  <div className="flex flex-col justify-around h-full gap-8">
                    {roundMatches.map(m => {
                      const isBye = m.team1Id === 'bye' || m.team2Id === 'bye';
                      const isCompleted = m.status === 'completed';
                      const isWaiting = !m.team1Id || !m.team2Id;

                      const t1Initials = m.team1Name ? m.team1Name.substring(0, 2).toUpperCase() : '?';
                      const t2Initials = m.team2Name ? m.team2Name.substring(0, 2).toUpperCase() : '?';

                      return (
                        <div key={m.id} className="relative flex items-center">
                          <div className={`w-full bg-[#151e2d] border rounded-xl overflow-hidden shadow-lg flex flex-col ${isCompleted ? 'border-slate-700 opacity-80' : isWaiting ? 'border-slate-800 opacity-60' : 'border-[#CCFF00]/40'} ${isBye ? 'opacity-40' : ''}`}>
                            <div className="flex justify-between items-center px-3 py-2 bg-slate-900/50 border-b border-slate-800">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                {m.round.substring(0, 2)}-M{m.matchNum}
                              </span>
                              {isWaiting ? (
                                <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                                  WAITING
                                </span>
                              ) : isCompleted ? (
                                <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                                  FINAL
                                </span>
                              ) : null}
                            </div>

                            <div className="p-4 flex items-center justify-between">
                              <div className="flex flex-col items-center gap-1 w-[80px]">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${m.winnerId === m.team1Id ? 'bg-[#CCFF00] text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
                                  {m.team1Id === 'bye' ? 'BYE' : t1Initials}
                                </div>
                                <span className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${m.winnerId === m.team1Id ? 'text-white' : 'text-slate-400'}`}>
                                  {m.team1Name || 'TBD'}
                                </span>
                              </div>

                              <div className="flex flex-col items-center justify-center">
                                <span className="text-2xl font-black text-white tracking-widest">
                                  {isCompleted || (m.score1 || m.score2) ? `${m.score1 || 0} - ${m.score2 || 0}` : 'VS'}
                                </span>
                              </div>

                              <div className="flex flex-col items-center gap-1 w-[80px]">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${m.winnerId === m.team2Id ? 'bg-[#CCFF00] text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
                                  {m.team2Id === 'bye' ? 'BYE' : t2Initials}
                                </div>
                                <span className={`text-[10px] font-semibold text-center leading-tight truncate w-full ${m.winnerId === m.team2Id ? 'text-white' : 'text-slate-400'}`}>
                                  {m.team2Name || 'TBD'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {m.nextMatchId && (
                            <div className="absolute left-full w-12 h-px bg-slate-700 z-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
