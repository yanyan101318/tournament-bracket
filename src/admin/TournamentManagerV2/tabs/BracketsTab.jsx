import { useState, useEffect } from "react";
import { subscribeToMatchesV2, subscribeToPools, updateMatchScore } from "../../../services/tournamentV2Service";
import { generateMedalBracket } from "../../../utils/bracketV2Generator";
import { getShareOrigin } from "../../../utils/shareUrl";
import { copyText } from "../../../utils/clipboard";
import { writeBatch, doc } from "firebase/firestore";
import { db } from "../../../firebase";
import { QRCodeSVG } from "qrcode.react";
import { useSystemCourts } from "../../../hooks/useSystemCourts";
import toast from "react-hot-toast";

export default function BracketsTab({ tournamentId, divisions }) {
  const [activeDiv, setActiveDiv] = useState(divisions[0]?.id || null);
  const [matches, setMatches] = useState([]);
  const [pools, setPools] = useState([]);
  const [, setLoading] = useState(true);

  // QR Modal State
  const [qrModalMatch, setQrModalMatch] = useState(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const { courts: systemCourts } = useSystemCourts();

  useEffect(() => {
    if (!tournamentId) return;
    const unsubM = subscribeToMatchesV2(tournamentId, (data) => {
      setMatches(data);
      setLoading(false);
    });
    const unsubP = subscribeToPools(tournamentId, setPools);
    return () => { unsubM(); unsubP(); };
  }, [tournamentId]);

  const selectedDiv = divisions.find(d => d.id === activeDiv);
  const divMatches = matches.filter(m => m.divisionId === activeDiv && !m.poolId);
  const divPools = pools.filter(p => p.divisionId === activeDiv);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [advanceCount, setAdvanceCount] = useState(2);
  const [bracketType, setBracketType] = useState("single-elimination");
  const [scoringMode, setScoringMode] = useState("traditional");
  const [winScore, setWinScore] = useState(11);
  const [format, setFormat] = useState("bo1");

  async function executeGenerateBracket() {
    setShowGenerateModal(false);
    const existingMedal = divMatches;
    if (existingMedal.length > 0) {
      if (!window.confirm("This will overwrite your existing Medal Bracket matches. Are you sure?")) {
        return;
      }
    }

    let advancingTeams = [];
    divPools.forEach(p => {
      const poolMatches = matches.filter(m => m.poolId === p.id);
      const isComplete = poolMatches.length > 0 && poolMatches.every(m => m.status === 'completed');

      const sorted = [...(p.standings || [])].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.pointDifferential !== a.pointDifferential) return b.pointDifferential - a.pointDifferential;
        return b.pointsFor - a.pointsFor;
      });
      
      const topN = sorted.slice(0, advanceCount).map((s, idx) => {
        if (isComplete) {
          return { id: s.teamId, name: s.name, poolSeed: p.name };
        } else {
          const bracketName = p.name.replace('Pool', 'Bracket');
          const placeStr = idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx+1}th`;
          return { id: null, name: `TBD (${bracketName} ${placeStr})`, poolSeed: p.name };
        }
      });
      advancingTeams = [...advancingTeams, ...topN];
    });

    if (advancingTeams.length < 2) {
      return toast.error("Not enough teams to generate bracket.");
    }

    try {
      const bracketMatches = generateMedalBracket(advancingTeams, activeDiv, bracketType, scoringMode, winScore, format);
      const batch = writeBatch(db);
      
      existingMedal.forEach(m => {
        const ref = doc(db, "tournamentsV2", tournamentId, "matches", m.id);
        batch.delete(ref);
      });
      
      bracketMatches.forEach(m => {
        const ref = doc(db, "tournamentsV2", tournamentId, "matches", m.id);
        batch.set(ref, m);
      });
      await batch.commit();
      toast.success("Medal Bracket Generated!");
    } catch (e) {
      toast.error("Failed to generate bracket");
      console.error(e);
    }
  }

  const rounds = {};
  divMatches.forEach(m => {
    if (!rounds[m.roundNum]) rounds[m.roundNum] = { name: m.round, matches: [] };
    rounds[m.roundNum].matches.push(m);
  });
  const sortedRounds = Object.keys(rounds).sort((a,b) => Number(a) - Number(b));

  // --- Share / Link Helpers ---
  async function copyViewerLink() {
    if (!tournamentId) return;
    const shareOrigin = await getShareOrigin();
    await copyText(`${shareOrigin}/tournament-v2/${tournamentId}`);
    setCopiedId("viewer");
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function copyScorerLink(matchId) {
    const shareOrigin = await getShareOrigin();
    await copyText(`${shareOrigin}/score-v2/${tournamentId}/${matchId}`);
    setCopiedId(matchId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function openLedFocus(matchId) {
    if (!tournamentId || !matchId) return;
    const shareOrigin = await getShareOrigin();
    window.open(`${shareOrigin}/tournament-v2/${tournamentId}?focus=${matchId}`, "_blank", "noopener,noreferrer");
  }

  async function handleShowQr(match) {
    // If no pinCode, generate one and save it via updateMatchScore (which acts like onPersistMatch)
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

      {selectedDiv && (
        <div className="mb-6 p-4 bg-slate-900 border border-slate-700 rounded-xl flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-4 items-center">
            <span className="text-sm font-bold text-slate-300">🔗 Viewer Link:</span>
            <code className="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">{window.location.origin}/tournament-v2/{tournamentId}</code>
            <button className="text-xs font-bold text-[#CCFF00] hover:underline" onClick={copyViewerLink}>
              {copiedId === "viewer" ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <div className="text-xs text-slate-500">
            📋 Scorer Links: Use "QR & PIN" on each match card.
          </div>
        </div>
      )}

      {selectedDiv && divMatches.length === 0 && (
        <div className="ad-card p-6 max-w-md border-purple-500/30">
          <h4 className="font-bold text-white mb-2">Generate Medal Bracket</h4>
          <p className="text-sm text-slate-400 mb-4">
            Advance the top 2 teams from each bracket into a single-elimination bracket.
          </p>
          <button 
            className="ad-btn bg-purple-500 text-slate-900 w-full hover:bg-purple-400 font-bold"
            onClick={() => setShowGenerateModal(true)}
          >
            Generate Matches
          </button>
        </div>
      )}

      {selectedDiv && divMatches.length > 0 && (
        <div className="relative overflow-x-auto pb-12 pt-4">
          <div className="flex justify-between items-center mb-6 px-4">
            <h3 className="font-bold text-white text-lg">Medal Rounds</h3>
            <button 
              onClick={() => setShowGenerateModal(true)}
              className="px-4 py-2 bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500 hover:text-slate-900 rounded-lg text-xs font-bold uppercase transition-colors"
            >
              Regenerate Bracket
            </button>
          </div>
          <div className="flex gap-12 min-w-max px-4">
            {sortedRounds.map((rNum, rIndex) => {
              const roundData = rounds[rNum];
              const roundMatches = [...roundData.matches].sort((a,b) => a.matchNum - b.matchNum);
              
              return (
                <div key={rNum} className="flex flex-col relative w-[320px]">
                  {/* Round Header */}
                  <div className="flex justify-center mb-6">
                    <span className="px-4 py-1.5 rounded-full bg-slate-800 text-slate-300 text-xs font-bold tracking-widest uppercase border border-slate-700">
                      {roundData.name}
                    </span>
                  </div>

                  <div className="flex flex-col justify-around h-full gap-8">
                    {roundMatches.map(m => {
                      const isBye = m.team1Id === 'bye' || m.team2Id === 'bye';
                      const isCompleted = m.status === 'completed';
                      const canScore = !isCompleted && !isBye && m.team1Id && m.team2Id;
                      const isWaiting = !m.team1Id || !m.team2Id;

                      const t1Initials = m.team1Name ? m.team1Name.substring(0, 2).toUpperCase() : '?';
                      const t2Initials = m.team2Name ? m.team2Name.substring(0, 2).toUpperCase() : '?';

                      return (
                        <div key={m.id} className="relative flex items-center">
                          {/* Match Card */}
                          <div className={`w-full bg-[#151e2d] border rounded-xl overflow-hidden shadow-lg flex flex-col ${isCompleted ? 'border-slate-700 opacity-80' : isWaiting ? 'border-slate-800 opacity-60' : 'border-[#CCFF00]/40'} ${isBye ? 'opacity-40' : ''}`}>
                            
                            {/* Card Header */}
                            <div className="flex justify-between items-center px-3 py-2 bg-slate-900/50 border-b border-slate-800">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                {m.round.substring(0, 2)}-M{m.matchNum}
                              </span>
                              {canScore ? (
                                <button onClick={() => handleShowQr(m)} className="text-[9px] font-bold bg-[#CCFF00]/20 text-[#CCFF00] px-2 py-0.5 rounded-full hover:bg-[#CCFF00]/40 transition-colors">
                                  TAP TO SCORE
                                </button>
                              ) : isWaiting ? (
                                <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                                  WAITING
                                </span>
                              ) : isCompleted ? (
                                <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">
                                  FINAL
                                </span>
                              ) : null}
                            </div>

                            {/* Card Body */}
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

                            {/* Card Footer Actions */}
                            {!isBye && m.team1Id && m.team2Id && (
                              <div className="flex flex-col bg-slate-800 border-t border-slate-800">
                                <div className="p-1.5 flex items-center justify-between px-3 border-b border-slate-700 bg-slate-900/50">
                                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Court Assignment:</span>
                                  <select 
                                    value={m.courtNumber || ""} 
                                    onChange={(e) => updateMatchScore(tournamentId, m.id, { courtNumber: e.target.value })}
                                    className="bg-slate-800 border border-slate-600 text-[#CCFF00] font-bold text-[9px] rounded px-1 py-0.5 outline-none cursor-pointer max-w-[100px]"
                                  >
                                    <option value="">Unassigned</option>
                                    {systemCourts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-px">
                                  <button className="flex-1 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-700 transition-colors bg-[#151e2d]" onClick={() => copyScorerLink(m.id)}>
                                    {copiedId === m.id ? "✓ COPIED" : "🔗 COPY"}
                                  </button>
                                  <button className="flex-1 py-2 text-[10px] font-bold text-slate-900 bg-[#CCFF00] hover:bg-[#b3e600] transition-colors" onClick={() => handleShowQr(m)}>
                                    QR & PIN
                                  </button>
                                  <button className="flex-1 py-2 text-[10px] font-bold text-slate-400 hover:bg-slate-700 transition-colors bg-[#151e2d]" onClick={() => openLedFocus(m.id)}>
                                    📺 LED
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Connecting Lines (CSS Magic) */}
                          {/* Right line connecting to next match */}
                          {m.nextMatchId && (
                            <div className="absolute left-full w-12 h-px bg-slate-700 z-0">
                              {/* The vertical connector will be handled by the next match's incoming lines, or we can draw it here. For simplicity, just horizontal lines if they are straight across, but in a real tree they need vertical offsets. We'll stick to simple horizontal margins for MVP. */}
                            </div>
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

      {/* ── GENERATE MODAL ── */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowGenerateModal(false)}>
          <div className="bg-[#151e2d] border border-slate-700 rounded-2xl max-w-[400px] w-full p-6 shadow-2xl relative" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-white mb-2">Medal Bracket Settings</h3>
            <p className="text-sm text-slate-400 mb-6">
              How many teams from each initial bracket (pool) should advance to the single-elimination Medal Bracket?
            </p>
            
            <div className="space-y-4 mb-8">
              <label className="block">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Advancing Teams per Pool</span>
                <select 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-500 transition-colors"
                  value={advanceCount}
                  onChange={(e) => setAdvanceCount(Number(e.target.value))}
                >
                  <option value={1}>Top 1</option>
                  <option value={2}>Top 2</option>
                  <option value={3}>Top 3</option>
                  <option value={4}>Top 4</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Bracket Type</span>
                <select 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-500 transition-colors"
                  value={bracketType}
                  onChange={(e) => setBracketType(e.target.value)}
                >
                  <option value="single-elimination">Single Elimination</option>
                  <option value="double-elimination">Double Elimination</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Scoring Mode</span>
                  <select 
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-500 transition-colors"
                    value={scoringMode}
                    onChange={(e) => setScoringMode(e.target.value)}
                  >
                    <option value="traditional">Traditional</option>
                    <option value="rally">Rally</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Win Score</span>
                  <input 
                    type="number" min="1" max="99"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-500 transition-colors"
                    value={winScore}
                    onChange={(e) => setWinScore(Number(e.target.value))}
                  />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Match Format</span>
                  <select 
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:border-purple-500 transition-colors"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="bo1">Single Game</option>
                    <option value="bo3">Best of 3</option>
                    <option value="bo5">Best of 5</option>
                  </select>
                </label>
              </div>

              <div className="bg-amber-900/20 border border-amber-900/50 rounded-lg p-3">
                <p className="text-[11px] text-amber-500/80 leading-relaxed font-semibold">
                  <span className="material-symbols-outlined text-[14px] align-middle mr-1">info</span>
                  If pool matches are not completely finished yet, the bracket will display "TBD" placeholders. You can regenerate the bracket once pool matches conclude.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
                onClick={() => setShowGenerateModal(false)}
              >
                Cancel
              </button>
              <button 
                className="flex-1 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-900 bg-purple-500 hover:bg-purple-400 transition-colors"
                onClick={executeGenerateBracket}
              >
                Generate
              </button>
            </div>
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
                    <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
                      qrModalMatch.pinStatus === 'used' ? 'bg-amber-500/20 text-amber-500' : 
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
