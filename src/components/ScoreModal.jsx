// src/components/ScoreModal.jsx
import { useState, useEffect, useRef } from "react";
import {
  setsNeeded,
  setsTotal,
  isGameWon,
  getGameWinner,
  isRallyGameWon,
  getRallyGameWinner,
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

function getStoredScore(matchId) {
  try {
    const raw = localStorage.getItem(`score_${matchId}`);
    if (raw) {
      const p = JSON.parse(raw);
      return { a: p.a ?? 0, b: p.b ?? 0 };
    }
  } catch (_) {}
  return { a: 0, b: 0 };
}

function saveScore(matchId, a, b) {
  try { localStorage.setItem(`score_${matchId}`, JSON.stringify({ a, b })); } catch (_) {}
}

function clearScore(matchId) {
  try { localStorage.removeItem(`score_${matchId}`); } catch (_) {}
}

export default function ScoreModal({
  match,
  tournamentScoringMode = "traditional",
  onSetWin,
  onUndo,
  onPersistMatch,
  onClose,
}) {
  const { teamA, teamB, sets = [], winner, format, matchId } = match;
  const needed = setsNeeded(format);
  const total  = setsTotal(format);
  const winsA  = sets.filter(s => s.winner === "A").length;
  const winsB  = sets.filter(s => s.winner === "B").length;

  const [localA, setLocalA] = useState(() => getStoredScore(matchId).a);
  const [localB, setLocalB] = useState(() => getStoredScore(matchId).b);
  const [flashA, setFlashA] = useState(null); // 'plus' | 'minus' | null
  const [flashB, setFlashB] = useState(null);
  const [autoGameEnded, setAutoGameEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scoringMode, setScoringMode] = useState(() =>
    getStoredScoringMode(matchId, tournamentScoringMode),
  );
  const [courtSwapped, setCourtSwapped] = useState(() => getCourtSwap(matchId));
  const [showCourtChangePopup, setShowCourtChangePopup] = useState(false);
  const crossedElevenRef = useRef(false);

  function cloneCurrentGame(cg) {
    if (!cg) return null;
    return { ...cg };
  }

  useEffect(() => {
    const saved = getStoredScore(matchId);
    setLocalA(saved.a);
    setLocalB(saved.b);
  }, [matchId]);

  useEffect(() => {
    setScoringMode(getStoredScoringMode(matchId, tournamentScoringMode));
  }, [matchId, tournamentScoringMode]);

  useEffect(() => {
    setCourtSwapped(getCourtSwap(matchId));
  }, [matchId]);

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

  // Auto-detect when game ends
  useEffect(() => {
    const won =
      scoringMode === "rally"
        ? isRallyGameWon(localA, localB)
        : isGameWon(localA, localB);
    if (won && !autoGameEnded && (localA > 0 || localB > 0)) {
      setAutoGameEnded(true);
      const winningTeam =
        scoringMode === "rally"
          ? getRallyGameWinner(localA, localB)
          : getGameWinner(localA, localB);
      // Trigger auto set win after a brief delay for UI feedback
      setTimeout(() => {
        onSetWin(match, winningTeam, localA, localB);
        clearScore(matchId);
        setLocalA(0);
        setLocalB(0);
        setAutoGameEnded(false);
      }, 500);
    }
  }, [localA, localB, autoGameEnded, match, onSetWin, matchId, scoringMode]);

  function triggerFlash(side, type) {
    if (side === "A") { setFlashA(type); setTimeout(() => setFlashA(null), 300); }
    else              { setFlashB(type); setTimeout(() => setFlashB(null), 300); }
  }

  async function handlePointScored(scoringTeam) {
    if (!onPersistMatch || saving || winner || !teamA || !teamB) return;

    setSaving(true);

    try {
      const m = {
        ...match,
        sets: [...(match.sets || [])],
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
        triggerFlash(scoringTeam, "plus");
        return;
      }

      if (result.fault) {
        await onPersistMatch(m);
        triggerFlash(scoringTeam, "plus");
        return;
      }

      setLocalA(newScoreA);
      setLocalB(newScoreB);
      await onPersistMatch(m);
      triggerFlash(scoringTeam, "plus");
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoPointA() {
    if (!onPersistMatch || saving || localA === 0) return;
    setSaving(true);
    try {
      const newScoreA = localA - 1;
      setLocalA(newScoreA);
      triggerFlash("A", "minus");
      
      const m = {
        ...match,
        sets: [...(match.sets || [])],
        currentGame: match.currentGame
          ? { ...match.currentGame }
          : null, // Simple point minus, maybe don't touch server logic
      };
      await onPersistMatch(m);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoPointB() {
    if (!onPersistMatch || saving || localB === 0) return;
    setSaving(true);
    try {
      const newScoreB = localB - 1;
      setLocalB(newScoreB);
      triggerFlash("B", "minus");
      
      const m = {
        ...match,
        sets: [...(match.sets || [])],
        currentGame: match.currentGame
          ? { ...match.currentGame }
          : null,
      };
      await onPersistMatch(m);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleUndo() {
    onUndo(match);
    clearScore(matchId);
    setLocalA(0); setLocalB(0);
  }

  function formatLabel() {
    if (format === "bo3") return "Best of 3";
    if (format === "bo5") return "Best of 5";
    return "Single Game";
  }

  function initials(name) {
    if (!name) return "?";
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }

  function setWinnerName(s) {
    if (s.winner === "A") return teamA;
    if (s.winner === "B") return teamB;
    return s.winner;
  }

  const hasUnsaved = (localA > 0 || localB > 0) && !winner;

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ position: "relative" }}>

        {/* Header */}
        <div className="modal-hdr">
          <div className="modal-hdr-left">
            <span className="modal-match-id">{matchId}</span>
            <span className="modal-format-tag">{formatLabel()}</span>
            <span
              className="modal-format-tag"
              style={{
                borderColor: scoringMode === "rally" ? "var(--pickle)" : undefined,
                color: scoringMode === "rally" ? "var(--pickle)" : undefined,
              }}
            >
              {scoringMode === "rally" ? "Rally (21)" : "Traditional (11)"}
            </span>
            {hasUnsaved && <span className="score-saved-badge">● Score saved locally</span>}
          </div>
          <div className="modal-hdr-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {onUndo && !winner && (localA > 0 || localB > 0) && (
              <button
                type="button"
                className="modal-close"
                style={{ fontSize: "0.75rem", padding: "6px 10px", width: "auto" }}
                onClick={handleUndo}
                title="Clear local score and notify bracket"
              >
                Reset score
              </button>
            )}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {!winner && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: "rgba(0,0,0,0.15)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Mode</span>
              <div style={{ display: "inline-flex", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setScoringMode("traditional");
                    setStoredScoringMode(matchId, "traditional");
                  }}
                  disabled={saving}
                  style={{
                    padding: "6px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    border: "none",
                    cursor: saving ? "not-allowed" : "pointer",
                    background: scoringMode === "traditional" ? "rgba(200,230,58,0.15)" : "transparent",
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
                    padding: "6px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    border: "none",
                    borderLeft: "1px solid var(--border)",
                    cursor: saving ? "not-allowed" : "pointer",
                    background: scoringMode === "rally" ? "rgba(200,230,58,0.15)" : "transparent",
                  }}
                >
                  Rally
                </button>
              </div>
            </div>
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
                padding: "6px 14px",
                fontSize: "0.78rem",
                fontWeight: 700,
                borderRadius: "8px",
                border: "1px solid #c8e63a44",
                background: "linear-gradient(145deg, #1a2410, #121a0c)",
                color: "var(--pickle)",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              ⇄ Change court
            </button>
          </div>
        )}

        {/* Game Status and Serving Info */}
        {!winner && (localA > 0 || localB > 0) && (
          <div className="modal-game-info">
            <div className="game-info-row">
              <div className="game-status">
                <span className="status-label">🎮 Game Status</span>
                {(scoringMode === "rally" ? isRallyGameWon(localA, localB) : isGameWon(localA, localB)) ? (
                  <span className="status-value ready">🎯 Auto-Recording...</span>
                ) : scoringMode === "rally" ? (
                  localA >= 20 || localB >= 20 ? (
                    <span className="status-value close">⚡ Close (need 2-point lead)</span>
                  ) : (
                    <span className="status-value playing">Playing ({Math.max(localA, localB)} pts)</span>
                  )
                ) : localA >= 10 || localB >= 10 ? (
                  <span className="status-value close">⚡ Close (need 2-point lead)</span>
                ) : (
                  <span className="status-value playing">Playing ({Math.max(localA, localB)} pts)</span>
                )}
              </div>
              <div className="serving-info">
                <span className="serving-label">🎾 Serving</span>
                <span className="serving-value">
                  {match.currentGame?.servingTeam === "A" ? teamA : teamB}
                  {match.currentGame?.servingSide && ` (${match.currentGame.servingSide === "right" ? "▶" : "◀"})`}
                  {scoringMode === "rally"
                    ? (match.currentGame?.servingSide === "right" ? " [R]" : " [L]")
                    : (match.currentGame?.firstServer ? " [1st]" : " [2nd]")}
                </span>
              </div>
            </div>
          </div>
        )}

        {winner ? (
          <div className="winner-state">
            <div className="winner-crown-big">🏆</div>
            <div className="winner-state-name">{winner}</div>
            <div className="winner-state-sub">wins the match and advances!</div>
            <div className="winner-sets-recap">
              {sets.map((s, i) => (
                <span key={i} className={`set-chip-recap ${s.winner === "A" ? "chip-a" : "chip-b"}`}>
                  Set {i + 1}: {setWinnerName(s)}{s.scoreA !== undefined ? ` (${s.scoreA}–${s.scoreB})` : ""}
                </span>
              ))}
            </div>
            <button className="modal-close-btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            {/* Score panels */}
            <div className="score-panels">

              {/* Team A */}
              <div className="score-panel panel-a" style={{ order: courtSwapped ? 3 : 1 }}>
                <div className="panel-avatar avatar-a">{initials(teamA)}</div>
                <div className="panel-name">
                  {teamA}
                  {match.currentGame?.servingTeam === "A" && (
                    <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                      {scoringMode === "rally"
                        ? (match.currentGame.servingSide === "right" ? "🎾 RIGHT COURT" : "🎾 LEFT COURT")
                        : (match.currentGame.firstServer ? "🎾 1ST SERVER" : "🎾 2ND SERVER")}
                    </div>
                  )}
                </div>

                {/* Big score with flash ring */}
                <div className={`panel-score-wrap ${flashA === "plus" ? "flash-plus" : flashA === "minus" ? "flash-minus" : ""}`}>
                  <div className="panel-big-score">{localA}</div>
                </div>

                {/* Button Group - POINT and MINUS */}
                <div className="score-btn-group" style={{width: "100%", marginTop: "12px", gap: "8px", flexDirection: "column"}}>
                  <button 
                    className="score-action-btn btn-plus" 
                    onClick={() => handlePointScored("A")}
                    disabled={saving || !onPersistMatch}
                    style={{width: "100%", fontSize: "1rem"}}
                  >
                    <span>POINT</span>
                  </button>
                  <button 
                    className="score-action-btn btn-minus" 
                    onClick={() => handleUndoPointA()}
                    disabled={saving || localA === 0}
                    style={{width: "100%", fontSize: "0.9rem", opacity: localA === 0 ? 0.4 : 1, cursor: localA === 0 ? "not-allowed" : "pointer"}}
                  >
                    <span>UNDO</span>
                  </button>
                </div>

                {format !== "bo1" && (
                  <div className="panel-set-wins">
                    {Array.from({ length: needed }).map((_, i) => (
                      <span key={i} className={`set-pip-lg ${i < winsA ? "pip-filled-a" : ""}`}/>
                    ))}
                  </div>
                )}
              </div>

              {/* Center */}
              <div className="score-center" style={{ order: 2 }}>
                <div className="score-center-vs">VS</div>
                <div
                  aria-hidden="true"
                  style={{ marginTop: "auto", marginBottom: "auto", width: "56px", height: "56px", flexShrink: 0 }}
                />
                {format !== "bo1" && (
                  <>
                    <div className="score-center-sets">
                      {Array.from({ length: total }).map((_, i) => {
                        const s = sets[i];
                        return <div key={i} className={`center-pip ${s?.winner === "A" ? "cpip-a" : s?.winner === "B" ? "cpip-b" : "cpip-empty"}`}/>;
                      })}
                    </div>
                    <div className="score-center-tally">{winsA} – {winsB}</div>
                  </>
                )}
              </div>

              {/* Team B */}
              <div className="score-panel panel-b" style={{ order: courtSwapped ? 1 : 3 }}>
                <div className="panel-avatar avatar-b">{initials(teamB)}</div>
                <div className="panel-name">
                  {teamB}
                  {match.currentGame?.servingTeam === "B" && (
                    <div style={{fontSize: "0.7rem", color: "var(--pickle)", marginTop: "4px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px"}}>
                      {scoringMode === "rally"
                        ? (match.currentGame.servingSide === "right" ? "🎾 RIGHT COURT" : "🎾 LEFT COURT")
                        : (match.currentGame.firstServer ? "🎾 1ST SERVER" : "🎾 2ND SERVER")}
                    </div>
                  )}
                </div>

                <div className={`panel-score-wrap ${flashB === "plus" ? "flash-plus" : flashB === "minus" ? "flash-minus" : ""}`}>
                  <div className="panel-big-score">{localB}</div>
                </div>

                {/* Button Group - POINT and MINUS */}
                <div className="score-btn-group" style={{width: "100%", marginTop: "12px", gap: "8px", flexDirection: "column"}}>
                  <button 
                    className="score-action-btn btn-plus" 
                    onClick={() => handlePointScored("B")}
                    disabled={saving || !onPersistMatch}
                    style={{width: "100%", fontSize: "1rem", background: "linear-gradient(145deg, #2a1500, #1c0f00)", borderColor: "#f9731655"}}
                  >
                    <span>POINT</span>
                  </button>
                  <button 
                    className="score-action-btn btn-minus" 
                    onClick={() => handleUndoPointB()}
                    disabled={saving || localB === 0}
                    style={{width: "100%", fontSize: "0.9rem", opacity: localB === 0 ? 0.4 : 1, cursor: localB === 0 ? "not-allowed" : "pointer"}}
                  >
                    <span>UNDO</span>
                  </button>
                </div>

                {format !== "bo1" && (
                  <div className="panel-set-wins">
                    {Array.from({ length: needed }).map((_, i) => (
                      <span key={i} className={`set-pip-lg ${i < winsB ? "pip-filled-b" : ""}`}/>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Set history */}
            {sets.length > 0 && (
              <div className="sets-history">
                <div className="sh-label">Set history</div>
                <div className="sh-chips">
                  {sets.map((s, i) => (
                    <div key={i} className={`sh-chip ${s.winner === "A" ? "sh-chip-a" : "sh-chip-b"}`}>
                      Set {i + 1} — {setWinnerName(s)}{s.scoreA !== undefined ? ` (${s.scoreA}–${s.scoreB})` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {showCourtChangePopup && scoringMode === "rally" && !winner && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 30,
              background: "rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
            }}
            onClick={() => setShowCourtChangePopup(false)}
            role="presentation"
          >
            <div
              className="confirm-box"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "380px", textAlign: "center", position: "relative", zIndex: 31 }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>↔️</div>
              <div style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "8px", color: "var(--pickle)" }}>
                Change court now
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", marginBottom: "14px", lineHeight: 1.45 }}>
                A team has reached 11 points. Switch sides on the court, then tap <strong>Change court</strong> if the display should match.
              </p>
              <button type="button" className="confirm-proceed" style={{ width: "100%" }} onClick={() => setShowCourtChangePopup(false)}>
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}