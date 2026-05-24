// src/pages/ViewerPage.jsx
import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { subscribeToMatches, subscribeToTournamentInfo } from "../services/tournamentService";

const ROUND_LABELS = ["Round 1","Quarterfinals","Semifinals","Final","Grand Final"];

function PickleballSVG({ size=40 }) {
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

function getSizeClass(count) {
  if (count <= 4)  return "vc-xl";
  if (count <= 8)  return "vc-lg";
  if (count <= 16) return "vc-md";
  if (count <= 32) return "vc-sm";
  return "vc-xs";
}

function getMaxCols(matchCount, sizeClass) {
  if (sizeClass === "vc-xl") return 2;
  if (sizeClass === "vc-lg") return 3;
  if (sizeClass === "vc-md") return 4;
  return Math.min(matchCount, 6);
}

function getRoundLabel(i, total) {
  return i < ROUND_LABELS.length ? ROUND_LABELS[i] : `Round ${i+1}`;
}

function buildRounds(matchMap) {
  const matches = Object.values(matchMap);
  if (!matches.length) return [];
  const maxRound = Math.max(...matches.map(m=>m.round||1));
  const rounds = [];
  for (let r=1; r<=maxRound; r++) {
    const rm = matches.filter(m=>m.round===r).sort((a,b)=>
      parseInt(a.matchId.split("-M")[1]) - parseInt(b.matchId.split("-M")[1])
    );
    if (rm.length) rounds.push(rm);
  }
  return rounds;
}

function matchDisplayPriority(m) {
  if (m.winner) return 50;
  const hasTeams = m.teamA && m.teamB && m.teamA !== "BYE" && m.teamB !== "BYE";
  const isLive = (m.sets?.length > 0)
    || m.scoreA > 0 || m.scoreB > 0
    || (m.scoreA !== undefined && m.scoreA !== 0)
    || (m.scoreB !== undefined && m.scoreB !== 0);
  if (isLive) return 0;
  if (hasTeams) return 10;
  return 30;
}

function findMatchForCourtSlot(allMatches, courtNum, usedIds) {
  const active = allMatches.find(m =>
    !usedIds.has(m.matchId) && String(m.courtNumber) === String(courtNum) && !m.winner
  );
  if (active) return active;
  return allMatches.find(m =>
    !usedIds.has(m.matchId) && String(m.courtNumber) === String(courtNum)
  ) || null;
}

/** Map grid slots 1–6 to matches: assigned courts first, then auto-fill playable matches */
function buildCourtGrid(allMatches) {
  const grid = {};
  const usedIds = new Set();

  for (let n = 1; n <= 6; n++) {
    const assigned = findMatchForCourtSlot(allMatches, n, usedIds);
    if (assigned) {
      grid[n] = assigned;
      usedIds.add(assigned.matchId);
    }
  }

  const withOtherCourt = allMatches
    .filter(m => m.courtNumber && !usedIds.has(m.matchId))
    .sort((a, b) => matchDisplayPriority(a) - matchDisplayPriority(b));

  for (const m of withOtherCourt) {
    const freeSlot = [1, 2, 3, 4, 5, 6].find(n => !grid[n]);
    if (!freeSlot) break;
    grid[freeSlot] = m;
    usedIds.add(m.matchId);
  }

  const pool = allMatches
    .filter(m => !usedIds.has(m.matchId) && !m.courtNumber && !m.winner)
    .sort((a, b) => matchDisplayPriority(a) - matchDisplayPriority(b));

  for (let n = 1; n <= 6; n++) {
    if (!grid[n] && pool.length) {
      grid[n] = pool.shift();
      usedIds.add(grid[n].matchId);
    }
  }

  return grid;
}

function getCourtLabel(match, slotNum) {
  if (match?.courtNumber) return String(match.courtNumber).toUpperCase();
  return String(slotNum);
}

export default function ViewerPage() {
  const { tournamentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [matchMap, setMatchMap] = useState({});
  const [info, setInfo]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [flashId, setFlashId]   = useState(null);
  const [focusedMatchId, setFocusedMatchId] = useState(() => searchParams.get("focus") || null);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setFocusedMatchId(focus);
  }, [searchParams]);

  useEffect(() => {
    const unsubInfo    = subscribeToTournamentInfo(tournamentId, setInfo);
    const unsubMatches = subscribeToMatches(tournamentId, (incoming) => {
      setMatchMap(prev => {
        const changed = Object.keys(incoming).find(id =>
          JSON.stringify(incoming[id]) !== JSON.stringify(prev[id])
        );
        if (changed) { setFlashId(changed); setTimeout(()=>setFlashId(null),1800); }
        return incoming;
      });
      setLoading(false);
    });
    return ()=>{ unsubInfo(); unsubMatches(); };
  }, [tournamentId]);

  function openFocus(matchId) {
    setFocusedMatchId(matchId);
    setSearchParams({ focus: matchId }, { replace: true });
  }

  function closeFocus() {
    setFocusedMatchId(null);
    setSearchParams({}, { replace: true });
  }

  if (loading) return (
    <div className="vp2-loading">
      <div className="vp2-loading-ball"><PickleballSVG size={72}/></div>
      <div className="vp2-loading-text">Loading bracket...</div>
      <div className="vp2-dots"><span/><span/><span/></div>
    </div>
  );

  if (!info) return (
    <div className="vp2-loading"><div className="vp2-loading-text">Tournament not found.</div></div>
  );

  const rounds       = buildRounds(matchMap);
  const allMatches   = Object.values(matchMap);
  const totalMatches = allMatches.length;
  const doneMatches  = allMatches.filter(m=>m.winner).length;
  const liveMatches  = allMatches.filter(m=>!m.winner&&(m.sets||[]).length>0);
  const progressPct  = totalMatches>0 ? Math.round((doneMatches/totalMatches)*100) : 0;
  const sizeClass    = getSizeClass(totalMatches);
  const timeStr      = new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});

  const courtGrid = buildCourtGrid(allMatches);
  const focusedMatch = focusedMatchId
    ? allMatches.find(m => m.matchId === focusedMatchId)
    : null;
  const focusedSlot = focusedMatch
    ? Number(Object.entries(courtGrid).find(([, m]) => m?.matchId === focusedMatchId)?.[0]) || 1
    : null;

  if (focusedMatch) {
    return (
      <div className="vp2-page led-page led-page-focus">
        <div className="led-focus-view">
          <button type="button" className="led-focus-close" onClick={closeFocus} aria-label="Close">
            ✕ Close
          </button>
          <LEDCourtCard
            courtNum={focusedSlot || 1}
            match={focusedMatch}
            format={info?.format}
            isFlashing={flashId === focusedMatch.matchId}
            zoomed
          />
        </div>
      </div>
    );
  }

  return (
    <div className="vp2-page led-page">
      <div className="led-dashboard">
        <div className="led-grid">
          {[1, 2, 3, 4, 5, 6].map((courtNum) => {
            const match = courtGrid[courtNum] || null;
            return (
              <LEDCourtCard
                key={courtNum}
                courtNum={courtNum}
                match={match}
                format={info?.format}
                isFlashing={match && flashId === match.matchId}
                onSelect={match ? () => openFocus(match.matchId) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LEDCourtCard({ courtNum, match, format, isFlashing, onSelect, zoomed = false }) {
  const courtLabel = match ? getCourtLabel(match, courtNum) : String(courtNum);
  const hasAssignedCourt = !!(match?.courtNumber);

  if (!match) {
    return (
      <div className={`led-card led-empty ${zoomed ? "led-card-zoomed" : ""}`}>
        <div className="led-card-topbar">
          <span className="led-court-label">COURT {courtNum}</span>
        </div>
        <div className="led-card-center led-card-center-empty">
          <span className="led-empty-text">NO MATCH</span>
        </div>
      </div>
    );
  }

  const { teamA, teamB, sets = [], winner } = match;
  const isPending = !teamA || !teamB;
  const isFinished = !!winner;
  const isLive = !isPending && !isFinished;

  function initials(n) {
    if (!n) return "?";
    return n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }

  const currentSet = sets.length > 0 ? sets[sets.length - 1] : null;
  const displayScoreA = isLive
    ? (match.scoreA !== undefined ? match.scoreA : (currentSet?.scoreA ?? 0))
    : (isFinished && sets.length > 0 ? sets[sets.length - 1].scoreA : 0);
  const displayScoreB = isLive
    ? (match.scoreB !== undefined ? match.scoreB : (currentSet?.scoreB ?? 0))
    : (isFinished && sets.length > 0 ? sets[sets.length - 1].scoreB : 0);

  const winsA = sets.filter(s => s.winner === "A").length;
  const winsB = sets.filter(s => s.winner === "B").length;

  return (
    <div
      className={`led-card ${isFlashing ? "led-flash" : ""} ${isFinished ? "led-done" : ""} ${zoomed ? "led-card-zoomed" : ""} ${onSelect ? "led-card-clickable" : ""}`}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } } : undefined}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className="led-card-topbar">
        <span className="led-court-label">
          COURT {courtLabel}
          {hasAssignedCourt && <span className="led-court-assigned"> ●</span>}
        </span>
      </div>

      <div className="led-card-center">
        <div className="led-team-col">
          <div className="led-team-badge led-badge-a">{initials(teamA)}</div>
          <div className="led-team-name">{teamA || "TBD"}</div>
        </div>

        <div className="led-score-col">
          <div className="led-main-score">
            <span className="led-score-num led-score-a">{displayScoreA}</span>
            <span className="led-score-sep">-</span>
            <span className="led-score-num led-score-b">{displayScoreB}</span>
          </div>
          {format !== "bo1" && (
            <div className="led-set-score">
              {winsA} <span className="led-set-label">SET</span> {winsB}
            </div>
          )}
        </div>

        <div className="led-team-col">
          <div className="led-team-badge led-badge-b">{initials(teamB)}</div>
          <div className="led-team-name">{teamB || "TBD"}</div>
        </div>
      </div>

      <div className="led-card-bottom">
        {onSelect && (
          <span className="led-tap-hint"></span>
        )}
      </div>
    </div>
  );
}

