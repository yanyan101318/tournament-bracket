import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const STATE_DOC = doc(db, "paddleStack", "state");

function PickleballSVG({ size = 40 }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" width={size} height={size}>
      <circle cx="20" cy="20" r="19" fill="#c8e63a" stroke="#a8c420" strokeWidth="1.5" />
      {[[20, 8], [20, 32], [8, 20], [32, 20], [12, 12], [28, 12], [12, 28], [28, 28], [20, 20]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.2" fill="#7aaa00" opacity="0.75" />
      ))}
      <ellipse cx="14" cy="13" rx="4" ry="2.5" fill="white" opacity="0.2" transform="rotate(-30 14 13)" />
    </svg>
  );
}

function parseTeams(court) {
  const slots = court.playerSlots || [];
  let teamA = [];
  let teamB = [];

  if (slots.length === 1 && slots[0].members) {
    const m = slots[0].members;
    teamA = [m[0], m[1]].filter(Boolean);
    teamB = [m[2], m[3]].filter(Boolean);
  } else if (court.gameType === "singles") {
    teamA = slots.slice(0, 1).map(s => s.name || "Player 1");
    teamB = slots.slice(1, 2).map(s => s.name || "Player 2");
  } else {
    teamA = slots.slice(0, 2).map(s => s.name || "Player");
    teamB = slots.slice(2, 4).map(s => s.name || "Player");
  }

  return {
    nameA: teamA.join(" & ") || "Team A",
    nameB: teamB.join(" & ") || "Team B"
  };
}

export default function PaddleViewerPage() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(STATE_DOC, (snap) => {
      if (snap.exists()) {
        setState({ id: snap.id, ...snap.data() });
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return (
    <div className="vp2-loading">
      <div className="vp2-loading-ball"><PickleballSVG size={72} /></div>
      <div className="vp2-loading-text">Loading Paddle Queue...</div>
      <div className="vp2-dots"><span /><span /><span /></div>
    </div>
  );

  const queue = state?.queue || [];
  const courts = state?.courts || [];
  const ongoingCourts = courts.filter(c => c.status === "ongoing");

  return (
    <div className="vp2-page" style={{ overflowY: "auto" }}>
      {/* BACKGROUND */}
      <div className="app-background">
        <div className="bg-geometric-pattern" />
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>

      <div className="vp2-header" style={{ position: "relative" }}>
        <div className="vp2-header-left">
          <div className="vp2-pickle-icon"><PickleballSVG size={36} /></div>
          <div className="vp2-title-stack">
            <div className="vp2-title">PADDLE STACK</div>
            <div className="vp2-subtitle">Live Courts & Queue</div>
          </div>
        </div>
      </div>

      <div className="vp2-body" style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "2rem", padding: "2rem", alignItems: "flex-start" }}>
        
        {/* UP NEXT QUEUE (Left Side) */}
        <div style={{ flex: "1 1 300px", maxWidth: "450px" }}>
          <h2 style={{ color: "var(--accent)", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "1rem" }}>
            Up Next
          </h2>
          {queue.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>The queue is currently empty.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {queue.slice(0, 10).map((q, i) => (
                <div key={q.id} style={{
                  display: "flex", alignItems: "center", padding: "1rem",
                  background: "rgba(255,255,255,0.03)", borderRadius: "8px",
                  borderLeft: i === 0 ? "4px solid var(--pickle)" : "4px solid var(--border)",
                  color: "var(--text)", fontSize: "1.2rem", fontWeight: "bold"
                }}>
                  <span style={{ width: "30px", color: "var(--text-muted)", fontSize: "1rem" }}>{i + 1}</span>
                  <span style={{ marginLeft: "1rem" }}>
                    {q.kind === "group" ? `Group: ${(q.members || []).join(" & ")}` : q.name}
                  </span>
                  {q.category && q.skillLevel && (
                    <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.7rem", background: "rgba(255,255,255,0.1)", padding: "0.2rem 0.5rem", borderRadius: "4px", textTransform: "uppercase" }}>{q.category}</span>
                      <span style={{ fontSize: "0.7rem", background: "rgba(255,255,255,0.1)", padding: "0.2rem 0.5rem", borderRadius: "4px", textTransform: "uppercase" }}>{q.skillLevel}</span>
                    </div>
                  )}
                </div>
              ))}
              {queue.length > 10 && (
                <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "1rem" }}>
                  + {queue.length - 10} more in queue...
                </div>
              )}
            </div>
          )}
        </div>

        {/* ONGOING COURTS (Right Side) */}
        <div style={{ flex: "2 1 500px" }}>
          <h2 style={{ color: "var(--pickle)", textTransform: "uppercase", letterSpacing: "2px", marginBottom: "1rem" }}>
            Live Courts
          </h2>
          {ongoingCourts.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No active matches currently playing.</div>
          ) : (
            <div className="vp2-matches-grid card-md" style={{ gap: "1rem" }}>
              {ongoingCourts.map(c => {
                const { nameA, nameB } = parseTeams(c);
                const scoreA = c.scoreA || 0;
                const scoreB = c.scoreB || 0;
                return (
                  <div key={c.id} className="vp2-card vp2-live card-md">
                    {c.name && (
                      <div className="vp2-court-header">
                        <span className="vp2-court-text">{c.name}</span>
                      </div>
                    )}
                    <div className="vp2-card-topbar" style={{ justifyContent: "flex-end" }}>
                      <span className="vp2-status-pill vp2-pill-live">● LIVE</span>
                    </div>
                    <div className="vp2-card-body">
                      {/* Team A */}
                      <div className="vp2-side vp2-side-a">
                        <div className="vp2-team-info">
                          <div className="vp2-team-nm" style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>{nameA}</div>
                        </div>
                      </div>

                      {/* Center Score */}
                      <div className="vp2-center-col">
                        <div className="vp2-score-display vp2-points-display">
                          <span className="vp2-big-num vp2-realtime-a">{scoreA}</span>
                          <span className="vp2-num-sep">–</span>
                          <span className="vp2-big-num vp2-realtime-b">{scoreB}</span>
                        </div>
                        <div className="vp2-live-indicator">● {c.gameType || "doubles"}</div>
                      </div>

                      {/* Team B */}
                      <div className="vp2-side vp2-side-b">
                        <div className="vp2-team-info">
                          <div className="vp2-team-nm" style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>{nameB}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
