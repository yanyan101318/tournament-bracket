// src/admin/PaddleStackingPage.jsx — admin-only paddle queue & court rotation
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  writeBatch,
  increment,
} from "firebase/firestore";
import { db } from "../firebase";
import { useOfflineSync } from "../hooks/useOfflineSync";
import toast from "react-hot-toast";
import { format, parse, isValid } from "date-fns";
import { getEffectiveCourtStatus } from "../lib/bookingSlots";


/** Firestore rejects `undefined` anywhere in the payload — strip it recursively. */
function omitUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return value;
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map((x) => omitUndefinedDeep(x));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    const next = omitUndefinedDeep(v);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

function courtClearedForAvailable(c) {
  const { assignSource, randomFilter, ...rest } = c;
  return {
    ...rest,
    status: "available",
    gameType: null,
    playerSlots: [],
    startedAt: null,
  };
}

const STACK_MODES = [
  { id: "mix", label: "Mix" },
  { id: "random", label: "Random" },
  { id: "group", label: "Group" },
];

const CATEGORY_OPTIONS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "genderless", label: "Genderless" },
];

/** Normalize stored category (legacy `boys` / `girls` from older sessions). */
function normalizeCategory(cat) {
  if (cat == null || cat === "") return null;
  if (cat === "boys") return "male";
  if (cat === "girls") return "female";
  return cat;
}

function normalizeSkillLevel(skill) {
  return skill == null || skill === "" ? null : skill;
}

/** Both category and skill set → categorized; otherwise (including partial) → mix-style row. */
function isCategorizedPlayer(e) {
  if (isGroupEntry(e)) return false;
  const c = normalizeCategory(e?.category);
  const s = normalizeSkillLevel(e?.skillLevel);
  return c != null && s != null;
}



const SKILL_OPTIONS = [
  { id: "intermediate", label: "Intermediate" },
  { id: "novice", label: "Novice" },
  { id: "beginner", label: "Beginner" },
];

/** Slot stored on court + in match history; includes category/skill when present. */
function playerSlotFromQueueEntry(t) {
  if (isGroupEntry(t)) {
    const members = t.members || [];
    return {
      queueEntryId: t.id,
      name: formatQueueEntryLabel(t),
      members: [...members],
    };
  }
  const slot = {
    queueEntryId: t.id,
    name: t.name,
  };
  const c = normalizeCategory(t.category);
  const s = normalizeSkillLevel(t.skillLevel);
  if (c != null) slot.category = c;
  if (s != null) slot.skillLevel = s;
  if (t.kind === "individual") slot.kind = "individual";
  return slot;
}

function playerSlotSummaryLines(p) {
  if (p.members?.length) {
    return { title: `Group: ${p.members.join(", ")}`, detail: null };
  }
  const cat = CATEGORY_OPTIONS.find((o) => o.id === normalizeCategory(p.category))?.label;
  const sk = SKILL_OPTIONS.find((o) => o.id === p.skillLevel)?.label;
  const detail = [cat, sk].filter(Boolean).join(" · ");
  return { title: p.name || "—", detail: detail || null };
}

function newId() {
  return crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
}

function normName(s) {
  return (s || "").trim().toLowerCase();
}

function isGroupEntry(e) {
  return e?.kind === "group";
}

/** All individual names currently in the queue (individual rows + group members) for duplicate checks */
function allQueuedNormNames(queueArr) {
  const set = new Set();
  for (const e of queueArr || []) {
    if (isGroupEntry(e)) {
      for (const n of e.members || []) {
        const t = normName(n);
        if (t) set.add(t);
      }
    } else if (e?.name) {
      set.add(normName(e.name));
    }
  }
  return set;
}

function formatQueueEntryLabel(e) {
  if (!e) return "—";
  if (isGroupEntry(e)) {
    const m = (e.members || []).filter(Boolean);
    return m.length ? `Group · ${m.join(" · ")}` : "Group";
  }
  let label = e.name || "—";
  if (e.hasPaid === true) label += " ✓";
  else if (e.hasPaid === false) label += " ✗";
  return label;
}

function entrySearchText(e) {
  if (isGroupEntry(e)) return (e.members || []).join(" ");
  return e?.name || "";
}

/** Split court slots into Team 1 / Team 2 player names (handles singles, doubles, groups). */
function teamsFromCourt(court) {
  const slots = court?.playerSlots || [];
  if (slots.length === 1 && slots[0].members?.length) {
    const m = slots[0].members;
    return {
      teamA: [m[0], m[1]].filter(Boolean),
      teamB: [m[2], m[3]].filter(Boolean),
    };
  }
  if (court?.gameType === "singles") {
    return {
      teamA: slots.slice(0, 1).map((s) => s.name).filter(Boolean),
      teamB: slots.slice(1, 2).map((s) => s.name).filter(Boolean),
    };
  }
  return {
    teamA: slots.slice(0, 2).map((s) => s.name).filter(Boolean),
    teamB: slots.slice(2, 4).map((s) => s.name).filter(Boolean),
  };
}

function teamDisplayLabel(names) {
  return names.length ? names.join(" & ") : "Team";
}

function playerStatsDocId(sessionId, playerName) {
  return `${sessionId}__${(playerName || "").trim().toUpperCase()}`;
}

/**
 * Singles: pair by category+skill if top is categorized; else pair two mix players (FIFO, skip groups & wrong type).
 * Doubles: group at top → one unit; else categorized top → 4 same cat+skill; else mix top → 4 mix players (scanning down).
 */
function peekNextAssignment(queueArr, assignMode) {
  const q = queueArr || [];
  if (!q.length) return { ok: false, reason: "empty", units: [], playerSlots: [] };

  const head = q[0];
  if (isGroupEntry(head)) {
    if (assignMode === "singles") {
      return { ok: false, reason: "group_blocks_singles", units: [], playerSlots: [] };
    }
    const playerSlots = [playerSlotFromQueueEntry(head)];
    return { ok: true, reason: null, units: [head], playerSlots };
  }

  const target = assignMode === "singles" ? 2 : 4;
  const units = [];
  for (let j = 0; j < q.length && units.length < target; j++) {
    const e = q[j];
    if (isGroupEntry(e)) continue; // skip group to find individuals
    units.push(e);
  }
  if (units.length < target) {
    return { ok: false, reason: "not_enough_players", units: [], playerSlots: [] };
  }
  const playerSlots = units.map((t) => playerSlotFromQueueEntry(t));
  return { ok: true, reason: null, units, playerSlots };
}

function nextSuggestionLabels(queueArr, assignMode) {
  const peek = peekNextAssignment(queueArr, assignMode);
  if (!peek.ok) {
    if (peek.reason === "group_blocks_singles") return ["(Group next — use Doubles or move group)"];
    if (peek.reason === "not_enough_players") return ["(Not enough players to form match)"];
    return ["(Cannot form match)"];
  }
  return peek.playerSlots.map((p) =>
    p.members && p.members.length ? `Group: ${p.members.join(" · ")}` : p.name || "—"
  );
}

/** Parse booking date + timeSlot + duration into [start, end) in local time. */
function parseBookingTimeRange(booking) {
  const dateStr = booking?.date;
  const slot = booking?.timeSlot;
  if (!dateStr || !slot || typeof slot !== "string") return null;
  const durationH = Number(booking.duration);
  const durHours = Number.isFinite(durationH) && durationH > 0 ? durationH : 1;
  const combined = `${String(dateStr).trim()} ${slot.trim()}`;
  let start = parse(combined, "yyyy-MM-dd hh:mm a", new Date());
  if (!isValid(start)) {
    start = parse(combined, "yyyy-MM-dd h:mm a", new Date());
  }
  if (!isValid(start)) return null;
  const end = new Date(start.getTime() + durHours * 60 * 60 * 1000);
  return { start, end };
}

function bookingOverlapsNow(booking, now) {
  if (booking?.status !== "Approved") return false;
  const range = parseBookingTimeRange(booking);
  if (!range) return false;
  return now >= range.start && now < range.end;
}

/** Facility court IDs with an approved booking that covers `now` */
function blockedFacilityIdsFromBookings(bookings, now, facilityCourts) {
  const ids = new Set();
  const nameToId = new Map(
    (facilityCourts || []).map((fc) => [normName(fc.name || ""), fc.id])
  );
  for (const b of bookings || []) {
    if (!bookingOverlapsNow(b, now)) continue;
    if (b.courtId && facilityCourts.some((fc) => fc.id === b.courtId)) {
      ids.add(b.courtId);
      continue;
    }
    const id = nameToId.get(normName(b.courtName || ""));
    if (id) ids.add(id);
  }
  return ids;
}

function mergePaddleCourtsFromFacility(facilityCourts, bookings, now, existingCourts, allowedCourtIds) {
  const sorted = [...(facilityCourts || [])].sort((a, b) =>
    (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
  );
  const blocked = blockedFacilityIdsFromBookings(bookings, now, sorted);
  const prevByFc = new Map(
    (existingCourts || []).filter((c) => c.facilityCourtId).map((c) => [c.facilityCourtId, c])
  );
  const next = [];

  for (const fc of sorted) {
    if (!fc.id) continue;
    if (allowedCourtIds && !allowedCourtIds.has(fc.id)) continue;
    
    const prev = prevByFc.get(fc.id);
    const paddleEligible = getEffectiveCourtStatus(fc) === false;

    if (paddleEligible) {
      if (prev) {
        next.push({
          ...prev,
          name: (fc.name || prev.name || "Court").trim(),
          facilityCourtId: fc.id,
        });
      } else {
        next.push({
          id: newId(),
          name: (fc.name || "Court").trim(),
          facilityCourtId: fc.id,
          status: "available",
          gameType: null,
          playerSlots: [],
          startedAt: null,
        });
      }
    } else if (prev?.status === "ongoing") {
      next.push({
        ...prev,
        name: (fc.name || prev.name || "Court").trim(),
        facilityCourtId: fc.id,
      });
    }
  }

  for (const c of existingCourts || []) {
    if (!c.facilityCourtId && c.status === "ongoing") {
      next.push(c);
    }
  }

  return next;
}

function sortCourtsForCompare(list) {
  return [...(list || [])].sort((a, b) => {
    const ka = a.facilityCourtId ? `fc:${a.facilityCourtId}` : `id:${a.id}`;
    const kb = b.facilityCourtId ? `fc:${b.facilityCourtId}` : `id:${b.id}`;
    return ka.localeCompare(kb);
  });
}

function courtsSyncDifferent(a, b) {
  const sa = sortCourtsForCompare(a);
  const sb = sortCourtsForCompare(b);
  if (sa.length !== sb.length) return true;
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].id !== sb[i].id) return true;
    if (sa[i].facilityCourtId !== sb[i].facilityCourtId) return true;
    if (sa[i].status !== sb[i].status) return true;
    if ((sa[i].name || "") !== (sb[i].name || "")) return true;
    const pa = sa[i].playerSlots || [];
    const pb = sb[i].playerSlots || [];
    if (pa.length !== pb.length) return true;
  }
  return false;
}


export default function PaddleStackingPage() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [facilityCourts, setFacilityCourts] = useState([]);
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const stateDocId = sessionId || "state";
  
  const courtIdsParam = searchParams.get("courtIds") || searchParams.get("courtId") || "";
  const allowedCourtIds = useMemo(() => {
    return courtIdsParam ? new Set(courtIdsParam.split(",")) : null;
  }, [courtIdsParam]);
  
  const initialAssignCourtId = allowedCourtIds ? Array.from(allowedCourtIds)[0] : "";
  const [assignCourtId, setAssignCourtId] = useState(initialAssignCourtId || "");
  
  const [addPlayerName, setAddPlayerName] = useState("");
  const [addPlayerSkill, setAddPlayerSkill] = useState("");
  const [addPlayerGender, setAddPlayerGender] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [bookings, setBookings] = useState([]);
  const [bookingsReady, setBookingsReady] = useState(false);
  const [facilityCourtsReady, setFacilityCourtsReady] = useState(false);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [assignMode, setAssignMode] = useState(searchParams.get("assignMode") || "doubles");
  const [groupNames, setGroupNames] = useState(["", "", "", ""]);
  
  const [finishingMatchId, setFinishingMatchId] = useState(null);
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [leaderboardSort, setLeaderboardSort] = useState({ key: "wins", dir: "desc" });

  const { wrapSync } = useOfflineSync();

  useEffect(() => {
    const cq = query(collection(db, "courts"), orderBy("createdAt", "desc"));
    const unsubC = onSnapshot(
      cq,
      (snap) => {
        setFacilityCourts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFacilityCourtsReady(true);
      },
      (err) => {
        console.error("Paddle stacking — courts snapshot:", err);
        setFacilityCourts([]);
        setFacilityCourtsReady(true);
      }
    );
    return () => unsubC();
  }, []);

  useEffect(() => {
    const bq = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
    const unsubB = onSnapshot(
      bq,
      (snap) => {
        setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setBookingsReady(true);
      },
      (err) => {
        console.error("Paddle stacking — bookings snapshot:", err);
        setBookings([]);
        setBookingsReady(true);
      }
    );
    return () => unsubB();
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setTickNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let mounted = true;
    const STATE_DOC = doc(db, "paddleStack", stateDocId);
    (async () => {
      const snap = await getDoc(STATE_DOC);
      if (!snap.exists() && mounted) {
        await setDoc(STATE_DOC, {
          queue: [],
          courts: [],
          sessionNote: "",
          stackMode: "mix",
          updatedAt: serverTimestamp(),
        });
      }
    })();
    const unsub = onSnapshot(STATE_DOC, (snap) => {
      if (snap.exists()) setState({ id: snap.id, ...snap.data() });
      else setState(null);
      setLoading(false);
    });
    const hq = query(collection(db, "paddleMatchHistory"), orderBy("endedAt", "desc"), limit(80));
    const unsubH = onSnapshot(hq, (snap) => {
      setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      mounted = false;
      unsub();
      unsubH();
    };
  }, [stateDocId]);

  useEffect(() => {
    const statsQ = query(
      collection(db, "paddlePlayerStats"),
      where("sessionId", "==", stateDocId)
    );
    const unsub = onSnapshot(
      statsQ,
      (snap) => {
        setLeaderboardRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Paddle stacking — player stats snapshot:", err);
        setLeaderboardRows([]);
      }
    );
    return () => unsub();
  }, [stateDocId]);

  const queue = useMemo(() => state?.queue || [], [state]);
  const courts = useMemo(() => state?.courts || [], [state]);
  const stackMode = state?.stackMode || "mix";

  const mergedCourts = useMemo(
    () => mergePaddleCourtsFromFacility(facilityCourts, bookings, new Date(tickNow), courts, allowedCourtIds),
    [facilityCourts, bookings, tickNow, courts, allowedCourtIds]
  );

  const nowForBookings = useMemo(() => new Date(tickNow), [tickNow]);
  const openFacilityCourts = useMemo(() => {
    const blocked = blockedFacilityIdsFromBookings(bookings, nowForBookings, facilityCourts);
    return [...(facilityCourts || [])]
      .filter((fc) => {
        if (getEffectiveCourtStatus(fc) !== false) return false;
        if (blocked.has(fc.id)) return false;
        if (allowedCourtIds && !allowedCourtIds.has(fc.id)) return false;
        return true;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
  }, [facilityCourts, bookings, nowForBookings, allowedCourtIds]);

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((e) => entrySearchText(e).toLowerCase().includes(q));
  }, [queue, queueSearch]);

  const nextSuggestion = useMemo(
    () => nextSuggestionLabels(queue, assignMode),
    [queue, assignMode]
  );

  const nextFifoUnitIds = useMemo(() => {
    const peek = peekNextAssignment(queue, assignMode);
    return peek.ok ? new Set(peek.units.map((u) => u.id)) : new Set();
  }, [queue, assignMode]);

  const sortedLeaderboard = useMemo(() => {
    const rows = [...leaderboardRows];
    const dir = leaderboardSort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (leaderboardSort.key === "playerName") {
        return dir * (a.playerName || "").localeCompare(b.playerName || "", undefined, { sensitivity: "base" });
      }
      const av = Number(a[leaderboardSort.key]) || 0;
      const bv = Number(b[leaderboardSort.key]) || 0;
      if (av !== bv) return dir * (av - bv);
      return (a.playerName || "").localeCompare(b.playerName || "", undefined, { sensitivity: "base" });
    });
    return rows;
  }, [leaderboardRows, leaderboardSort]);

  const finishingCourt = useMemo(
    () => (finishingMatchId ? courts.find((c) => c.id === finishingMatchId) : null),
    [finishingMatchId, courts]
  );

  const finishingTeams = useMemo(
    () => (finishingCourt ? teamsFromCourt(finishingCourt) : { teamA: [], teamB: [] }),
    [finishingCourt]
  );

  function toggleLeaderboardSort(key) {
    setLeaderboardSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "playerName" ? "asc" : "desc" }
    );
  }

  function leaderboardSortIndicator(key) {
    if (leaderboardSort.key !== key) return "";
    return leaderboardSort.dir === "desc" ? " ↓" : " ↑";
  }

  const persistState = useCallback(async (partial) => {
    const STATE_DOC = doc(db, "paddleStack", stateDocId);
    const cleaned = omitUndefinedDeep(partial);
    await updateDoc(STATE_DOC, { ...cleaned, updatedAt: serverTimestamp() });
  }, [stateDocId]);

  useEffect(() => {
    if (loading || !state || !facilityCourtsReady || !bookingsReady) return;
    if (!courtsSyncDifferent(mergedCourts, courts)) return;
    persistState({ courts: mergedCourts });
  }, [loading, state, facilityCourtsReady, bookingsReady, mergedCourts, courts, persistState]);

  async function setStackMode(mode) {
    await persistState({ stackMode: mode });
  }

  async function addPlayer(e) {
    e.preventDefault();
    const name = addPlayerName.trim();
    if (!name || !addPlayerSkill || !addPlayerGender) {
      toast.error("Please fill all fields");
      return;
    }
    const namesSet = allQueuedNormNames(queue);
    if (namesSet.has(normName(name))) {
      toast.error("That name is already in the queue (or in a group)");
      return;
    }
    const entry = {
      id: newId(),
      name,
      addedAt: Timestamp.now(),
      kind: "individual",
      category: addPlayerGender,
      skillLevel: addPlayerSkill,
    };
    await wrapSync(persistState({ queue: [...queue, entry] }), {
      successMsg: "Added to queue",
      offlineMsg: "Player Queued Offline — Will Sync Automatically",
      errorMsg: "Could not add player"
    });
    setAddPlayerName("");
    setAddPlayerSkill("");
    setAddPlayerGender("");
  }

  async function addGroupSubmit(e) {
    e.preventDefault();
    const names = groupNames.map((n) => (n || "").trim()).filter(Boolean);
    if (names.length !== 4) {
      toast.error("Enter exactly four player names");
      return;
    }
    const uniq = new Set(names.map(normName));
    if (uniq.size !== 4) {
      toast.error("All four names must be different");
      return;
    }
    const namesSet = allQueuedNormNames(queue);
    for (const n of names) {
      if (namesSet.has(normName(n))) {
        toast.error(`“${n}” is already in the queue`);
        return;
      }
    }
    const entry = {
      id: newId(),
      kind: "group",
      members: names,
      addedAt: Timestamp.now(),
    };
    await wrapSync(persistState({ queue: [...queue, entry] }), {
      successMsg: "Group added to queue",
      offlineMsg: "Group Queued Offline — Will Sync Automatically",
      errorMsg: "Could not add group"
    });
    setGroupNames(["", "", "", ""]);
  }

  async function removeFromQueue(entryId) {
    await persistState({ queue: queue.filter((x) => x.id !== entryId) });
  }

  async function clearQueue() {
    if (!window.confirm("Clear the entire queue?")) return;
    await persistState({ queue: [] });
    toast.success("Queue cleared");
  }

  async function moveQueue(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= queue.length) return;
    const next = [...queue];
    [next[i], next[j]] = [next[j], next[i]];
    await persistState({ queue: next });
  }

  async function assignMatch() {
    const court = courts.find((x) => x.id === assignCourtId);
    if (!court) {
      toast.error("Select a court");
      return;
    }
    if (court.status !== "available") {
      toast.error("That court is not available");
      return;
    }
    const peek = peekNextAssignment(queue, assignMode);
    if (!peek.ok) {
      if (peek.reason === "group_blocks_singles") {
        toast.error("Next in queue is a fixed group — switch to Doubles or move that entry");
      } else if (peek.reason === "need_matching_singles") {
        toast.error("Not enough players with the same category and skill for singles.");
      } else if (peek.reason === "need_two_mix_singles") {
        toast.error("Need another mix player (no category & skill) later in the queue for singles.");
      } else if (peek.reason === "not_enough_categorized_doubles") {
        toast.error("Not enough players in this category and level (need 4 with the same tags).");
      } else if (peek.reason === "not_enough_mix_doubles") {
        toast.error("Not enough mix players in the queue (need 4 without category & skill).");
      } else {
        toast.error("Queue is empty");
      }
      return;
    }
    const unitIds = new Set(peek.units.map((u) => u.id));
    const rest = queue.filter((e) => !unitIds.has(e.id));
    const nextCourts = courts.map((c) =>
      c.id === court.id
        ? {
            ...c,
            status: "ongoing",
            gameType: assignMode,
            playerSlots: peek.playerSlots,
            startedAt: Timestamp.now(),
            assignSource: "fifo",
            scoreA: 0,
            scoreB: 0,
          }
        : c
    );
    await wrapSync(persistState({ queue: rest, courts: nextCourts }), {
      successMsg: `${assignMode === "singles" ? "Singles" : "Doubles"} started on ${court.name}`,
      offlineMsg: "Match Assignment Saved Offline — Will Sync Automatically",
      errorMsg: "Could not assign match"
    });
  }

  async function submitMatchScore(e) {
    e.preventDefault();
    if (!finishingMatchId) return;
    const court = courts.find((x) => x.id === finishingMatchId);
    if (!court || court.status !== "ongoing") {
      setFinishingMatchId(null);
      return;
    }
    
    const numA = Number(scoreA);
    const numB = Number(scoreB);
    if (isNaN(numA) || isNaN(numB) || numA < 0 || numB < 0) {
      toast.error("Please enter valid scores.");
      return;
    }
    if (numA === numB) {
      toast.error("Scores cannot be tied — enter a final winner.");
      return;
    }

    const { teamA, teamB } = teamsFromCourt(court);
    if (!teamA.length || !teamB.length) {
      toast.error("Could not determine teams for this match.");
      return;
    }

    const endedAt = Timestamp.now();
    const nextCourts = courts.map((c) =>
      c.id === finishingMatchId ? courtClearedForAvailable(c) : c
    );

    const teamAWon = numA > numB;
    const pointDiffA = numA - numB;
    const pointDiffB = numB - numA;

    try {
      const batch = writeBatch(db);
      for (const name of teamA) {
        const ref = doc(db, "paddlePlayerStats", playerStatsDocId(stateDocId, name));
        batch.set(
          ref,
          {
            sessionId: stateDocId,
            playerName: name.trim().toUpperCase(),
            wins: increment(teamAWon ? 1 : 0),
            losses: increment(teamAWon ? 0 : 1),
            pointDiff: increment(pointDiffA),
            lastUpdated: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const name of teamB) {
        const ref = doc(db, "paddlePlayerStats", playerStatsDocId(stateDocId, name));
        batch.set(
          ref,
          {
            sessionId: stateDocId,
            playerName: name.trim().toUpperCase(),
            wins: increment(teamAWon ? 0 : 1),
            losses: increment(teamAWon ? 1 : 0),
            pointDiff: increment(pointDiffB),
            lastUpdated: serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    } catch (err) {
      console.error("Failed to update player stats", err);
      toast.error("Could not update leaderboard stats.");
      return;
    }

    await wrapSync(persistState({ courts: nextCourts }), {
      successMsg: `${court.name} is available again`,
      offlineMsg: "Court Status Saved Offline - Will Sync Automatically",
      errorMsg: "Court freed - history log may have failed"
    });

    try {
      await addDoc(collection(db, "paddleMatchHistory"), {
        courtId: court.id,
        courtName: court.name,
        gameType: court.gameType,
        players: court.playerSlots || [],
        scoreA: numA,
        scoreB: numB,
        startedAt: court.startedAt || endedAt,
        endedAt,
        assignSource: court.assignSource || "fifo",
        randomFilter: court.randomFilter || null,
        sessionId: stateDocId,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to log paddle history", err);
    }

    setFinishingMatchId(null);
    setScoreA("");
    setScoreB("");
  }

  function finishMatch(courtId) {
    setScoreA("");
    setScoreB("");
    setFinishingMatchId(courtId);
  }

  function closeFinishModal() {
    setFinishingMatchId(null);
    setScoreA("");
    setScoreB("");
  }

  async function requeueFromHistory(h) {
    const slots = h.players || [];
    const next = [...queue];
    const namesSet = allQueuedNormNames(next);
    let added = 0;
    for (const p of slots) {
      if (p.members && p.members.length) {
        const blocked = p.members.some((n) => n && namesSet.has(normName(n)));
        if (blocked) continue;
        for (const n of p.members) {
          if (n) namesSet.add(normName(n));
        }
        next.push({
          id: newId(),
          kind: "group",
          members: [...p.members],
          addedAt: Timestamp.now(),
        });
        added++;
        continue;
      }
      const name = p.name;
      if (!name || namesSet.has(normName(name))) continue;
      namesSet.add(normName(name));
      const row = {
        id: newId(),
        name,
        addedAt: Timestamp.now(),
      };
      const c = normalizeCategory(p.category);
      const s = normalizeSkillLevel(p.skillLevel);
      if (c != null && s != null) {
        row.kind = "individual";
        row.category = c;
        row.skillLevel = s;
      } else if (p.kind === "individual") {
        row.kind = "individual";
      }
      next.push(row);
      added++;
    }
    if (!added) {
      toast.error("Those players are already in the queue");
      return;
    }
    await persistState({ queue: next });
    toast.success(`Added ${added} player(s) to the stack`);
  }

  async function resetSession() {
    if (
      !window.confirm(
        "Reset session? This clears the queue, frees all courts, and resets player statistics. Match history is kept."
      )
    )
      return;
    const nextCourts = courts.map((c) => courtClearedForAvailable(c));
    await wrapSync(persistState({ queue: [], courts: nextCourts }), {
      successMsg: "Session reset",
      offlineMsg: "Session Reset Saved Offline - Will Sync Automatically",
      errorMsg: "Could not reset session"
    });
    try {
      if (leaderboardRows.length) {
        const batch = writeBatch(db);
        leaderboardRows.forEach((row) => {
          batch.delete(doc(db, "paddlePlayerStats", row.id));
        });
        await batch.commit();
      }
    } catch (err) {
      console.error("Failed to clear session player stats", err);
    }
  }

  const clearMatchHistory = async () => {
    if (!history || history.length === 0) return;
    if (!window.confirm("Are you sure you want to clear all recorded match history? This cannot be undone.")) return;
    try {
      const batch = writeBatch(db);
      history.forEach((h) => {
        batch.delete(doc(db, "paddleMatchHistory", h.id));
      });
      await batch.commit();
      toast.success("Match history cleared!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to clear match history.");
    }
  };

  useEffect(() => {
    const avail = courts.filter((c) => c.status === "available");
    if (!avail.length) {
      setAssignCourtId("");
      return;
    }
    if (!assignCourtId || !avail.some((c) => c.id === assignCourtId)) {
      if (searchParams.get("courtId") && avail.some(c => c.id === searchParams.get("courtId"))) {
        setAssignCourtId(searchParams.get("courtId"));
      } else {
        setAssignCourtId(avail[0].id);
      }
    }
  }, [courts, assignCourtId]);

  if (loading || !state) {
    return (
      <div className="ad-loading">
        <div className="ad-spinner" />
      </div>
    );
  }

  return (
    <div className="ad-page">
      <div className="ad-page-header flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="ad-page-title">
            Paddle stacking {sessionId && <span className="text-cyan-400 font-medium text-lg ml-2">(Session: {sessionId.substring(0,6)})</span>}
          </h1>
          <p className="ad-page-sub">
            FIFO queue, court assignment (singles / doubles), and match log — admin only, no player portal.
          </p>
          <p className="text-[12px] text-[var(--ad-muted)] mt-2 max-w-2xl">
            Courts are loaded automatically from{" "}
            <Link
              to="/admin/courts"
              className="text-[var(--ad-pickle)] font-semibold hover:underline"
            >
              Court management
            </Link>
            . Only active courts with no approved booking at the current time appear for assignments (updates live).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <a href="/paddle-viewer" target="_blank" rel="noreferrer" className="ad-btn ad-btn-primary ad-btn-sm flex items-center gap-1">
            <span className="text-[10px] uppercase">📺 Viewer</span>
          </a>
          <button
            type="button"
            className="ad-btn ad-btn-outline ad-btn-sm"
            onClick={() => setShowLeaderboard(true)}
          >
            View Leaderboard
          </button>
          <button type="button" className="ad-btn ad-btn-outline ad-btn-sm" onClick={resetSession}>
            Reset session
          </button>
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 space-y-4">
          <form onSubmit={addPlayer} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 mb-4">
            <h4 className="text-sm font-bold text-white mb-3">Add Player</h4>
            <div className="space-y-3">
              <input
                className="af-input"
                placeholder="Player Name"
                value={addPlayerName}
                onChange={(e) => setAddPlayerName(e.target.value)}
                required
              />
              <select
                className="af-input"
                value={addPlayerSkill}
                onChange={(e) => setAddPlayerSkill(e.target.value)}
                required
              >
                <option value="" disabled>Select Skill Level</option>
                <option value="beginner">Beginner</option>
                <option value="novicelow">Novice Low</option>
                <option value="novicehigh">Novice High</option>
                <option value="intermediate">Intermediate</option>
              </select>
              <select
                className="af-input"
                value={addPlayerGender}
                onChange={(e) => setAddPlayerGender(e.target.value)}
                required
              >
                <option value="" disabled>Select Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="genderless">Genderless</option>
              </select>
              <button type="submit" className="ad-btn ad-btn-success w-full text-xs py-2 shadow-lg shadow-emerald-500/20">
                Add to Queue
              </button>
            </div>
          </form>

          <div className="ad-card p-4 transition-all duration-200 flex flex-col min-h-0">
            <h3 className="text-sm font-black text-white uppercase tracking-wide mb-1">Player queue (FIFO)</h3>
            <p className="text-[10px] text-[var(--ad-muted)] mb-3">Search, reorder, or remove entries below.</p>
            <input
              className="af-input mb-3"
              placeholder="Search queue…"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
            />
            {nextSuggestion.length > 0 && (
              <div className="mb-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs">
                <span className="text-cyan-400 font-bold uppercase tracking-wider">
                  Next from queue — {assignMode === "singles" ? "singles (2)" : "doubles (4)"}
                </span>
                <div className="text-white mt-1 font-medium">{nextSuggestion.join(" · ") || "—"}</div>
              </div>
            )}
            <div className="space-y-1 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
              {filteredQueue.length === 0 ? (
                <p className="text-sm text-[var(--ad-muted)] py-6 text-center">Queue empty</p>
              ) : (
                filteredQueue.map((entry, displayIdx) => {
                  const realIdx = queue.findIndex((q) => q.id === entry.id);
                  const isNextFifo = nextFifoUnitIds.has(entry.id) && !queueSearch.trim();
                  const catLabel = CATEGORY_OPTIONS.find(
                    (o) => o.id === normalizeCategory(entry.category)
                  )?.label;
                  const skillLabel = SKILL_OPTIONS.find((o) => o.id === entry.skillLevel)?.label;
                  return (
                    <div
                      key={entry.id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 rounded-lg border px-2 py-2 text-sm ${
                        isNextFifo
                          ? "border-[var(--ad-pickle)]/50 bg-[var(--ad-pickle)]/5"
                          : "border-[var(--ad-border)] bg-[var(--ad-surface)]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[var(--ad-muted)] w-6 text-center font-mono text-xs shrink-0">
                          {realIdx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--ad-text)] truncate">
                            {formatQueueEntryLabel(entry)}
                          </div>
                          {!isGroupEntry(entry) && isCategorizedPlayer(entry) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              <span className="text-[9px] uppercase font-bold px-1.5 py-0 rounded bg-white/5 text-[var(--ad-muted)]">
                                {catLabel}
                              </span>
                              <span className="text-[9px] uppercase font-bold px-1.5 py-0 rounded bg-white/5 text-[var(--ad-muted)]">
                                {skillLabel}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto sm:ml-auto">
                      <span className="text-[10px] text-[var(--ad-muted)] order-2 sm:order-1">
                        {entry.addedAt?.toDate
                          ? format(entry.addedAt.toDate(), "HH:mm")
                          : ""}
                      </span>
                      <div className="flex gap-0.5 order-1 sm:order-2">
                        <button
                          type="button"
                          className="ad-btn ad-btn-sm ad-btn-outline px-1"
                          title="Up"
                          onClick={() => moveQueue(realIdx, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="ad-btn ad-btn-sm ad-btn-outline px-1"
                          title="Down"
                          onClick={() => moveQueue(realIdx, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="ad-btn ad-btn-sm ad-btn-danger px-1"
                          onClick={() => removeFromQueue(entry.id)}
                        >
                          ✕
                        </button>
                      </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <button type="button" className="ad-btn ad-btn-outline w-full mt-3 ad-btn-sm" onClick={clearQueue}>
              Clear entire queue
            </button>
          </div>
        </div>

        {/* Courts + assign */}
        <div className="xl:col-span-2 space-y-4">
          <div className="ad-card p-4">
            <h3 className="text-sm font-black text-white uppercase tracking-wide mb-3">Match Control</h3>
            
            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-700/50">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-bold text-white">Assigned Court:</p>
                  {courts.filter(c => c.status === "available").length > 0 ? (
                    <select
                      className="af-input text-sm py-1 px-2 border-slate-700 bg-slate-800 text-emerald-400 font-bold"
                      value={assignCourtId}
                      onChange={(e) => setAssignCourtId(e.target.value)}
                    >
                      {courts.filter(c => c.status === "available").map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-emerald-400 font-bold text-sm">None</span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Format: <span className="text-white font-semibold">{assignMode === "singles" ? "Singles (2 Players)" : "Doubles (4 Players)"}</span>
                </p>
              </div>
              <button type="button" className="ad-btn ad-btn-primary px-6 py-3 shadow-lg shadow-emerald-500/20" onClick={assignMatch}>
                Start Next Match
              </button>
            </div>
            
            <p className="text-[11px] text-[var(--ad-muted)] mt-4">
              Takes the top {assignMode === "singles" ? 2 : 4} players from the queue in order and moves them to the active court. Groups count as one slot.
            </p>

            {courts.some((c) => c.status === "ongoing") && (
              <div className="mb-4 space-y-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-300">
                  Ongoing matches
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {courts
                    .filter((c) => c.status === "ongoing")
                    .map((c) => (
                      <div
                        key={c.id}
                        className={`rounded-xl border p-4 ${
                          c.assignSource === "random"
                            ? "border-amber-400/40 bg-emerald-500/5 ring-1 ring-amber-500/25"
                            : "border-emerald-500/40 bg-emerald-500/5"
                        }`}
                      >
                        <div className="font-bold text-[var(--ad-text)] mb-1">{c.name}</div>
                        <div className="text-xs text-[var(--ad-muted)] mb-2">
                          {c.gameType === "singles" ? "Singles" : "Doubles"}
                          {c.assignSource === "random" && (
                            <span className="ml-2 text-amber-400 font-semibold">· Prior random draw</span>
                          )}
                          {" · "}
                          Started{" "}
                          {c.startedAt?.toDate ? format(c.startedAt.toDate(), "MMM d, HH:mm") : "—"}
                        </div>
                        <ul className="text-sm space-y-1.5 mb-3">
                          {(c.playerSlots || []).map((p) => {
                            if (p.members?.length) {
                              return (
                                <li key={p.queueEntryId} className="text-[var(--ad-text)]">
                                  <span className="text-[var(--ad-muted)] text-xs font-bold uppercase">
                                    Group
                                  </span>
                                  <div className="pl-1">{p.members.join(" · ")}</div>
                                </li>
                              );
                            }
                            const { title, detail } = playerSlotSummaryLines(p);
                            return (
                              <li key={p.queueEntryId} className="text-[var(--ad-text)]">
                                <div>• {title}</div>
                                {detail && (
                                  <div className="text-[10px] text-[var(--ad-muted)] pl-3">{detail}</div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <button
                          type="button"
                          className="ad-btn ad-btn-success ad-btn-sm w-full"
                          onClick={() => finishMatch(c.id)}
                        >
                          Mark finished
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          <div className="ad-card overflow-hidden">
            <div className="ad-card-header flex justify-between items-center">
              <div>
                <h3 className="ad-card-title">Match history</h3>
                <span className="text-xs text-[var(--ad-muted)]">{history.length} recorded</span>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearMatchHistory}
                  className="ad-btn ad-btn-sm ad-btn-outline ad-btn-danger flex items-center gap-1"
                  title="Clear Match History"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                  Clear History
                </button>
              )}
            </div>
            <div className="overflow-auto max-h-[585px] custom-scrollbar">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Court</th>
                    <th>Format</th>
                    <th>Players</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="ad-empty">
                        No completed games yet.
                      </td>
                    </tr>
                  ) : (
                    history.map((h) => (
                      <tr key={h.id}>
                        <td className="ad-td-main">{h.courtName}</td>
                        <td className="text-sm capitalize">{h.gameType}</td>
                        <td className="text-sm align-top min-w-[200px] max-w-[280px]">
                          <div className="space-y-2">
                            {(h.players || []).map((p, idx) => {
                              const { title, detail } = playerSlotSummaryLines(p);
                              return (
                                <div key={idx}>
                                  <div className="text-[var(--ad-text)]">
                                    {title}
                                    {p.hasPaid === true && <span className="ml-1.5 text-emerald-400" title="Paid">✓</span>}
                                    {p.hasPaid === false && <span className="ml-1.5 text-red-400" title="Unpaid">✗</span>}
                                  </div>
                                  {detail && (
                                    <div className="text-[10px] text-[var(--ad-muted)] leading-snug">
                                      {detail}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          {h.startedAt?.toDate
                            ? format(h.startedAt.toDate(), "MMM d HH:mm")
                            : "—"}
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          {h.endedAt?.toDate
                            ? format(h.endedAt.toDate(), "MMM d HH:mm")
                            : "—"}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="ad-btn ad-btn-sm ad-btn-outline"
                            onClick={() => requeueFromHistory(h)}
                          >
                            Re-queue
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {finishingMatchId && finishingCourt && (
        <div
          className="ad-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && closeFinishModal()}
        >
          <div className="ad-modal">
            <div className="ad-modal-header">
              <h3>Complete match — {finishingCourt.name}</h3>
              <button type="button" className="ad-modal-close" onClick={closeFinishModal}>
                ✕
              </button>
            </div>
            <form className="ad-modal-form" onSubmit={submitMatchScore}>
              <p className="text-sm text-[var(--ad-muted)] -mt-1 mb-4">
                Enter the final score. Stats update for all players and the court clears on submit.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="af-group">
                  <label className="af-label">Team 1 — {teamDisplayLabel(finishingTeams.teamA)}</label>
                  <input
                    className="af-input text-lg font-bold"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={scoreA}
                    onChange={(e) => setScoreA(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="af-group">
                  <label className="af-label">Team 2 — {teamDisplayLabel(finishingTeams.teamB)}</label>
                  <input
                    className="af-input text-lg font-bold"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={scoreB}
                    onChange={(e) => setScoreB(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="ad-modal-footer">
                <button type="button" className="ad-btn ad-btn-outline" onClick={closeFinishModal}>
                  Cancel
                </button>
                <button type="submit" className="ad-btn ad-btn-success">
                  Submit &amp; clear court
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div
          className="ad-modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setShowLeaderboard(false)}
        >
          <div className="ad-modal ad-modal-wide" style={{ maxWidth: "720px", width: "95vw" }}>
            <div className="ad-modal-header">
              <div>
                <h3>Player statistics</h3>
                <p className="text-xs text-[var(--ad-muted)] mt-1 font-normal">
                  Event-only stats for this session{sessionId ? ` (${sessionId.substring(0, 8)}…)` : ""}
                </p>
              </div>
              <button type="button" className="ad-modal-close" onClick={() => setShowLeaderboard(false)}>
                ✕
              </button>
            </div>
            <div className="overflow-auto max-h-[70vh] custom-scrollbar">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th className="w-12">Rank</th>
                    <th>
                      <button
                        type="button"
                        className="font-inherit text-inherit hover:text-[var(--ad-pickle)]"
                        onClick={() => toggleLeaderboardSort("playerName")}
                      >
                        Player{leaderboardSortIndicator("playerName")}
                      </button>
                    </th>
                    <th className="text-center w-16">
                      <button
                        type="button"
                        className="font-inherit text-inherit hover:text-[var(--ad-pickle)]"
                        onClick={() => toggleLeaderboardSort("wins")}
                      >
                        W{leaderboardSortIndicator("wins")}
                      </button>
                    </th>
                    <th className="text-center w-16">
                      <button
                        type="button"
                        className="font-inherit text-inherit hover:text-[var(--ad-pickle)]"
                        onClick={() => toggleLeaderboardSort("losses")}
                      >
                        L{leaderboardSortIndicator("losses")}
                      </button>
                    </th>
                    <th className="text-center w-20">
                      <button
                        type="button"
                        className="font-inherit text-inherit hover:text-[var(--ad-pickle)]"
                        onClick={() => toggleLeaderboardSort("pointDiff")}
                      >
                        Diff{leaderboardSortIndicator("pointDiff")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="ad-empty">
                        No stats yet — finish a match to populate the leaderboard.
                      </td>
                    </tr>
                  ) : (
                    sortedLeaderboard.map((row, idx) => (
                      <tr key={row.id}>
                        <td className="text-center font-mono text-[var(--ad-muted)]">{idx + 1}</td>
                        <td className="ad-td-main">{row.playerName}</td>
                        <td className="text-center font-semibold text-emerald-400">{row.wins ?? 0}</td>
                        <td className="text-center font-semibold text-red-400">{row.losses ?? 0}</td>
                        <td
                          className={`text-center font-bold ${
                            (row.pointDiff ?? 0) > 0
                              ? "text-emerald-400"
                              : (row.pointDiff ?? 0) < 0
                                ? "text-red-400"
                                : "text-[var(--ad-muted)]"
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
            <div className="ad-modal-footer">
              <button type="button" className="ad-btn ad-btn-outline" onClick={() => setShowLeaderboard(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
