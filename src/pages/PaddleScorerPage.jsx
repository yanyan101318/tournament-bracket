import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  onSnapshot,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import toast from "react-hot-toast";

const STATE_DOC = doc(db, "paddleStack", "state");

function courtClearedForAvailable(c) {
  const { assignSource, randomFilter, scoreA, scoreB, ...rest } = c;
  return {
    ...rest,
    status: "available",
    gameType: null,
    playerSlots: [],
    startedAt: null,
  };
}

function parseTeams(court) {
  const slots = court.playerSlots || [];
  let teamA = [];
  let teamB = [];

  if (slots.length === 1 && slots[0].members) {
    // Group of 4
    const m = slots[0].members;
    teamA = [m[0], m[1]].filter(Boolean);
    teamB = [m[2], m[3]].filter(Boolean);
  } else if (court.gameType === "singles") {
    teamA = slots.slice(0, 1).map(s => s.name || "Player 1");
    teamB = slots.slice(1, 2).map(s => s.name || "Player 2");
  } else {
    // Doubles or fallback
    teamA = slots.slice(0, 2).map(s => s.name || "Player");
    teamB = slots.slice(2, 4).map(s => s.name || "Player");
  }

  return { 
    nameA: teamA.join(" & ") || "Team A", 
    nameB: teamB.join(" & ") || "Team B" 
  };
}

export default function PaddleScorerPage() {
  const { courtId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(STATE_DOC, (snap) => {
      if (snap.exists()) {
        setState({ id: snap.id, ...snap.data() });
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="sp-loading">
        <div className="sp-loading-text">Loading court data...</div>
      </div>
    );
  }

  const courts = state?.courts || [];
  const ongoingCourts = courts.filter(c => c.status === "ongoing");

  if (!courtId) {
    return (
      <div className="sp-page" style={{ padding: "2rem" }}>
        <h2 style={{ color: "var(--text)", textAlign: "center", marginBottom: "2rem" }}>
          Select a Court to Score
        </h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center" }}>
          {ongoingCourts.length === 0 && (
            <p style={{ color: "var(--text-muted)" }}>No ongoing matches right now.</p>
          )}
          {ongoingCourts.map(c => (
            <div 
              key={c.id}
              onClick={() => navigate(`/paddle-score/${c.id}`)}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)", 
                padding: "1.5rem", borderRadius: "12px", cursor: "pointer", minWidth: "250px"
              }}
            >
              <h3 style={{ color: "var(--pickle)", margin: "0 0 0.5rem 0" }}>{c.name}</h3>
              <div style={{ color: "var(--text)", fontSize: "0.9rem" }}>
                {parseTeams(c).nameA} vs {parseTeams(c).nameB}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const court = courts.find(c => c.id === courtId);

  if (!court || court.status !== "ongoing") {
    return (
      <div className="sp-page" style={{ padding: "2rem", textAlign: "center" }}>
        <h2 style={{ color: "var(--text)" }}>Match not found or already finished.</h2>
        <button 
          className="sp-score-btn" 
          onClick={() => navigate("/paddle-score")}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem", fontSize: "1rem" }}
        >
          Back to Court List
        </button>
      </div>
    );
  }

  const { nameA, nameB } = parseTeams(court);
  const scoreA = court.scoreA || 0;
  const scoreB = court.scoreB || 0;

  async function updateScore(newA, newB) {
    if (saving) return;
    setSaving(true);
    try {
      if (newA >= 15 || newB >= 15) {
        // Match ends!
        const winner = newA >= 15 ? nameA : nameB;
        toast.success(`🎉 ${winner} wins! Court is now free.`);
        await finishMatch(newA, newB);
        navigate("/paddle-score");
        return;
      }

      const nextCourts = courts.map(c => c.id === court.id ? { ...c, scoreA: newA, scoreB: newB } : c);
      await updateDoc(STATE_DOC, { courts: nextCourts, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
      toast.error("Failed to update score.");
    } finally {
      setSaving(false);
    }
  }

  async function finishMatch(finalA, finalB) {
    const endedAt = Timestamp.now();
    const nextCourts = courts.map(c => c.id === court.id ? courtClearedForAvailable(c) : c);
    
    // 1. Update courts in state to free it up
    await updateDoc(STATE_DOC, { courts: nextCourts, updatedAt: serverTimestamp() });

    // 2. Add to match history
    try {
      await addDoc(collection(db, "paddleMatchHistory"), {
        courtId: court.id,
        courtName: court.name,
        gameType: court.gameType,
        players: court.playerSlots || [],
        startedAt: court.startedAt || endedAt,
        endedAt,
        assignSource: court.assignSource || "fifo",
        randomFilter: court.randomFilter || null,
        finalScoreA: finalA,
        finalScoreB: finalB,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to add history:", err);
    }
  }

  return (
    <div className="sp-page">
      <div className="sp-content">
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "rgba(0,0,0,0.2)"
        }}>
          <div style={{ color: "var(--pickle)", fontWeight: "bold" }}>{court.name}</div>
          <button 
            onClick={() => navigate("/paddle-score")}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", padding: "4px 8px", borderRadius: "6px", cursor: "pointer" }}
          >
            Switch Court
          </button>
        </div>

        <div className="sp-scoreboard">
          {/* TEAM A */}
          <div className="sp-team-panel sp-team-a" style={{ order: 1 }}>
            <div className="sp-team-name">{nameA}</div>
            <div className="sp-score-ring">
              <span className="sp-score-num">{scoreA}</span>
            </div>
            <div style={{ width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column" }}>
              <button 
                className="sp-score-btn sp-btn-plus" 
                onClick={() => updateScore(scoreA + 1, scoreB)} 
                disabled={saving}
                style={{ width: "100%", fontSize: "1rem" }}
              >
                <span>POINT</span>
              </button>
              <button 
                className="sp-score-btn sp-btn-minus" 
                onClick={() => updateScore(Math.max(0, scoreA - 1), scoreB)}
                disabled={saving || scoreA === 0}
                style={{ width: "100%", fontSize: "0.9rem", opacity: scoreA === 0 ? 0.4 : 1 }}
              >
                <span>UNDO</span>
              </button>
            </div>
          </div>

          {/* VS */}
          <div className="sp-team-panel sp-vs-col" style={{ order: 2 }}>
            <span style={{ fontSize: "1rem", color: "var(--text-muted)", fontWeight: "bold" }}>VS</span>
          </div>

          {/* TEAM B */}
          <div className="sp-team-panel sp-team-b" style={{ order: 3 }}>
            <div className="sp-team-name">{nameB}</div>
            <div className="sp-score-ring">
              <span className="sp-score-num">{scoreB}</span>
            </div>
            <div style={{ width: "100%", marginTop: "12px", gap: "8px", display: "flex", flexDirection: "column" }}>
              <button 
                className="sp-score-btn sp-btn-plus" 
                onClick={() => updateScore(scoreA, scoreB + 1)} 
                disabled={saving}
                style={{ width: "100%", fontSize: "1rem" }}
              >
                <span>POINT</span>
              </button>
              <button 
                className="sp-score-btn sp-btn-minus" 
                onClick={() => updateScore(scoreA, Math.max(0, scoreB - 1))}
                disabled={saving || scoreB === 0}
                style={{ width: "100%", fontSize: "0.9rem", opacity: scoreB === 0 ? 0.4 : 1 }}
              >
                <span>UNDO</span>
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: "1rem", display: "flex", justifyContent: "center", background: "rgba(0,0,0,0.3)" }}>
          <button 
            className="sp-score-btn"
            onClick={() => {
              if (window.confirm("End match and free court now?")) {
                finishMatch(scoreA, scoreB);
                navigate("/paddle-score");
              }
            }}
            disabled={saving}
            style={{ background: "#ef444422", color: "#f87171", border: "1px solid #ef444455", padding: "0.75rem 2rem" }}
          >
            End Match & Free Court
          </button>
        </div>
      </div>
    </div>
  );
}
