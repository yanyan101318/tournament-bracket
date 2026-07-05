// src/pages/ScorerPage.jsx
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { subscribeToMatch, updateMatch, updateNextMatch, setChampion, getTournamentInfo } from "../services/tournamentService";
import {
  recordSetWin,
  undoLastSet,
  setsNeeded,
  setsTotal,
  recordPoint,
  recordRallyPoint,
  getNextServer,
} from "../utils/bracketGenerator";
import {
  getStoredScoringMode,
  setStoredScoringMode,
  getCourtSwap,
  setCourtSwap,
} from "../utils/scoringModeStorage";
import RulesReference from "../components/RulesReference";

// localStorage helpers
function getStoredScore(matchId) {
  try {
    const raw = localStorage.getItem(`score_${matchId}`);
    if (raw) { const p = JSON.parse(raw); return { a: p.a ?? 0, b: p.b ?? 0 }; }
  } catch (_) {}
  return { a: 0, b: 0 };
}
function saveScore(matchId, a, b) {
  try { localStorage.setItem(`score_${matchId}`, JSON.stringify({ a, b })); } catch (_) {}
}
function clearScore(matchId) {
  try { localStorage.removeItem(`score_${matchId}`); } catch (_) {}
}

// Pickleball SVG
function PickleballSVG({ size = 40 }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" width={size} height={size}>
      <circle cx="20" cy="20" r="19" fill="#c8e63a" stroke="#a8c420" strokeWidth="1.5"/>
      {[[20,8],[20,32],[8,20],[32,20],[12,12],[28,12],[12,28],[28,28],[20,20]].map(([cx,cy],i)=>(
        <circle key={i} cx={cx} cy={cy} r="2.2" fill="#7aaa00" opacity="0.75"/>
      ))}
      <ellipse cx="14" cy="13" rx="4" ry="2.5" fill="white" opacity="0.2" transform="rotate(-30 14 13)"/>
    </svg>
  );
}

export default function ScorerPage() {
  const { tournamentId, matchId } = useParams();
  const [match, setMatch]               = useState(null);
  const [tournamentInfo, setTournamentInfo] = useState(null);
  const [localA, setLocalA]             = useState(() => getStoredScore(matchId).a);
  const [localB, setLocalB]             = useState(() => getStoredScore(matchId).b);
  const [saving, setSaving]             = useState(false);
  const [loading, setLoading]           = useState(true);
  const [flashA, setFlashA]             = useState(null);
  const [flashB, setFlashB]             = useState(null);
  const [toast, setToast]               = useState(null);
  const [showRules, setShowRules]       = useState(false);
  const [enteredPin, setEnteredPin]     = useState("");
  const [pinError, setPinError]         = useState("");
  const [hasPinAccess, setHasPinAccess] = useState(() => localStorage.getItem(`scorer_access_${matchId}`));
  const [scoringMode, setScoringMode]   = useState(() =>
    getStoredScoringMode(matchId, "traditional"),
  );
  const [courtSwapped, setCourtSwapped] = useState(() => getCourtSwap(matchId));
  const [showCourtChangePopup, setShowCourtChangePopup] = useState(false);
  const crossedElevenRef = useRef(false);

  useEffect(() => { getTournamentInfo(tournamentId).then(setTournamentInfo); }, [tournamentId]);

  useEffect(() => {
    setScoringMode(getStoredScoringMode(matchId, tournamentInfo?.scoringMode ?? "traditional"));
  }, [matchId, tournamentInfo?.scoringMode]);

  useEffect(() => {
    setCourtSwapped(getCourtSwap(matchId));
  }, [matchId]);

  useEffect(() => {
    const unsub = subscribeToMatch(tournamentId, matchId, (data) => {
      setMatch(data); setLoading(false);
    });
    return () => unsub();
  }, [tournamentId, matchId]);

  useEffect(() => { saveScore(matchId, localA, localB); }, [matchId, localA, localB]);

  useEffect(() => {
    if (localA === 0 && localB === 0) crossedElevenRef.current = false;
  }, [localA, localB]);

  useEffect(() => {
    if (scoringMode !== "rally") return;
    const max = Math.max(localA, localB);
    if (max >= 11 && !crossedElevenRef.current) {
      crossedElevenRef.current = true;
      setShowCourtChangePopup(true);
    }
  }, [localA, localB, scoringMode]);

  function triggerFlash(side, type) {
    if (side === "A") { setFlashA(type); setTimeout(() => setFlashA(null), 300); }
    else              { setFlashB(type); setTimeout(() => setFlashB(null), 300); }
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  function cloneCurrentGame(cg) {
    if (!cg) return null;
    return { ...cg };
  }

  async function handleUndoPointA() {
    if (!match || match.winner || saving || localA === 0) return;
    setSaving(true);
    try {
      const newScoreA = localA - 1;
      setLocalA(newScoreA);
      triggerFlash("A", "minus");
      const m = {
        ...match,
        scoreA: newScoreA,
        scoreB: localB,
        sets: [...match.sets],
      };
      await updateMatch(tournamentId, m);
    } catch (err) {
      console.error(err);
      showToast("Failed to undo point. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoPointB() {
    if (!match || match.winner || saving || localB === 0) return;
    setSaving(true);
    try {
      const newScoreB = localB - 1;
      setLocalB(newScoreB);
      triggerFlash("B", "minus");
      const m = {
        ...match,
        scoreA: localA,
        scoreB: newScoreB,
        sets: [...match.sets],
      };
      await updateMatch(tournamentId, m);
    } catch (err) {
      console.error(err);
      showToast("Failed to undo point. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handlePointScored(scoringTeam) {
    if (!match || match.winner || saving || !match.teamA || !match.teamB) return;

    setSaving(true);
    try {

      const m = {
        ...match,
        sets: [...match.sets],
        currentGame: match.currentGame
          ? { ...match.currentGame }
          : { ...getNextServer(match) },
      };

      let newScoreA = localA;
      let newScoreB = localB;
      let result;
      if (scoringMode === "rally") {
        if (scoringTeam === "A") newScoreA++;
        else newScoreB++;
        result = recordRallyPoint(m, scoringTeam, newScoreA, newScoreB);
      } else {
        if (m.currentGame.servingTeam === scoringTeam) {
          if (scoringTeam === "A") newScoreA++;
          else newScoreB++;
        }
        result = recordPoint(m, scoringTeam, newScoreA, newScoreB);
      }

      if (result.gameEnded) {
        setLocalA(newScoreA);
        setLocalB(newScoreB);
        recordSetWin(m, result.winner, { [m.matchId]: m }, result.scoreA, result.scoreB, scoringMode);

        m.scoreA = 0;
        m.scoreB = 0;
        await updateMatch(tournamentId, m);

        if (m.winner && m.nextMatchId) {
          const { getDoc, doc } = await import("firebase/firestore");
          const { db } = await import("../firebase");
          const snap = await getDoc(doc(db, "tournaments", tournamentId, "matches", m.nextMatchId));
          if (snap.exists()) {
            const nm = snap.data();
            if (nm.fromMatchA === m.matchId) nm.teamA = m.winner;
            else nm.teamB = m.winner;
            await updateNextMatch(tournamentId, nm);
          }
        }

        if (m.winner && !m.nextMatchId) await setChampion(tournamentId, m.winner);

        clearScore(matchId);
        setLocalA(0);
        setLocalB(0);
        triggerFlash(scoringTeam, "plus");
        showToast(`🎉 ${result.winner === "A" ? match.teamA : match.teamB} wins the game! Set recorded.`);
        return;
      }

      if (result.fault) {
        m.scoreA = newScoreA;
        m.scoreB = newScoreB;
        await updateMatch(tournamentId, m);
        const srv = m.currentGame.servingTeam === "A" ? match.teamA : match.teamB;
        const srvLabel = m.currentGame.firstServer ? "1st Serve" : "2nd Serve";
        triggerFlash(scoringTeam, "plus");
        showToast(`Serve fault — now ${srv} (${srvLabel})`);
        return;
      }

      setLocalA(newScoreA);
      setLocalB(newScoreB);
      m.scoreA = newScoreA;
      m.scoreB = newScoreB;
      await updateMatch(tournamentId, m);
      triggerFlash(scoringTeam, "plus");
      showToast(`Point: ${match.teamA} ${newScoreA} - ${match.teamB} ${newScoreB}`);
    } catch (err) {
      console.error(err);
      showToast("Failed to record point. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUndo() {
    if (!match || match.sets.length === 0 || saving) return;
    setSaving(true);
    try {
      const m = { ...match, sets: [...match.sets] };
      const hadWinner = !!m.winner; const nextId = m.nextMatchId;
      undoLastSet(m, { [m.matchId]: m });
      await updateMatch(tournamentId, m);
      if (hadWinner && nextId) {
        const { getDoc, doc } = await import("firebase/firestore");
        const { db } = await import("../firebase");
        const snap = await getDoc(doc(db, "tournaments", tournamentId, "matches", nextId));
        if (snap.exists()) {
          const nm = snap.data();
          if (nm.fromMatchA === m.matchId) nm.teamA = null; else nm.teamB = null;
          nm.winner = null; nm.loser = null; nm.sets = [];
          await updateNextMatch(tournamentId, nm);
        }
      }
      clearScore(matchId); setLocalA(0); setLocalB(0);
      showToast("Last set undone ↩");
    } catch (err) { console.error(err); }
    setSaving(false);
  }

  if (loading) return (
    <div className="sp-loading">
      <div className="sp-loading-ball"><PickleballSVG size={60}/></div>
      <p>Loading match...</p>
    </div>
  );
  if (!match) return (
    <div className="sp-loading"><p>Match not found.</p></div>
  );

  const { teamA, teamB, sets = [], winner, format } = match;
  const needed = setsNeeded(format);
  const total  = setsTotal(format);
  const winsA  = sets.filter(s => s.winner === "A").length;
  const winsB  = sets.filter(s => s.winner === "B").length;

  function initials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
  }
  function formatLabel() {
    if (format === "bo3") return "Best of 3";
    if (format === "bo5") return "Best of 5";
    return "Single Game";
  }

  // --- PIN ACCESS LOGIC ---
  const isMatchFinished = !!match?.winner;
  const requiresPin = !!match?.pinCode;
  const isAuthorized = !requiresPin || hasPinAccess === match.pinCode;

  async function handlePinSubmit(e) {
    e.preventDefault();
    if (enteredPin === match.pinCode) {
      if (match.pinStatus === "used" && hasPinAccess !== match.pinCode) {
        setPinError("This PIN has already been used by another device.");
        return;
      }
      if (match.pinStatus === "expired" || isMatchFinished) {
        setPinError("This access link has expired.");
        return;
      }
      
      setPinError("");
      localStorage.setItem(`scorer_access_${matchId}`, match.pinCode);
      setHasPinAccess(match.pinCode);
      
      try {
        await updateMatch(tournamentId, {
          ...match,
          pinStatus: "used",
          usedAt: new Date().toISOString()
        });
      } catch (err) {
        console.error("Failed to update PIN status", err);
      }
    } else {
      setPinError("Incorrect PIN.");
    }
  }

  if (requiresPin && !isAuthorized) {
    return (
      <div className="sp-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
        <div style={{ background: 'var(--surface2)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--border)', maxWidth: '400px', width: '90%', textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <div className="sp-ball-icon" style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.2rem' }}><PickleballSVG size={50}/></div>
          <h2 style={{ color: 'var(--text)', marginBottom: '0.5rem', fontSize: '1.5rem', fontWeight: 800 }}>Scorer Access</h2>
          
          {isMatchFinished || match.pinStatus === "expired" ? (
            <p style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '1rem' }}>This scorer access link has expired because the match is already completed.</p>
          ) : match.pinStatus === "used" ? (
            <p style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '1rem' }}>This PIN has already been used by another device.</p>
          ) : (
            <>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>Please enter the 6-digit PIN to access this match's scorer interface.</p>
              <form onSubmit={handlePinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input 
                  type="text" 
                  maxLength={6}
                  value={enteredPin}
                  onChange={(e) => setEnteredPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="------"
                  style={{ 
                    fontSize: '2.5rem', textAlign: 'center', letterSpacing: '12px', padding: '1rem 0',
                    background: 'rgba(0,0,0,0.3)', border: '2px solid var(--border)', borderRadius: '8px', color: 'var(--pickle)', fontWeight: 'bold', fontFamily: 'monospace', width: '100%' 
                  }}
                  autoFocus
                />
                {pinError && <div style={{ color: '#ef4444', fontSize: '0.9rem', fontWeight: 'bold' }}>{pinError}</div>}
                <button type="submit" disabled={enteredPin.length !== 6} style={{ 
                  padding: '1rem', background: enteredPin.length === 6 ? 'var(--pickle)' : 'rgba(200,230,58,0.3)', color: '#000', border: 'none', borderRadius: '8px', 
                  fontSize: '1.1rem', fontWeight: 'bold', cursor: enteredPin.length === 6 ? 'pointer' : 'not-allowed', marginTop: '0.5rem', transition: 'background 0.2s' 
                }}>
                  Verify PIN
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="sp-page">

      {/* ── BACKGROUND ── */}
      <div className="sp-bg" aria-hidden="true">
        <svg className="sp-bg-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[15,30,45,60,75,90].map(y=>(
            <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke="#c8e63a" strokeWidth="0.2" opacity="0.06"/>
          ))}
          {[20,40,60,80].map(x=>(
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="#c8e63a" strokeWidth="0.2" opacity="0.06"/>
          ))}
          <line x1="0" y1="50" x2="100" y2="50" stroke="#c8e63a" strokeWidth="0.5" opacity="0.1"/>
          <line x1="0" y1="22" x2="100" y2="22" stroke="#c8e63a" strokeWidth="0.3" opacity="0.08" strokeDasharray="2 3"/>
          <line x1="0" y1="78" x2="100" y2="78" stroke="#c8e63a" strokeWidth="0.3" opacity="0.08" strokeDasharray="2 3"/>
          <rect x="5" y="5" width="90" height="90" fill="none" stroke="#c8e63a" strokeWidth="0.4" opacity="0.08"/>
          <circle cx="50" cy="50" r="10" fill="none" stroke="#c8e63a" strokeWidth="0.3" opacity="0.06"/>
        </svg>
        {/* floating balls */}
        {[
          {x:8,y:15,s:32,d:12,dl:0},{x:88,y:20,s:24,d:9,dl:2},
          {x:5,y:70,s:40,d:15,dl:1},{x:90,y:75,s:28,d:11,dl:3},
          {x:50,y:5,s:20,d:8,dl:1.5},{x:45,y:92,s:36,d:13,dl:0.5},
        ].map((b,i)=>(
          <div key={i} className="sp-float-ball" style={{
            left:`${b.x}%`,top:`${b.y}%`,width:b.s,height:b.s,
            animationDuration:`${b.d}s`,animationDelay:`${b.dl}s`
          }}>
            <PickleballSVG size={b.s}/>
          </div>
        ))}
      </div>

      {/* ── HEADER ── */}
      <div className="sp-header">
        <div className="sp-header-left">
          <div className="sp-ball-icon"><PickleballSVG size={22}/></div>
          <div>
            <div className="sp-tournament-name">{tournamentInfo?.name ?? "Tournament"}</div>
            <div className="sp-match-meta">
              {matchId} · {formatLabel()}
              {" · "}
              <span style={{ color: scoringMode === "rally" ? "var(--pickle)" : "inherit" }}>
                {scoringMode === "rally" ? "Rally scoring (21, win by 2)" : "Traditional scoring"}
              </span>
            </div>
          </div>
        </div>
        <div style={{display: "flex", alignItems: "center", gap: "12px"}}>
          <button 
            onClick={() => setShowRules(true)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: "1.2rem", color: "var(--text-muted)", 
              transition: "color 0.2s", padding: "6px 10px",
              borderRadius: "8px"
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "var(--pickle)"}
            onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
            title="Pickleball Rules"
          >
            📚
          </button>
          {saving ? (
            <div className="sp-saving-badge">
              <div className="sp-saving-dot"/>Saving...
            </div>
          ) : (
            <div className="sp-live-badge">● LIVE</div>
          )}
        </div>
      </div>

      {/* ── WINNER STATE ── */}
      {winner ? (
        <div className="sp-winner-screen">
          <div className="sp-winner-ball"><PickleballSVG size={80}/></div>
          <div className="sp-winner-trophy">🏆</div>
          <div className="sp-winner-name">{winner}</div>
          <div className="sp-winner-sub">wins the match and advances!</div>
          <div className="sp-winner-sets">
            {sets.map((s,i) => (
              <div key={i} className={`sp-winner-set-chip ${s.winner==="A"?"chip-a":"chip-b"}`}>
                Set {i+1}: {s.winner==="A"?teamA:teamB}
                {s.scoreA !== undefined ? ` · ${s.scoreA}–${s.scoreB}` : ""}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sp-content">

          {/* ── MODE & COURT ── */}
          {!winner && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Scoring mode
                </span>
                <div style={{ display: "inline-flex", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setScoringMode("traditional");
                      setStoredScoringMode(matchId, "traditional");
                    }}
                    disabled={saving}
                    style={{
                      padding: "8px 14px",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      border: "none",
                      cursor: saving ? "not-allowed" : "pointer",
                      background: scoringMode === "traditional" ? "rgba(200,230,58,0.2)" : "transparent",
                      color: "var(--text)",
                    }}
                  >
                    Traditional
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScoringMode("rally");
                      setStoredScoringMode(matchId, "rally");
                    }}
                    disabled={saving}
                    style={{
                      padding: "8px 14px",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      border: "none",
                      borderLeft: "1px solid var(--border)",
                      cursor: saving ? "not-allowed" : "pointer",
                      background: scoringMode === "rally" ? "rgba(200,230,58,0.2)" : "transparent",
                      color: "var(--text)",
                    }}
                  >
                    Rally
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const input = window.prompt("Enter court number (e.g. 1, 2, A):", match?.courtNumber || "");
                  if (input !== null) {
                    setSaving(true);
                    try {
                      await updateMatch(tournamentId, { ...match, courtNumber: input.trim() });
                    } catch (e) {
                      console.error(e);
                    }
                    setSaving(false);
                  }
                }}
                disabled={saving}
                style={{
                  padding: "8px 16px",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {match?.courtNumber ? `Court: ${match.courtNumber}` : "Assign Court"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCourtSwapped((v) => {
                    const n = !v;
                    setCourtSwap(matchId, n);
                    return n;
                  });
                }}
                disabled={saving}
                style={{
                  padding: "8px 16px",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  borderRadius: "10px",
                  border: "1px solid #c8e63a55",
                  background: "linear-gradient(145deg, #1a2410, #121a0c)",
                  color: "var(--pickle)",
                  cursor: saving ? "not-allowed" : "pointer",
                  boxShadow: "0 0 0 1px rgba(200,230,58,0.08)",
                }}
              >
                ⇄ Change court (visual)
              </button>
            </div>
          )}

          {/* ── SCOREBOARD ── */}
          <div className="sp-scoreboard">

            {/* Team A */}
            <div className="sp-team-panel sp-team-a" style={{ order: courtSwapped ? 3 : 1 }}>
              <div className="sp-team-avatar sp-avatar-a">{initials(teamA)}</div>
              <div className="sp-team-name">
                {teamA || "TBD"}
                {match.currentGame?.servingTeam === "A" && (
                  <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                    {scoringMode === "rally"
                      ? (match.currentGame.servingSide === "right" ? "🎾 RIGHT COURT" : "🎾 LEFT COURT")
                      : (match.currentGame.firstServer ? "🎾 1ST SERVER" : "🎾 2ND SERVER")}
                  </div>
                )}
              </div>
              <div className={`sp-score-ring ${flashA==="plus"?"sp-flash-plus":flashA==="minus"?"sp-flash-minus":""}`}>
                <span className="sp-score-num">{localA}</span>
              </div>
              <div style={{width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column"}}>
                <button 
                  className="sp-score-btn sp-btn-plus" 
                  onClick={() => handlePointScored("A")} 
                  disabled={saving || !teamB}
                  style={{width: "100%", fontSize: "1rem"}}
                >
                  <span>POINT</span>
                </button>
                <button 
                  className="sp-score-btn sp-btn-minus" 
                  onClick={() => handleUndoPointA()}
                  disabled={saving || localA === 0}
                  style={{width: "100%", fontSize: "0.9rem", opacity: localA === 0 ? 0.4 : 1, cursor: localA === 0 ? "not-allowed" : "pointer"}}
                >
                  <span>UNDO</span>
                </button>
              </div>
              {format !== "bo1" && (
                <div className="sp-set-pips">
                  {Array.from({length:needed}).map((_,i)=>(
                    <span key={i} className={`sp-pip ${i<winsA?"sp-pip-a":""}`}/>
                  ))}
                </div>
              )}
            </div>

            {/* Center VS */}
            <div className="sp-vs-col" style={{ order: 2 }}>
              <div className="sp-vs-text">VS</div>
              <div
                aria-hidden="true"
                style={{ marginTop: "auto", marginBottom: "auto", width: "56px", height: "56px", flexShrink: 0 }}
              />
              {format !== "bo1" && (
                <>
                  <div className="sp-set-dots">
                    {Array.from({length:total}).map((_,i)=>{
                      const s = sets[i];
                      return <div key={i} className={`sp-set-dot ${s?.winner==="A"?"spd-a":s?.winner==="B"?"spd-b":"spd-empty"}`}/>;
                    })}
                  </div>
                  <div className="sp-tally">{winsA}–{winsB}</div>
                </>
              )}
            </div>

            {/* Team B */}
            <div className="sp-team-panel sp-team-b" style={{ order: courtSwapped ? 1 : 3 }}>
              <div className="sp-team-avatar sp-avatar-b">{initials(teamB)}</div>
              <div className="sp-team-name">
                {teamB || "TBD"}
                {match.currentGame?.servingTeam === "B" && (
                  <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                    {scoringMode === "rally"
                      ? (match.currentGame.servingSide === "right" ? "🎾 RIGHT COURT" : "🎾 LEFT COURT")
                      : (match.currentGame.firstServer ? "🎾 1ST SERVER" : "🎾 2ND SERVER")}
                  </div>
                )}
              </div>
              <div className={`sp-score-ring ${flashB==="plus"?"sp-flash-plus":flashB==="minus"?"sp-flash-minus":""}`}>
                <span className="sp-score-num">{localB}</span>
              </div>
              <div style={{width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column"}}>
                <button 
                  className="sp-score-btn sp-btn-plus" 
                  onClick={() => handlePointScored("B")} 
                  disabled={saving || !teamB}
                  style={{width: "100%", marginTop: "0", fontSize: "1rem", background: "linear-gradient(145deg, #2a1500, #1c0f00)", borderColor: "#f9731655"}}
                >
                  <span>POINT</span>
                </button>
                <button 
                  className="sp-score-btn sp-btn-minus" 
                  onClick={() => handleUndoPointB()}
                  disabled={saving || localB === 0}
                  style={{width: "100%", fontSize: "0.9rem", opacity: localB === 0 ? 0.4 : 1, cursor: localB === 0 ? "not-allowed" : "pointer"}}
                >
                  <span>UNDO</span>
                </button>
              </div>
              {format !== "bo1" && (
                <div className="sp-set-pips">
                  {Array.from({length:needed}).map((_,i)=>(
                    <span key={i} className={`sp-pip ${i<winsB?"sp-pip-b":""}`}/>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── UNDO ── */}
          <div className="sp-undo-row">
            <button className="sp-undo-btn" onClick={handleUndo} disabled={sets.length===0||saving}>
              ↩ Undo last set
            </button>
          </div>

          {/* ── SET HISTORY ── */}
          {sets.length > 0 && (
            <div className="sp-history">
              <div className="sp-history-label">Set History</div>
              <div className="sp-history-chips">
                {sets.map((s,i)=>(
                  <div key={i} className={`sp-history-chip ${s.winner==="A"?"spch-a":"spch-b"}`}>
                    <span className="spch-num">Set {i+1}</span>
                    <span className="spch-name">{s.winner==="A"?teamA:teamB}</span>
                    {s.scoreA!==undefined && <span className="spch-score">{s.scoreA}–{s.scoreB}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SERVING INFO ── */}
          {match?.currentGame && (
            <div style={{
              padding: "12px 16px", background: "rgba(200,230,58,0.08)", borderTop: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", flexWrap: "wrap", gap: "8px"
            }}>
              <div>
                <span style={{color: "var(--text-muted)"}}>Currently Serving: </span>
                <span style={{color: "var(--pickle)", fontWeight: "700"}}>
                  {match.currentGame.servingTeam === "A" ? teamA : teamB}
                </span>
              </div>
              <div>
                <span style={{color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase"}}>
                  {scoringMode === "rally" ? (
                    <>Rally · {match.currentGame.servingSide === "right" ? "Right" : "Left"} (team score {match.currentGame.servingTeam === "A" ? localA : localB} = {match.currentGame.servingSide === "right" ? "even" : "odd"})</>
                  ) : (
                    <>{match.currentGame.firstServer ? "1st Server" : "2nd Server"} • {match.currentGame.servingSide === "right" ? "Right" : "Left"} Court</>
                  )}
                </span>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div className={`sp-toast ${toast.type==="error"?"sp-toast-err":"sp-toast-ok"}`}>
          {toast.msg}
        </div>
      )}

      {/* ── RALLY: CHANGE ENDS AT 11 ── */}
      {showCourtChangePopup && scoringMode === "rally" && !winner && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 50 }}
          onClick={() => setShowCourtChangePopup(false)}
          role="presentation"
        >
          <div
            className="confirm-box"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "380px", textAlign: "center" }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "8px" }}>↔️</div>
            <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: "8px", color: "var(--pickle)" }}>
              Change court now
            </div>
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: "16px", lineHeight: 1.45 }}>
              A team has reached 11 points. Switch sides on the physical court, then use{" "}
              <strong>Change court (visual)</strong> here if your on-screen sides should match.
            </div>
            <button
              type="button"
              className="confirm-proceed"
              style={{ width: "100%" }}
              onClick={() => setShowCourtChangePopup(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ── RULES MODAL ── */}
      {showRules && <RulesReference onClose={() => setShowRules(false)} />}
    </div>
  );
}