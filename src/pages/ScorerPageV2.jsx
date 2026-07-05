import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { updateMatchScore } from "../services/tournamentV2Service";
import toast from "react-hot-toast";

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

export default function ScorerPageV2() {
  const { tournamentId, matchId } = useParams();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [hasPinAccess, setHasPinAccess] = useState(() => localStorage.getItem(`scorer_access_v2_${matchId}`));
  const [courtsSwapped, setCourtsSwapped] = useState(false);

  useEffect(() => {
    const matchRef = doc(db, "tournamentsV2", tournamentId, "matches", matchId);
    const unsub = onSnapshot(matchRef, (snap) => {
      if (snap.exists()) {
        setMatch(snap.data());
      } else {
        setMatch(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [tournamentId, matchId]);

  if (loading) {
    return (
      <div className="sp-loading">
        <div className="sp-loading-ball"><PickleballSVG size={60}/></div>
        <p>Loading match...</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="sp-loading">
        <p>Match not found.</p>
      </div>
    );
  }

  const isCompleted = match.status === "completed";
  const requiresPin = !!match.pinCode;
  const isAuthorized = !requiresPin || hasPinAccess === match.pinCode;

  // Derived Match Rules
  const isSuddenDeath = match.round === 'Semifinal' || match.round === 'Final';
  const targetScore = isSuddenDeath ? 15 : 11;
  const changeCourtScore = isSuddenDeath ? 8 : 6;

  const score1 = match.score1 || 0;
  const score2 = match.score2 || 0;

  const shouldShowChangeCourt = Math.max(score1, score2) === changeCourtScore && !courtsSwapped && !isCompleted;

  const getWinner = (s1, s2) => {
    if (isSuddenDeath) {
      if (s1 >= targetScore) return 1;
      if (s2 >= targetScore) return 2;
    } else {
      if (s1 >= targetScore && (s1 - s2) >= 2) return 1;
      if (s2 >= targetScore && (s2 - s1) >= 2) return 2;
    }
    return null;
  };
  const winner = getWinner(score1, score2);

  async function handlePinSubmit(e) {
    e.preventDefault();
    if (enteredPin === match.pinCode) {
      if (match.pinStatus === "used" && hasPinAccess !== match.pinCode) {
        setPinError("This PIN has already been used by another device.");
        return;
      }
      if (match.pinStatus === "expired" || isCompleted) {
        setPinError("This access link has expired.");
        return;
      }
      
      setPinError("");
      localStorage.setItem(`scorer_access_v2_${matchId}`, match.pinCode);
      setHasPinAccess(match.pinCode);
      
      try {
        await updateMatchScore(tournamentId, matchId, {
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
          
          {isCompleted || match.pinStatus === "expired" ? (
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



  async function adjustScore(team, delta) {
    if (isCompleted || saving) return;

    setSaving(true);
    const currentState = {
      score1: match.score1 || 0,
      score2: match.score2 || 0,
      servingTeam: match.servingTeam || 1,
      firstServer: match.firstServer !== undefined ? match.firstServer : false,
    };
    
    let { score1, score2, servingTeam, firstServer } = currentState;

    if (delta === 1) {
      if (team === servingTeam) {
        if (team === 1) score1++;
        if (team === 2) score2++;
      } else {
        if (firstServer) {
          firstServer = false;
        } else {
          servingTeam = servingTeam === 1 ? 2 : 1;
          firstServer = true;
        }
      }
    } else if (delta === -1) {
      if (team === 1 && score1 > 0) score1--;
      if (team === 2 && score2 > 0) score2--;
    }

    try {
      await updateMatchScore(tournamentId, matchId, {
        score1, score2, servingTeam, firstServer
      });
      if (delta === 1 && team !== currentState.servingTeam) {
        toast("Serve fault — now " + (servingTeam === 1 ? match.team1Name : match.team2Name));
      }
    } catch (e) {
      toast.error("Failed to update score");
    }
    setSaving(false);
  }

  async function handleCompleteMatch() {
    if (isCompleted || saving) return;
    if (window.confirm("Complete this match? Scores cannot be changed after completion.")) {
      setSaving(true);
      const score1 = match.score1 || 0;
      const score2 = match.score2 || 0;
      let winnerId = null;
      if (score1 > score2) winnerId = match.team1Id;
      else if (score2 > score1) winnerId = match.team2Id;

      try {
        await updateMatchScore(tournamentId, matchId, {
          status: 'completed',
          winnerId
        });
        toast.success("Match completed!");
      } catch (e) {
        toast.error("Failed to complete match");
      }
      setSaving(false);
    }
  }

  function initials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
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

      <div className="sp-header">
        <div className="sp-header-left">
          <div className="sp-ball-icon"><PickleballSVG size={22}/></div>
          <div>
            <div className="sp-tournament-name">{match.round} • Match {match.matchNum || "Play"}</div>
            <div className="sp-match-meta">Tournament V2 Scoring</div>
          </div>
        </div>
        <div>
          {saving ? (
            <div className="sp-saving-badge">
              <div className="sp-saving-dot"/>Saving...
            </div>
          ) : isCompleted ? (
            <div style={{color: '#34d399', fontWeight: 'bold', fontSize: '12px', border: '1px solid #34d399', padding: '2px 8px', borderRadius: '12px'}}>FINAL</div>
          ) : (
            <div className="sp-live-badge">● LIVE</div>
          )}
        </div>
      </div>

      <div className="sp-content">
        
        {/* Court Change Notification */}
        {shouldShowChangeCourt && (
          <div style={{ background: '#CCFF00', color: '#000', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(204,255,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
              <span className="material-symbols-outlined">swap_horiz</span>
              Time to Change Courts! (Score reached {changeCourtScore})
            </div>
            <button 
              onClick={() => setCourtsSwapped(true)}
              style={{ background: '#1c0f00', color: '#CCFF00', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              Swap Sides on Screen
            </button>
          </div>
        )}

        {/* Winner Notification */}
        {!isCompleted && winner !== null && (
          <div style={{ background: 'rgba(52, 211, 153, 0.2)', border: '1px solid #34d399', color: '#34d399', padding: '1rem', borderRadius: '12px', marginBottom: '1rem', textAlign: 'center', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(52,211,153,0.1)' }}>
            <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: '6px' }}>emoji_events</span>
            MATCH POINT WON BY {winner === 1 ? match.team1Name : match.team2Name}! 
            <div style={{ fontSize: '0.8rem', color: '#a7f3d0', marginTop: '4px', fontWeight: 'normal' }}>Please finalize the score and click FINISH MATCH below.</div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={() => setCourtsSwapped(v => !v)}
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

        <div className="sp-scoreboard">
          
          {/* TEAM 1 */}
          <div className="sp-team-panel sp-team-a" style={{ order: courtsSwapped ? 3 : 1 }}>
            <div className="sp-team-avatar sp-avatar-a">{initials(match.team1Name)}</div>
            <div className="sp-team-name">
              {match.team1Name || "TBD"}
              {(match.servingTeam || 1) === 1 && (
                <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                  {(match.firstServer !== undefined ? match.firstServer : false) ? "🎾 1ST SERVER" : "🎾 2ND SERVER"}
                </div>
              )}
            </div>
            
            <div className="sp-score-ring">
              <span className="sp-score-num">{match.score1 || 0}</span>
            </div>
            
            <div style={{width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column"}}>
              <button 
                className="sp-score-btn sp-btn-plus" 
                onClick={() => adjustScore(1, 1)} 
                disabled={saving || isCompleted || match.team1Id === 'bye'}
                style={{width: "100%", fontSize: "1rem"}}
              >
                <span>POINT</span>
              </button>
              <button 
                className="sp-score-btn sp-btn-minus" 
                onClick={() => adjustScore(1, -1)}
                disabled={saving || isCompleted || match.team1Id === 'bye' || (match.score1 || 0) === 0}
                style={{width: "100%", fontSize: "0.9rem", opacity: (match.score1 || 0) === 0 ? 0.4 : 1}}
              >
                <span>UNDO</span>
              </button>
            </div>
          </div>

          {/* Center VS */}
          <div className="sp-vs-col" style={{ order: 2 }}>
            <div className="sp-vs-text">VS</div>
          </div>

          {/* TEAM 2 */}
          <div className="sp-team-panel sp-team-b" style={{ order: courtsSwapped ? 1 : 3 }}>
            <div className="sp-team-avatar sp-avatar-b">{initials(match.team2Name)}</div>
            <div className="sp-team-name">
              {match.team2Name || "TBD"}
              {(match.servingTeam || 1) === 2 && (
                <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                  {(match.firstServer !== undefined ? match.firstServer : false) ? "🎾 1ST SERVER" : "🎾 2ND SERVER"}
                </div>
              )}
            </div>
            
            <div className="sp-score-ring">
              <span className="sp-score-num">{match.score2 || 0}</span>
            </div>
            
            <div style={{width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column"}}>
              <button 
                className="sp-score-btn sp-btn-plus" 
                onClick={() => adjustScore(2, 1)} 
                disabled={saving || isCompleted || match.team2Id === 'bye'}
                style={{width: "100%", marginTop: "0", fontSize: "1rem", background: "linear-gradient(145deg, #2a1500, #1c0f00)", borderColor: "#f9731655"}}
              >
                <span>POINT</span>
              </button>
              <button 
                className="sp-score-btn sp-btn-minus" 
                onClick={() => adjustScore(2, -1)}
                disabled={saving || isCompleted || match.team2Id === 'bye' || (match.score2 || 0) === 0}
                style={{width: "100%", fontSize: "0.9rem", opacity: (match.score2 || 0) === 0 ? 0.4 : 1}}
              >
                <span>UNDO</span>
              </button>
            </div>
          </div>
          
        </div>
        
        <div className="sp-undo-row" style={{ marginTop: '2rem' }}>
          <button className="sp-undo-btn" onClick={handleCompleteMatch} disabled={saving} style={{ padding: '12px 24px', fontSize: '1.2rem', color: '#fff', background: winner !== null ? 'var(--pickle)' : 'transparent', borderColor: 'var(--pickle)', color: winner !== null ? '#000' : '#fff', transition: 'all 0.3s' }}>
            {winner !== null ? "CONFIRM WINNER & FINISH" : "FINISH MATCH"}
          </button>
        </div>

        {/* ── SERVING INFO (Global Bottom Bar) ── */}
        <div style={{
          padding: "12px 16px", background: "rgba(200,230,58,0.08)", borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", flexWrap: "wrap", gap: "8px", marginTop: "1rem", borderRadius: "0 0 16px 16px"
        }}>
          <div>
            <span style={{color: "var(--text-muted)"}}>Currently Serving: </span>
            <span style={{color: "var(--pickle)", fontWeight: "700"}}>
              {(match.servingTeam || 1) === 1 ? (match.team1Name || "TBD") : (match.team2Name || "TBD")}
            </span>
          </div>
          <div>
            <span style={{color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase"}}>
              {(match.firstServer !== undefined ? match.firstServer : false) ? "1st Server" : "2nd Server"}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
