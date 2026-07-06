import { useState, useEffect } from "react";
import { subscribeToPools, subscribeToMatchesV2, savePools, deletePoolsAndMatches, updateMatchScore, updatePoolStandings } from "../../../services/tournamentV2Service";
import { createPoolsAndMatches, calculateStandings } from "../../../utils/poolGenerator";
import { getShareOrigin } from "../../../utils/shareUrl";
import { copyText } from "../../../utils/clipboard";
import { QRCodeSVG } from "qrcode.react";
import { useSystemCourts } from "../../../hooks/useSystemCourts";
import toast from "react-hot-toast";

export default function PoolsTab({ tournamentId, divisions, teams }) {
  const [activeDiv, setActiveDiv] = useState(divisions[0]?.id || null);
  const [pools, setPools] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Pool gen settings
  const [numPools, setNumPools] = useState(2);
  const [scoringMode, setScoringMode] = useState("traditional");
  const [winScore, setWinScore] = useState(11);
  const [format, setFormat] = useState("bo1");

  // QR Modal State
  const [qrModalMatch, setQrModalMatch] = useState(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!tournamentId) return;
    const unsubP = subscribeToPools(tournamentId, (data) => {
      setPools(data);
      setLoading(false);
    });
    const unsubM = subscribeToMatchesV2(tournamentId, (data) => {
      setMatches(data);
    });
    return () => { unsubP(); unsubM(); };
  }, [tournamentId]);

  const selectedDiv = divisions.find(d => d.id === activeDiv);
  const divPools = pools.filter(p => p.divisionId === activeDiv);
  const divMatches = matches.filter(m => m.divisionId === activeDiv && m.poolId);
  const divTeams = teams?.filter(t => t.divisionId === activeDiv) || [];

  async function handleGeneratePools() {
    if (divTeams.length < 2) return toast.error("Not enough teams to generate matches");
    setLoading(true);
    try {
      const { pools: newPools, matches: newMatches } = createPoolsAndMatches(divTeams, numPools, scoringMode, winScore, format);
      await savePools(tournamentId, activeDiv, newPools, newMatches);
      toast.success("Matches generated successfully");
    } catch (e) {
      toast.error("Failed to generate matches");
    }
    setLoading(false);
  }

  // --- Share / Link Helpers ---
  async function copyScorerLink(matchId) {
    const shareOrigin = await getShareOrigin();
    await copyText(`${shareOrigin}/score-v2/${tournamentId}/${matchId}`);
    setCopiedId(matchId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleShowQr(match) {
    if (!match.pinCode) {
      setIsGeneratingQr(true);
      const newPin = Math.floor(100000 + Math.random() * 900000).toString();
      try {
        await updateMatchScore(tournamentId, match.id, {
          pinCode: newPin,
          pinStatus: "active"
        });
        match.pinCode = newPin;
        match.pinStatus = "active";
      } catch (err) {
        console.error("Failed to generate PIN", err);
      }
      setIsGeneratingQr(false);
    }
    setQrModalMatch(match);
  }

  async function handleRegeneratePin(match) {
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    try {
      await updateMatchScore(tournamentId, match.id, {
        pinCode: newPin,
        pinStatus: "active"
      });
      setQrModalMatch({ ...match, pinCode: newPin, pinStatus: "active" });
    } catch (err) {
      console.error("Failed to regenerate PIN", err);
    }
  }

  async function handleCopyPin(pinCode) {
    await copyText(pinCode);
    setCopiedId("pin");
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleDownloadQr(matchId) {
    const svg = document.getElementById("qr-svg-" + matchId);
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scorer-qr-${matchId}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Division Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-800 pb-4">
        {divisions.map(d => (
          <button
            key={d.id}
            onClick={() => setActiveDiv(d.id)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeDiv === d.id ? "bg-[#CCFF00] text-slate-900 shadow-[0_0_15px_rgba(204,255,0,0.4)]" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {!selectedDiv && <p className="text-slate-400">Select a division.</p>}

      {selectedDiv && !selectedDiv.poolsGenerated && (
        <div className="ad-card p-6 max-w-md border-amber-500/30">
          <h4 className="font-bold text-white mb-2">Generate Matches</h4>
          <p className="text-sm text-slate-400 mb-4">
            Distribute registered teams into initial brackets and schedule round-robin matches.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="af-group">
              <label className="af-label">Number of Brackets</label>
              <input className="af-input" type="number" min="1" max="16" value={numPools} onChange={(e) => setNumPools(Number(e.target.value))} />
            </div>
            <div className="af-group">
              <label className="af-label">Scoring Mode</label>
              <select className="af-input bg-slate-900 border border-slate-700 text-white rounded p-2 text-sm" value={scoringMode} onChange={e => setScoringMode(e.target.value)}>
                <option value="traditional">Traditional</option>
                <option value="rally">Rally</option>
              </select>
            </div>
            <div className="af-group">
              <label className="af-label">Win Score</label>
              <input className="af-input" type="number" min="1" max="99" value={winScore} onChange={(e) => setWinScore(Number(e.target.value))} />
            </div>
            <div className="af-group">
              <label className="af-label">Match Format</label>
              <select className="af-input bg-slate-900 border border-slate-700 text-white rounded p-2 text-sm" value={format} onChange={e => setFormat(e.target.value)}>
                <option value="bo1">Single Game</option>
                <option value="bo3">Best of 3</option>
                <option value="bo5">Best of 5</option>
              </select>
            </div>
          </div>
          <button
            className="ad-btn bg-amber-500 text-slate-900 w-full hover:bg-amber-400 font-bold"
            disabled={loading}
            onClick={handleGeneratePools}
          >
            {loading ? "Generating..." : "Generate Matches"}
          </button>
        </div>
      )}

      {selectedDiv && selectedDiv.poolsGenerated && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-bold text-white text-lg">Bracket Standings & Matches</h4>
            <div className="flex gap-4 items-center">
              <button
                className="text-xs text-red-400 hover:underline font-semibold"
                onClick={async () => {
                  if (window.confirm("Delete all brackets and match data for this division?")) {
                    await deletePoolsAndMatches(tournamentId, activeDiv);
                  }
                }}
              >
                Reset Brackets
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {divPools.map(pool => {
              const poolMatches = divMatches.filter(m => m.poolId === pool.id);
              // rename 'Pool A' to 'Bracket A'
              const bracketName = pool.name.replace('Pool', 'Bracket');
              // Real-time Standings!
              const dynamicStandings = calculateStandings(pool, poolMatches);
              return (
                <div key={pool.id} className="ad-card overflow-hidden flex flex-col h-full">
                  <div className="bg-slate-800/50 p-3 border-b border-slate-800">
                    <h5 className="font-bold text-[#CCFF00]">{bracketName}</h5>
                  </div>

                  {/* Standings Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900/50 text-slate-400">
                        <tr>
                          <th className="p-2 font-semibold">Team</th>
                          <th className="p-2 font-semibold text-center w-8">W</th>
                          <th className="p-2 font-semibold text-center w-8">L</th>
                          <th className="p-2 font-semibold text-center w-12">Diff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {dynamicStandings.map((s, idx) => {
                          const tObj = divTeams.find(t => t.id === s.teamId);
                          const displayName = tObj ? (tObj.name || (tObj.player2 ? `${tObj.player1} & ${tObj.player2}` : tObj.player1)) : (s.name || "Unknown Team");
                          return (
                            <tr key={s.teamId} className="hover:bg-slate-800/30">
                              <td className="p-2 text-slate-200">
                                <span className="text-slate-500 mr-2">{idx + 1}.</span>
                                {displayName}
                              </td>
                              <td className="p-2 text-center font-bold text-emerald-400">{s.wins}</td>
                              <td className="p-2 text-center font-bold text-red-400">{s.losses}</td>
                              <td className="p-2 text-center text-slate-400">{s.pointDifferential > 0 ? `+${s.pointDifferential}` : s.pointDifferential}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Matches List */}
                  <div className="p-3 bg-slate-900/30 border-t border-slate-800 mt-auto">
                    <h6 className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Matches</h6>
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                      {poolMatches.map(m => (
                        <MatchScoreRow
                          key={m.id}
                          match={m}
                          tournamentId={tournamentId}
                          pool={pool}
                          matches={poolMatches}
                          handleShowQr={() => handleShowQr(m)}
                          copyScorerLink={() => copyScorerLink(m.id)}
                          copiedId={copiedId}
                        />
                      ))}
                      {poolMatches.length === 0 && <p className="text-xs text-slate-500">No matches</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── QR & PIN MODAL ── */}
      {qrModalMatch && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setQrModalMatch(null)}>
          <div className="bg-[#151e2d] border border-slate-700 rounded-2xl max-w-[400px] w-full p-8 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white m-0">Secure Scorer Access</h2>
              <p className="text-slate-400 text-sm mt-2">Scan to score match: <strong className="text-white">{qrModalMatch.team1Name} vs {qrModalMatch.team2Name}</strong></p>
            </div>

            {isGeneratingQr ? (
              <div className="text-center py-8 text-slate-400">Generating secure PIN...</div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="bg-white p-4 rounded-xl shadow-inner">
                  <QRCodeSVG
                    id={"qr-svg-" + qrModalMatch.id}
                    value={`${window.location.origin}/score-v2/${tournamentId}/${qrModalMatch.id}`}
                    size={200}
                    level={"H"}
                  />
                </div>

                <div className="w-full bg-slate-900/50 p-4 rounded-xl border border-slate-800 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-bold">One-Time PIN</div>
                  <div className="text-4xl font-black text-[#CCFF00] tracking-[8px] font-mono">
                    {qrModalMatch.pinCode}
                  </div>
                  <div className="mt-3 flex justify-center">
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${qrModalMatch.pinStatus === 'used' ? 'bg-amber-500/20 text-amber-500' :
                        qrModalMatch.pinStatus === 'expired' || qrModalMatch.winnerId ? 'bg-red-500/20 text-red-500' :
                          'bg-emerald-500/20 text-emerald-500'
                      }`}>
                      {qrModalMatch.winnerId ? 'EXPIRED (MATCH OVER)' : (qrModalMatch.pinStatus || 'ACTIVE')}
                    </span>
                  </div>
                </div>

                <div className="flex gap-4 w-full">
                  <button
                    onClick={() => handleCopyPin(qrModalMatch.pinCode)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white font-bold text-sm hover:bg-slate-700 transition-colors">
                    {copiedId === "pin" ? "✓ Copied!" : "Copy PIN"}
                  </button>
                  <button
                    onClick={() => handleDownloadQr(qrModalMatch.id)}
                    className="flex-1 py-3 rounded-xl bg-[#CCFF00] text-slate-900 font-bold text-sm hover:bg-[#b3e600] transition-colors">
                    Download QR
                  </button>
                </div>

                <button
                  onClick={() => handleRegeneratePin(qrModalMatch)}
                  className="text-xs text-slate-500 hover:text-white underline underline-offset-2 transition-colors">
                  Regenerate PIN (Revokes previous access)
                </button>
              </div>
            )}

            <button className="absolute top-4 right-4 text-slate-500 hover:text-white" onClick={() => setQrModalMatch(null)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MatchScoreRow({ match, tournamentId, pool, matches, handleShowQr, copyScorerLink, copiedId }) {
  const [s1, setS1] = useState(match.score1 || "");
  const [s2, setS2] = useState(match.score2 || "");
  const [saving, setSaving] = useState(false);
  const { courts: systemCourts } = useSystemCourts();

  const isCompleted = match.status === "completed";

  async function handleDQ(dqTeamNum) {
    const dqName = dqTeamNum === 1 ? match.team1Name : match.team2Name;
    const winName = dqTeamNum === 1 ? match.team2Name : match.team1Name;

    if (window.confirm(`Disqualify ${dqName}?\nThis will award the match to ${winName}.`)) {
      setSaving(true);
      const winnerId = dqTeamNum === 1 ? match.team2Id : match.team1Id;
      try {
        await updateMatchScore(tournamentId, match.id, {
          score1: 0,
          score2: 0,
          winnerId,
          status: 'completed'
        });
        toast.success("Team disqualified");

        const updatedMatches = matches.map(m => m.id === match.id ? { ...m, score1: 0, score2: 0, winnerId, status: 'completed' } : m);
        const newStandings = calculateStandings(pool, updatedMatches);
        await updatePoolStandings(tournamentId, pool.id, newStandings);
      } catch (err) {
        toast.error("Failed to disqualify team");
      }
      setSaving(false);
    }
  }

  async function handleUndoMatch() {
    if (window.confirm("Undo this match result?")) {
      setSaving(true);
      try {
        await updateMatchScore(tournamentId, match.id, {
          score1: 0,
          score2: 0,
          winnerId: null,
          status: 'scheduled'
        });
        toast.success("Match reset");

        const updatedMatches = matches.map(m => m.id === match.id ? { ...m, score1: 0, score2: 0, winnerId: null, status: 'scheduled' } : m);
        const newStandings = calculateStandings(pool, updatedMatches);
        await updatePoolStandings(tournamentId, pool.id, newStandings);
      } catch (e) {
        toast.error("Failed to reset match");
      }
      setSaving(false);
    }
  }

  async function handleSave() {
    if (s1 === "" || s2 === "") return toast.error("Enter both scores");
    setSaving(true);
    
    let winnerId = null;
    const score1 = Number(s1);
    const score2 = Number(s2);
    
    if (score1 > score2) winnerId = match.team1Id;
    else if (score2 > score1) winnerId = match.team2Id;
    
    try {
      await updateMatchScore(tournamentId, match.id, {
        score1,
        score2,
        winnerId,
        status: 'completed'
      });
      toast.success("Score saved");

      const updatedMatches = matches.map(m => m.id === match.id ? { ...m, score1, score2, winnerId, status: 'completed' } : m);
      const newStandings = calculateStandings(pool, updatedMatches);
      await updatePoolStandings(tournamentId, pool.id, newStandings);
    } catch (e) {
      toast.error("Failed to save score");
    }
    setSaving(false);
  }

  return (
    <div className={`p-4 border rounded-xl flex flex-col gap-3 ${isCompleted ? 'bg-[#0a0f18] border-slate-700 opacity-70' : 'bg-[#151e2d] border-slate-700'}`}>
      <div className="flex justify-between items-center">
        <span className="text-sm font-bold text-white pr-2 truncate">{match.team1Name || 'TBD'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {!isCompleted && match.team1Id && <button onClick={() => handleDQ(1)} className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold hover:bg-red-500 hover:text-white transition-colors">DQ</button>}
          <input 
            type="number" 
            className="w-12 bg-[#0a0f18] border border-slate-700 text-white rounded px-1 py-1 text-center font-bold outline-none focus:border-cyan-500" 
            value={s1} 
            onChange={e => setS1(e.target.value)} 
            disabled={isCompleted || (!match.team1Id || match.team1Id === 'bye')} 
            placeholder="0" 
          />
        </div>
      </div>
      
      <div className="flex justify-between items-center mt-1">
        <span className="text-sm font-bold text-white pr-2 truncate">{match.team2Name || 'TBD'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {!isCompleted && match.team2Id && <button onClick={() => handleDQ(2)} className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-bold hover:bg-red-500 hover:text-white transition-colors">DQ</button>}
          <input 
            type="number" 
            className="w-12 bg-[#0a0f18] border border-slate-700 text-white rounded px-1 py-1 text-center font-bold outline-none focus:border-cyan-500" 
            value={s2} 
            onChange={e => setS2(e.target.value)} 
            disabled={isCompleted || (!match.team2Id || match.team2Id === 'bye')} 
            placeholder="0" 
          />
        </div>
      </div>
      
      <div className="flex justify-end items-center mt-1 pt-3 border-t border-slate-800/50 gap-2">
        <select 
          value={match.courtNumber || ''} 
          onChange={async (e) => {
            const val = e.target.value;
            try {
              await updateMatchScore(tournamentId, match.id, { courtNumber: val || null });
            } catch(err) {
              toast.error("Failed to assign court");
            }
          }}
          className="bg-[#0f1623] border border-slate-700 text-slate-300 text-[11px] font-bold rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-slate-500 transition-colors max-w-[120px]"
        >
          <option value="">Unassigned</option>
          {systemCourts.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <div className="flex gap-2 w-full justify-between">
          <div className="flex gap-2">
            <button onClick={copyScorerLink} className="text-[11px] bg-[#1a2333] border border-slate-700 text-slate-300 px-2 py-1.5 rounded-lg hover:text-white flex items-center gap-1 font-bold transition-colors">
              <span className="material-symbols-outlined text-[14px]">link</span> {copiedId === match.id ? 'Copied' : 'LINK'}
            </button>
            <button onClick={handleShowQr} className="text-[11px] bg-[#CCFF00] text-black px-2 py-1.5 rounded-lg hover:bg-[#b3e600] flex items-center gap-1 font-bold transition-colors">
              QR
            </button>
          </div>
          <div>
            {!isCompleted ? (
              <button onClick={handleSave} disabled={saving || (!match.team1Id || !match.team2Id)} className="text-[11px] bg-cyan-600 text-white px-3 py-1.5 rounded-lg hover:bg-cyan-500 font-bold transition-colors disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Manual'}
              </button>
            ) : (
              <button onClick={handleUndoMatch} disabled={saving} className="text-[11px] bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-500 hover:text-white font-bold transition-colors">
                {saving ? 'Wait...' : 'Undo Match'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
