// src/components/BracketView.jsx
import { useState } from "react";
import MatchCard from "./MatchCard";
import ScoreModal from "./ScoreModal";
import { getShareOrigin } from "../utils/shareUrl";
import { copyText } from "../utils/clipboard";
import { QRCodeSVG } from "qrcode.react";

const ROUND_LABELS = ["Round 1", "Quarterfinals", "Semifinals", "Final", "Grand Final"];

const STREAK_BALLS = [
  { x: 8,  y: 12, dur: 18, delay: 0,   size: 22 },
  { x: 25, y: 78, dur: 22, delay: 3,   size: 16 },
  { x: 60, y: 8,  dur: 15, delay: 1.5, size: 28 },
  { x: 78, y: 60, dur: 20, delay: 5,   size: 18 },
  { x: 45, y: 90, dur: 17, delay: 2,   size: 24 },
  { x: 92, y: 25, dur: 25, delay: 4,   size: 14 },
  { x: 12, y: 55, dur: 19, delay: 6,   size: 20 },
];

const GHOST_PADDLES = [
  { x: 3,  y: 20, rot: -40, size: 90, dur: 20, delay: 0   },
  { x: 93, y: 65, rot: 30,  size: 75, dur: 18, delay: 2.5 },
  { x: 50, y: 95, rot: 10,  size: 65, dur: 22, delay: 1   },
  { x: 85, y: 5,  rot: -20, size: 80, dur: 16, delay: 3.5 },
];

// Clear ALL score_* keys from localStorage
function clearAllScores() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("score_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (_) {}
}

export default function BracketView({
  tournamentName, rounds, format, tournamentId,
  scoringMode = "traditional",
  onSetWin, onUndo, onPersistMatch, onReset,
}) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [showConfirm, setShowConfirm]  = useState(false);
  const [copiedId, setCopiedId]        = useState(null);
  const [qrModalMatchId, setQrModalMatchId] = useState(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const champion = rounds[rounds.length - 1]?.[0]?.winner;

  function getRoundLabel(i, total) {
  if (i < ROUND_LABELS.length) return ROUND_LABELS[i];
    return `Round ${i + 1}`;
  }

  function handleSetWin(match, team, sA, sB) {
    onSetWin(match, team, sA, sB);
    setActiveMatch(prev => prev ? { ...prev, matchId: match.matchId } : null);
  }

  function handleReset() {
    clearAllScores();   // ← wipe all localStorage scores first
    setShowConfirm(false);
    onReset();
  }

  async function copyScorerLink(matchId) {
    const shareOrigin = await getShareOrigin();
    await copyText(`${shareOrigin}/score/${tournamentId}/${matchId}`);
    setCopiedId(matchId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function copyViewerLink() {
    if (!tournamentId) return;
    const shareOrigin = await getShareOrigin();
    await copyText(`${shareOrigin}/bracket/${tournamentId}`);
    setCopiedId("viewer");
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function openLedFocus(matchId) {
    if (!tournamentId || !matchId) return;
    const shareOrigin = await getShareOrigin();
    window.open(`${shareOrigin}/bracket/${tournamentId}?focus=${matchId}`, "_blank", "noopener,noreferrer");
  }

  async function handleShowQr(match) {
    if (!match.pinCode) {
      setIsGeneratingQr(true);
      const newPin = Math.floor(100000 + Math.random() * 900000).toString();
      try {
        await onPersistMatch({
          ...match,
          pinCode: newPin,
          pinStatus: "active"
        });
      } catch (err) {
        console.error("Failed to generate PIN", err);
      }
      setIsGeneratingQr(false);
    }
    setQrModalMatchId(match.matchId);
  }

  async function handleRegeneratePin(match) {
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    try {
      await onPersistMatch({
        ...match,
        pinCode: newPin,
        pinStatus: "active"
      });
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
    const canvas = document.getElementById("qr-canvas-" + matchId);
    if (!canvas) {
      // It's an SVG, so we need to convert it to download.
      // Easiest is to create a blob from the SVG string
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
  }

  const latestActive = activeMatch
    ? rounds.flat().find(m => m.matchId === activeMatch.matchId) ?? null
    : null;

  const qrMatch = qrModalMatchId
    ? rounds.flat().find(m => m.matchId === qrModalMatchId) ?? null
    : null;

  return (
    <div className="bracket-page">

      {/* ── BRACKET BACKGROUND ── */}
      <div className="bracket-bg" aria-hidden="true">
        <svg className="bracket-net-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {[10,20,30,40,50,60,70,80,90].map(y => (
            <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} stroke="#c8e63a" strokeWidth="0.15" opacity="0.07"/>
          ))}
          {[10,20,30,40,50,60,70,80,90].map(x => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" stroke="#c8e63a" strokeWidth="0.15" opacity="0.07"/>
          ))}
          <rect x="5" y="5" width="90" height="90" fill="none" stroke="#c8e63a" strokeWidth="0.3" opacity="0.1"/>
          <line x1="5" y1="50" x2="95" y2="50" stroke="#c8e63a" strokeWidth="0.5" opacity="0.12"/>
          <line x1="5" y1="27" x2="95" y2="27" stroke="#c8e63a" strokeWidth="0.3" opacity="0.09" strokeDasharray="1 2"/>
          <line x1="5" y1="73" x2="95" y2="73" stroke="#c8e63a" strokeWidth="0.3" opacity="0.09" strokeDasharray="1 2"/>
          <line x1="50" y1="27" x2="50" y2="73" stroke="#c8e63a" strokeWidth="0.2" opacity="0.08" strokeDasharray="0.8 1.5"/>
        </svg>

        {STREAK_BALLS.map((b, i) => (
          <div key={i} className="bracket-streak-ball" style={{
            left: `${b.x}%`, top: `${b.y}%`,
            width: b.size, height: b.size,
            animationDuration: `${b.dur}s`,
            animationDelay: `${b.delay}s`,
          }}>
            <svg viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="19" fill="#c8e63a" stroke="#a8c420" strokeWidth="1.5"/>
              {[[20,8],[20,32],[8,20],[32,20],[12,12],[28,12],[12,28],[28,28],[20,20]].map(([cx,cy],j)=>(
                <circle key={j} cx={cx} cy={cy} r="2.2" fill="#7aaa00" opacity="0.75"/>
              ))}
              <ellipse cx="14" cy="13" rx="4" ry="2.5" fill="white" opacity="0.2" transform="rotate(-30 14 13)"/>
            </svg>
          </div>
        ))}

        {GHOST_PADDLES.map((p, i) => (
          <div key={i} className="bracket-ghost-paddle" style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size * 1.55,
            transform: `rotate(${p.rot}deg)`,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}>
            <svg viewBox="0 0 60 93" fill="none">
              <ellipse cx="30" cy="32" rx="28" ry="30" fill="#c8e63a" opacity="0.06"/>
              <ellipse cx="30" cy="32" rx="28" ry="30" fill="none" stroke="#c8e63a" strokeWidth="1.5" opacity="0.15"/>
              <rect x="22" y="68" width="16" height="22" rx="5" fill="#c8e63a" opacity="0.06"/>
              <rect x="22" y="68" width="16" height="22" rx="5" fill="none" stroke="#c8e63a" strokeWidth="1" opacity="0.1"/>
              <rect x="24" y="60" width="12" height="10" rx="3" fill="none" stroke="#c8e63a" strokeWidth="1" opacity="0.08"/>
            </svg>
          </div>
        ))}

        <svg className="bracket-corner-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 0 20 Q 0 0 20 0"   fill="none" stroke="#c8e63a" strokeWidth="0.4" opacity="0.2"/>
          <path d="M 80 0 Q 100 0 100 20" fill="none" stroke="#c8e63a" strokeWidth="0.4" opacity="0.2"/>
          <path d="M 0 80 Q 0 100 20 100" fill="none" stroke="#c8e63a" strokeWidth="0.4" opacity="0.2"/>
          <path d="M 80 100 Q 100 100 100 80" fill="none" stroke="#c8e63a" strokeWidth="0.4" opacity="0.2"/>
          <circle cx="50" cy="50" r="12" fill="none" stroke="#c8e63a" strokeWidth="0.25" opacity="0.08"/>
          <circle cx="50" cy="50" r="6"  fill="none" stroke="#c8e63a" strokeWidth="0.2"  opacity="0.06"/>
        </svg>
      </div>

      {/* ── HEADER ── */}
      <div className="bracket-header">
        <div className="bracket-header-left">
          <div className="bracket-title-row">
            <span className="bracket-pickle-icon">
              <svg viewBox="0 0 40 40" fill="none" width="28" height="28">
                <circle cx="20" cy="20" r="19" fill="#c8e63a" stroke="#a8c420" strokeWidth="1.5"/>
                {[[20,8],[20,32],[8,20],[32,20],[12,12],[28,12],[12,28],[28,28],[20,20]].map(([cx,cy],i)=>(
                  <circle key={i} cx={cx} cy={cy} r="2.2" fill="#7aaa00" opacity="0.75"/>
                ))}
              </svg>
            </span>
            <h1 className="tournament-title">{tournamentName}</h1>
          </div>
          <div className="bracket-meta-row">
            <span className="format-badge">
              {format === "bo1" ? "Single Game" : format === "bo3" ? "Best of 3" : "Best of 5"}
            </span>
            {tournamentId && (
              <span className="bracket-id-badge">ID: {tournamentId}</span>
            )}
          </div>
        </div>
        <button className="reset-btn" onClick={() => setShowConfirm(true)}>
          <svg className="lock-icon" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="7" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          New Tournament
        </button>
      </div>

      {tournamentId && (
        <div className="share-panel">
          <div className="share-panel-inner">
            <div className="share-item">
              <span className="share-label">🔗 Viewer Link</span>
              <code className="share-url">{window.location.origin}/bracket/{tournamentId}</code>
              <button className="copy-btn" onClick={copyViewerLink}>
                {copiedId === "viewer" ? "✓ Copied!" : "Copy Viewer Link"}
              </button>
            </div>
            <div className="share-item">
              <span className="share-label">📋 Scorer Links</span>
              <span className="share-url">Use "Copy Scorer Link" button on each match card.</span>
            </div>
          </div>
        </div>
      )}

      {/* ── CHAMPION ── */}
      {champion && (
        <div className="champion-banner">
          <div className="champion-ball-icon">
            <svg viewBox="0 0 40 40" fill="none" width="40" height="40">
              <circle cx="20" cy="20" r="19" fill="#c8e63a" stroke="#a8c420" strokeWidth="1.5"/>
              {[[20,8],[20,32],[8,20],[32,20],[12,12],[28,12],[12,28],[28,28],[20,20]].map(([cx,cy],i)=>(
                <circle key={i} cx={cx} cy={cy} r="2.2" fill="#7aaa00" opacity="0.75"/>
              ))}
            </svg>
          </div>
          {/* <span className="champion-crown">👑</span> */}
          <span className="champion-name">{champion}</span>
          <span className="champion-label">is the Champion!</span>
        </div>
      )}

      {/* ── BRACKET ── */}
      <div className="bracket-scroll">
        <div className="rounds-container">
          {rounds.map((round, rIdx) => (
            <div key={rIdx} className="round-column">
              <div className="round-label-wrap">
                <div className="round-label">{getRoundLabel(rIdx, rounds.length)}</div>
                <div className="round-label-line"/>
              </div>
              <div className="round-matches">
                {round.map(match => (
                  <div key={match.matchId} className="match-with-link">
                    <MatchCard match={match} onClick={setActiveMatch}/>
                    {tournamentId && match.teamA && match.teamB && match.teamB !== "BYE" && (
                      <div className="bracket-card-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button
                          className={`scorer-link-btn ${copiedId === match.matchId ? "copied" : ""}`}
                          onClick={() => copyScorerLink(match.matchId)}
                          style={{ flex: 1 }}>
                          {copiedId === match.matchId ? "✓ Copied!" : "🔗 Copy Link"}
                        </button>
                        <button
                          className="qr-pin-btn"
                          onClick={() => handleShowQr(match)}
                          style={{
                            flex: 1, padding: "0.4rem", fontSize: "0.75rem", borderRadius: "6px",
                            background: "rgba(200, 230, 58, 0.15)", color: "var(--pickle)", border: "1px solid var(--pickle)", cursor: "pointer",
                            fontWeight: "bold",
                            transition: "all 0.2s"
                          }}>
                          QR & PIN
                        </button>
                        <button
                          type="button"
                          className="scorer-link-btn"
                          onClick={() => openLedFocus(match.matchId)}
                          style={{ flex: 1 }}
                          title="Open zoomed view on LED wall">
                          📺 LED Zoom
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SCORE MODAL ── */}
      {latestActive && (
        <ScoreModal
          match={latestActive}
          tournamentScoringMode={scoringMode}
          onSetWin={handleSetWin}
          onUndo={onUndo}
          onPersistMatch={onPersistMatch}
          onClose={() => setActiveMatch(null)}
        />
      )}

      {/* ── QR & PIN MODAL ── */}
      {qrMatch && (
        <div className="confirm-backdrop" onClick={() => setQrModalMatchId(null)}>
          <div className="confirm-box" style={{ maxWidth: '400px', padding: '2rem' }} onClick={e => e.stopPropagation()}>
            <div className="qr-modal-header" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <h2 style={{ margin: 0, color: 'var(--text)', fontSize: '1.4rem' }}>Secure Scorer Access</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0.5rem 0 0 0' }}>Scan to score match: {qrMatch.teamA} vs {qrMatch.teamB}</p>
            </div>
            
            {isGeneratingQr ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Generating secure PIN...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                <div style={{ background: '#fff', padding: '1rem', borderRadius: '8px' }}>
                  <QRCodeSVG 
                    id={"qr-svg-" + qrMatch.matchId}
                    value={`${window.location.origin}/score/${tournamentId}/${qrMatch.matchId}`} 
                    size={200}
                    level={"H"}
                  />
                </div>
                
                <div style={{ width: '100%', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>One-Time PIN</div>
                  <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--pickle)', letterSpacing: '8px', fontFamily: 'monospace' }}>
                    {qrMatch.pinCode}
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      padding: '2px 8px', 
                      borderRadius: '12px',
                      background: qrMatch.pinStatus === 'used' ? 'rgba(234,179,8,0.2)' : qrMatch.pinStatus === 'expired' || qrMatch.winner ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                      color: qrMatch.pinStatus === 'used' ? '#eab308' : qrMatch.pinStatus === 'expired' || qrMatch.winner ? '#ef4444' : '#22c55e',
                      textTransform: 'uppercase',
                      fontWeight: 'bold'
                    }}>
                      {qrMatch.winner ? 'EXPIRED (MATCH OVER)' : (qrMatch.pinStatus || 'ACTIVE')}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
                  <button 
                    onClick={() => handleCopyPin(qrMatch.pinCode)}
                    style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontWeight: 'bold' }}>
                    {copiedId === "pin" ? "✓ Copied!" : "Copy PIN"}
                  </button>
                  <button 
                    onClick={() => handleDownloadQr(qrMatch.matchId)}
                    style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', background: 'var(--pickle)', border: 'none', color: '#000', cursor: 'pointer', fontWeight: 'bold' }}>
                    Download QR
                  </button>
                </div>
                
                <button 
                  onClick={() => handleRegeneratePin(qrMatch)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.8rem' }}>
                  Regenerate PIN (Revokes previous access)
                </button>
              </div>
            )}
            
            <button className="confirm-cancel" style={{ width: '100%', marginTop: '1.5rem' }} onClick={() => setQrModalMatchId(null)}>Close</button>
          </div>
        </div>
      )}

      {/* ── CONFIRM RESET ── */}
      {showConfirm && (
        <div className="confirm-backdrop" onClick={() => setShowConfirm(false)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div className="confirm-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" className="confirm-lock-svg">
                <rect x="4" y="11" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="12" cy="17" r="1.5" fill="currentColor"/>
              </svg>
            </div>
            <div className="confirm-title">Start a new tournament?</div>
            <div className="confirm-desc">
              All current scores and bracket progress will be permanently lost. This cannot be undone.
            </div>
            <div className="confirm-btns">
              <button className="confirm-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="confirm-proceed" onClick={handleReset}>Yes, reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}