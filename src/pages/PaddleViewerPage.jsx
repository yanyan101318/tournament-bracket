import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { doc, onSnapshot, collection, query, where } from "firebase/firestore";
import { db } from "../firebase";
import RanawLogo from "../components/RanawLogo";

const MATCH_SLOT_COUNT = 4;

const neonColors = [
  { color: "#F5DEB3", glow: "rgba(245, 222, 179, 0.5)", bgOuter: "rgba(245, 222, 179, 0.1)", bgInner: "rgba(245, 222, 179, 0.2)" },
  { color: "#FF1493", glow: "rgba(255, 20, 147, 0.5)", bgOuter: "rgba(255, 20, 147, 0.1)", bgInner: "rgba(255, 20, 147, 0.2)" },
  { color: "#00FFFF", glow: "rgba(0, 255, 255, 0.5)", bgOuter: "rgba(0, 255, 255, 0.1)", bgInner: "rgba(0, 255, 255, 0.2)" },
  { color: "#39FF14", glow: "rgba(57, 255, 20, 0.5)", bgOuter: "rgba(57, 255, 20, 0.1)", bgInner: "rgba(57, 255, 20, 0.2)" },
];

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
    teamA = slots.slice(0, 1).map((s) => s.name || "Player 1");
    teamB = slots.slice(1, 2).map((s) => s.name || "Player 2");
  } else {
    teamA = slots.slice(0, 2).map((s) => s.name || "Player");
    teamB = slots.slice(2, 4).map((s) => s.name || "Player");
  }

  return {
    p1: teamA[0] || "TBD",
    p2: teamA[1] || "",
    p3: teamB[0] || "TBD",
    p4: teamB[1] || "",
  };
}

function sortOngoingCourts(courts) {
  return [...courts].sort((a, b) => {
    const ta = a.startedAt?.toMillis?.() ?? a.startedAt?.seconds * 1000 ?? 0;
    const tb = b.startedAt?.toMillis?.() ?? b.startedAt?.seconds * 1000 ?? 0;
    return ta - tb;
  });
}

function sortLeaderboardRows(rows) {
  return [...rows].sort((a, b) => {
    const wDiff = (b.wins ?? 0) - (a.wins ?? 0);
    if (wDiff !== 0) return wDiff;
    const dDiff = (b.pointDiff ?? 0) - (a.pointDiff ?? 0);
    if (dDiff !== 0) return dDiff;
    return (a.playerName || "").localeCompare(b.playerName || "", undefined, { sensitivity: "base" });
  });
}

function EmptyMatchSlot() {
  return (
    <div className="rounded-3xl border-2 border-slate-800 bg-slate-900/40 flex flex-col items-center justify-center h-full min-h-0 shadow-inner">
      <div className="text-slate-600 font-black text-3xl xl:text-4xl text-center uppercase tracking-widest leading-tight">
        NO MATCH
      </div>
    </div>
  );
}

function ActiveMatchSlot({ court, theme }) {
  const { p1, p2, p3, p4 } = parseTeams(court);
  const scoreA = court.scoreA ?? 0;
  const scoreB = court.scoreB ?? 0;

  return (
    <div
      className="rounded-3xl border-2 flex flex-col overflow-hidden relative shadow-2xl h-full min-h-0"
      style={{ backgroundColor: theme.bgOuter, borderColor: theme.color, boxShadow: `0 0 20px ${theme.glow}` }}
    >
      <div
        className="py-2 xl:py-3 text-center border-b-2 flex flex-col justify-center items-center gap-1.5"
        style={{ backgroundColor: theme.bgInner, borderColor: theme.color }}
      >
        {court.name && (
          <div className="text-base xl:text-lg font-black text-white uppercase tracking-widest drop-shadow-md" style={{ color: theme.color }}>
            {court.name}
          </div>
        )}
        <div className="text-xs xl:text-sm font-bold text-white uppercase tracking-widest bg-black/50 px-4 py-1 rounded-full border border-white/20">
          {court.gameType === "singles" ? "SINGLES" : "DOUBLES"} • LIVE
        </div>
      </div>

      <div className="flex-1 flex flex-col py-2 xl:py-4 justify-center min-h-0">
        <div className="flex-1 flex items-center justify-between px-3 xl:px-4 min-h-0">
          <div className="flex flex-col items-center justify-center text-center w-[35%] min-w-0">
            <div className="font-bold leading-tight uppercase text-white break-words drop-shadow-lg flex flex-col items-center justify-center text-xl xl:text-2xl 2xl:text-3xl">
              <span className="truncate max-w-full">{p1}</span>
              {p2 && (
                <span className="font-black text-lg xl:text-xl my-0.5" style={{ color: theme.color }}>
                  &
                </span>
              )}
              {p2 && <span className="truncate max-w-full">{p2}</span>}
            </div>
            <div
              className="mt-2 xl:mt-3 font-black text-4xl xl:text-5xl tabular-nums"
              style={{ color: theme.color, filter: `drop-shadow(0 0 8px ${theme.glow})` }}
            >
              {scoreA}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center shrink-0 w-[30%]">
            <div
              className="font-black text-5xl xl:text-6xl 2xl:text-[5rem] leading-none italic"
              style={{ color: theme.color, filter: `drop-shadow(0 0 10px ${theme.glow})` }}
            >
              VS
            </div>
          </div>

          <div className="flex flex-col items-center justify-center text-center w-[35%] min-w-0">
            <div className="font-bold leading-tight uppercase text-white break-words drop-shadow-lg flex flex-col items-center justify-center text-xl xl:text-2xl 2xl:text-3xl">
              <span className="truncate max-w-full">{p3}</span>
              {p4 && (
                <span className="font-black text-lg xl:text-xl my-0.5" style={{ color: theme.color }}>
                  &
                </span>
              )}
              {p4 && <span className="truncate max-w-full">{p4}</span>}
            </div>
            <div
              className="mt-2 xl:mt-3 font-black text-4xl xl:text-5xl tabular-nums"
              style={{ color: theme.color, filter: `drop-shadow(0 0 8px ${theme.glow})` }}
            >
              {scoreB}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderboardSidebar({ rows }) {
  return (
    <div className="w-[30%] min-w-[240px] border-r border-slate-800 flex flex-col bg-black/40 shrink-0">
      <div className="p-6 border-b border-slate-800 bg-[#CCFF00]/10">
        <h2
          className="text-[#CCFF00] font-black text-4xl tracking-widest uppercase m-0 text-center"
          style={{ filter: "drop-shadow(0 0 10px rgba(204,255,0,0.3))" }}
        >
          Leaderboard
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-black/90 z-10">
            <tr className="border-b border-slate-700">
              <th className="px-4 py-3 text-slate-400 font-black text-xs uppercase tracking-widest w-12 text-center">
                #
              </th>
              <th className="px-3 py-3 text-slate-400 font-black text-xs uppercase tracking-widest">Player</th>
              <th className="px-2 py-3 text-slate-400 font-black text-xs uppercase tracking-widest w-10 text-center">
                W
              </th>
              <th className="px-2 py-3 text-slate-400 font-black text-xs uppercase tracking-widest w-10 text-center">
                L
              </th>
              <th className="px-3 py-3 text-slate-400 font-black text-xs uppercase tracking-widest w-14 text-center">
                Diff
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-black text-lg uppercase tracking-widest">
                  No stats yet
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.id} className="border-b border-slate-800/80">
                  <td className="px-4 py-3 text-center font-mono text-slate-500 text-lg">{idx + 1}</td>
                  <td className="px-3 py-3 font-bold text-white text-lg uppercase tracking-wide truncate max-w-[120px]">
                    {row.playerName}
                  </td>
                  <td className="px-2 py-3 text-center font-black text-lg text-[#39FF14]">{row.wins ?? 0}</td>
                  <td className="px-2 py-3 text-center font-black text-lg text-[#FF3131]">{row.losses ?? 0}</td>
                  <td
                    className={`px-3 py-3 text-center font-black text-lg ${
                      (row.pointDiff ?? 0) > 0
                        ? "text-[#39FF14]"
                        : (row.pointDiff ?? 0) < 0
                          ? "text-[#FF3131]"
                          : "text-slate-400"
                    }`}
                  >
                    {(row.pointDiff ?? 0) > 0 ? "+" : ""}
                    {row.pointDiff ?? 0}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueModal({ queue, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border-2 border-[#CCFF00]/40 bg-[#0a0f18] shadow-[0_0_40px_rgba(204,255,0,0.15)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#CCFF00]/10">
          <h2
            className="text-[#CCFF00] font-black text-3xl xl:text-4xl tracking-widest uppercase m-0"
            style={{ filter: "drop-shadow(0 0 10px rgba(204,255,0,0.3))" }}
          >
            Up Next Queue
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-3xl font-bold leading-none px-2"
            aria-label="Close queue"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {queue.length === 0 ? (
            <div className="text-slate-500 font-black text-3xl text-center uppercase tracking-widest py-12">
              Empty
            </div>
          ) : (
            queue.slice(0, 15).map((q, i) => (
              <div
                key={q.id}
                className="flex items-center p-4 bg-slate-900 border border-slate-800 rounded-2xl shadow-lg relative overflow-hidden"
              >
                {i === 0 && (
                  <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#CCFF00] shadow-[0_0_10px_#CCFF00]" />
                )}
                {i > 0 && <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-700" />}
                <div className="w-16 text-center text-slate-500 font-black text-4xl ml-2">{i + 1}</div>
                <div className="flex-1 ml-4 min-w-0">
                  <div className="text-white font-bold text-3xl uppercase tracking-wide truncate">
                    {q.kind === "group" ? (q.members || []).join(" & ") : q.name}
                  </div>
                  {q.category && q.skillLevel && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <span className="text-[#CCFF00] bg-[#CCFF00]/10 px-3 py-1 rounded text-sm font-bold uppercase tracking-wider border border-[#CCFF00]/30">
                        {q.category}
                      </span>
                      <span className="text-[#00FFFF] bg-[#00FFFF]/10 px-3 py-1 rounded text-sm font-bold uppercase tracking-wider border border-[#00FFFF]/30">
                        {q.skillLevel}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {queue.length > 15 && (
            <div className="text-slate-400 font-black text-2xl text-center uppercase tracking-widest mt-4">
              + {queue.length - 15} MORE WAITING...
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-lg font-black uppercase tracking-widest text-sm border-2 border-[#CCFF00]/50 text-[#CCFF00] hover:bg-[#CCFF00]/10 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaddleViewerPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const stateDocId = sessionId || "state";

  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => {
    const stateDoc = doc(db, "paddleStack", stateDocId);
    const unsub = onSnapshot(stateDoc, (snap) => {
      if (snap.exists()) {
        setState({ id: snap.id, ...snap.data() });
      } else {
        setState(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [stateDocId]);

  useEffect(() => {
    const statsQ = query(collection(db, "paddlePlayerStats"), where("sessionId", "==", stateDocId));
    const unsub = onSnapshot(
      statsQ,
      (snap) => {
        setLeaderboardRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Paddle viewer — player stats snapshot:", err);
        setLeaderboardRows([]);
      }
    );
    return () => unsub();
  }, [stateDocId]);

  const sortedLeaderboard = useMemo(() => sortLeaderboardRows(leaderboardRows), [leaderboardRows]);

  const matchSlots = useMemo(() => {
    const ongoing = sortOngoingCourts((state?.courts || []).filter((c) => c.status === "ongoing"));
    return Array.from({ length: MATCH_SLOT_COUNT }, (_, i) => ongoing[i] || null);
  }, [state?.courts]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col gap-4 items-center justify-center text-white text-2xl font-black tracking-widest uppercase">
        <PickleballSVG size={72} />
        Loading LED Wall...
      </div>
    );
  }

  const queue = state?.queue || [];

  return (
    <div className="h-screen bg-black text-white flex flex-col font-sans overflow-hidden">
      <div className="bg-[#0a0f18] border-b border-slate-800 p-3 flex items-center shrink-0 gap-4">
        <RanawLogo variant="nav" />
        <h1 className="text-[#CCFF00] font-black text-4xl tracking-widest uppercase m-0 leading-none">
          PADDLE STACK
        </h1>
        <div className="text-slate-400 font-bold tracking-widest uppercase text-xl hidden sm:block">
          Live Matches
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setShowQueue(true)}
            className="px-5 py-2 rounded-lg font-black uppercase tracking-widest text-sm border-2 border-[#CCFF00] text-[#CCFF00] bg-[#CCFF00]/10 hover:bg-[#CCFF00]/20 shadow-[0_0_15px_rgba(204,255,0,0.25)] transition-all"
          >
            Up Next Queue
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-row overflow-hidden bg-[#0a0f18] min-h-0">
        <LeaderboardSidebar rows={sortedLeaderboard} />

        <div className="flex-1 p-4 min-h-0 min-w-0">
          <div className="grid grid-cols-2 grid-rows-2 gap-4 h-full">
            {matchSlots.map((court, index) =>
              court ? (
                <ActiveMatchSlot key={court.id} court={court} theme={neonColors[index % neonColors.length]} />
              ) : (
                <EmptyMatchSlot key={`empty-${index}`} />
              )
            )}
          </div>
        </div>
      </div>

      {showQueue && <QueueModal queue={queue} onClose={() => setShowQueue(false)} />}
    </div>
  );
}
