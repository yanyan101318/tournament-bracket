// src/admin/PaddleStackingPage.jsx — admin-only paddle queue & court rotation
import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  updateDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { useOfflineSync } from "../hooks/useOfflineSync";
import toast from "react-hot-toast";
import { format, parse, isValid } from "date-fns";

const STATE_DOC = doc(db, "paddleStack", "state");

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

function isMixPlayer(e) {
  if (isGroupEntry(e)) return false;
  return !isCategorizedPlayer(e);
}

function categorySkillMatch(e, cat, skill) {
  if (isGroupEntry(e)) return false;
  return normalizeCategory(e?.category) === cat && normalizeSkillLevel(e?.skillLevel) === skill;
}

/** Doubles: queue[0] is categorized — next 4 in list order with same category+skill (groups skipped). */
function peekCategorizedDoublesFromTop(q) {
  const cat = normalizeCategory(q[0].category);
  const skill = normalizeSkillLevel(q[0].skillLevel);
  const units = [];
  for (let j = 0; j < q.length && units.length < 4; j++) {
    const e = q[j];
    if (isGroupEntry(e)) continue;
    if (categorySkillMatch(e, cat, skill)) units.push(e);
  }
  if (units.length < 4) {
    return { ok: false, reason: "not_enough_categorized_doubles", units: [], playerSlots: [] };
  }
  const playerSlots = units.map((t) => playerSlotFromQueueEntry(t));
  return { ok: true, reason: null, units, playerSlots };
}

/** Doubles: queue[0] is mix — next 4 mix players in FIFO order (groups & categorized rows skipped). */
function peekMixDoubles(q) {
  const units = [];
  for (let j = 0; j < q.length && units.length < 4; j++) {
    const e = q[j];
    if (isGroupEntry(e)) continue;
    if (isMixPlayer(e)) units.push(e);
  }
  if (units.length < 4) {
    return { ok: false, reason: "not_enough_mix_doubles", units: [], playerSlots: [] };
  }
  const playerSlots = units.map((t) => playerSlotFromQueueEntry(t));
  return { ok: true, reason: null, units, playerSlots };
}

function peekNextSingles(q) {
  const head = q[0];
  if (isGroupEntry(head)) {
    return { ok: false, reason: "group_blocks_singles", units: [], playerSlots: [] };
  }
  if (isCategorizedPlayer(head)) {
    const cat = normalizeCategory(head.category);
    const skill = normalizeSkillLevel(head.skillLevel);
    const units = [head];
    for (let j = 1; j < q.length; j++) {
      const e = q[j];
      if (isGroupEntry(e)) continue;
      if (categorySkillMatch(e, cat, skill)) {
        units.push(e);
        const playerSlots = units.map((t) => playerSlotFromQueueEntry(t));
        return { ok: true, reason: null, units, playerSlots };
      }
    }
    return { ok: false, reason: "need_matching_singles", units: [], playerSlots: [] };
  }
  const units = [head];
  for (let j = 1; j < q.length; j++) {
    const e = q[j];
    if (isGroupEntry(e)) continue;
    if (isMixPlayer(e)) {
      units.push(e);
      const playerSlots = units.map((t) => playerSlotFromQueueEntry(t));
      return { ok: true, reason: null, units, playerSlots };
    }
  }
  return { ok: false, reason: "need_two_mix_singles", units: [], playerSlots: [] };
}

const SKILL_OPTIONS = [
  { id: "high", label: "High Level" },
  { id: "low", label: "Low Level" },
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
  return e.name || "—";
}

function entrySearchText(e) {
  if (isGroupEntry(e)) return (e.members || []).join(" ");
  return e?.name || "";
}

/**
 * Singles: pair by category+skill if top is categorized; else pair two mix players (FIFO, skip groups & wrong type).
 * Doubles: group at top → one unit; else categorized top → 4 same cat+skill; else mix top → 4 mix players (scanning down).
 */
function peekNextAssignment(queueArr, assignMode) {
  const q = queueArr || [];
  if (!q.length) return { ok: false, reason: "empty", units: [], playerSlots: [] };

  if (assignMode === "singles") {
    return peekNextSingles(q);
  }

  const head = q[0];
  if (isGroupEntry(head)) {
    const playerSlots = [playerSlotFromQueueEntry(head)];
    return { ok: true, reason: null, units: [head], playerSlots };
  }
  if (isCategorizedPlayer(head)) {
    return peekCategorizedDoublesFromTop(q);
  }
  return peekMixDoubles(q);
}

function nextSuggestionLabels(queueArr, assignMode) {
  const peek = peekNextAssignment(queueArr, assignMode);
  if (!peek.ok) {
    if (peek.reason === "group_blocks_singles") return ["(Group next — use Doubles or move group)"];
    if (peek.reason === "need_matching_singles")
      return ["(Not enough with same category & skill for singles)"];
    if (peek.reason === "need_two_mix_singles") return ["(Need another mix player for singles — check order)"];
    if (peek.reason === "not_enough_categorized_doubles")
      return ["(Not enough same category & skill in queue — need 4)"];
    if (peek.reason === "not_enough_mix_doubles") return ["(Not enough mix players in queue — need 4)"];
    return [];
  }
  return peek.playerSlots.map((p) =>
    p.members && p.members.length ? `Group: ${p.members.join(" · ")}` : p.name
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

function mergePaddleCourtsFromFacility(facilityCourts, bookings, now, existingCourts) {
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
    const prev = prevByFc.get(fc.id);
    const isActive = fc.isActive !== false;
    const hasBookingConflict = blocked.has(fc.id);
    const paddleEligible = isActive && !hasBookingConflict;

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
  const [newPlayer, setNewPlayer] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [assignCourtId, setAssignCourtId] = useState("");
  const [assignMode, setAssignMode] = useState("doubles");
  const [bookings, setBookings] = useState([]);
  const [bookingsReady, setBookingsReady] = useState(false);
  const [facilityCourtsReady, setFacilityCourtsReady] = useState(false);
  const [tickNow, setTickNow] = useState(() => Date.now());
  const [randomCategory, setRandomCategory] = useState("male");
  const [randomSkill, setRandomSkill] = useState("high");
  const [groupNames, setGroupNames] = useState(["", "", "", ""]);
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
  }, []);

  const queue = useMemo(() => state?.queue || [], [state]);
  const courts = useMemo(() => state?.courts || [], [state]);
  const stackMode = state?.stackMode || "mix";

  const mergedCourts = useMemo(
    () => mergePaddleCourtsFromFacility(facilityCourts, bookings, new Date(tickNow), courts),
    [facilityCourts, bookings, tickNow, courts]
  );

  const nowForBookings = useMemo(() => new Date(tickNow), [tickNow]);
  const openFacilityCourts = useMemo(() => {
    const blocked = blockedFacilityIdsFromBookings(bookings, nowForBookings, facilityCourts);
    return [...(facilityCourts || [])]
      .filter((fc) => fc.isActive !== false && !blocked.has(fc.id))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
  }, [facilityCourts, bookings, nowForBookings]);

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

  const persistState = useCallback(async (partial) => {
    const cleaned = omitUndefinedDeep(partial);
    await updateDoc(STATE_DOC, { ...cleaned, updatedAt: serverTimestamp() });
  }, []);

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
    const name = newPlayer.trim();
    if (!name) {
      toast.error("Enter a name");
      return;
    }
    const namesSet = allQueuedNormNames(queue);
    if (namesSet.has(normName(name))) {
      toast.error("That name is already in the queue (or in a group)");
      return;
    }
    const base = { id: newId(), name, addedAt: Timestamp.now() };
    const entry =
      stackMode === "random"
        ? {
            ...base,
            kind: "individual",
            category: randomCategory,
            skillLevel: randomSkill,
          }
        : base;
    await wrapSync(persistState({ queue: [...queue, entry] }), {
      successMsg: "Added to stack",
      offlineMsg: "Player Queued Offline — Will Sync Automatically",
      errorMsg: "Could not add player"
    });
    setNewPlayer("");
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
          }
        : c
    );
    await wrapSync(persistState({ queue: rest, courts: nextCourts }), {
      successMsg: `${assignMode === "singles" ? "Singles" : "Doubles"} started on ${court.name}`,
      offlineMsg: "Match Assignment Saved Offline — Will Sync Automatically",
      errorMsg: "Could not assign match"
    });
  }

  async function finishMatch(courtId) {
    const court = courts.find((x) => x.id === courtId);
    if (!court || court.status !== "ongoing") return;
    const endedAt = Timestamp.now();
    const nextCourts = courts.map((c) =>
      c.id === courtId ? courtClearedForAvailable(c) : c
    );
    await wrapSync(persistState({ courts: nextCourts }), {
      successMsg: `${court.name} is available again`,
      offlineMsg: "Court Status Saved Offline — Will Sync Automatically",
      errorMsg: "Court freed — history log may have failed"
    });
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
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      toast.error("Court freed — history log failed (check rules).");
    }
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
        "Reset session? This clears the queue and frees all courts. Match history is kept."
      )
    )
      return;
    const nextCourts = courts.map((c) => courtClearedForAvailable(c));
    await wrapSync(persistState({ queue: [], courts: nextCourts }), {
      successMsg: "Session reset",
      offlineMsg: "Session Reset Saved Offline — Will Sync Automatically",
      errorMsg: "Could not reset session"
    });
  }

  useEffect(() => {
    const avail = courts.filter((c) => c.status === "available");
    if (!avail.length) {
      setAssignCourtId("");
      return;
    }
    if (!assignCourtId || !avail.some((c) => c.id === assignCourtId)) {
      setAssignCourtId(avail[0].id);
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
          <h1 className="ad-page-title">Paddle stacking</h1>
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
          <div className="flex items-center gap-2 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-surface)] px-2 py-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ad-muted)] pl-1">
              Mode
            </span>
            <select
              className="af-input py-1.5 text-sm min-w-[140px] border-0 bg-transparent"
              value={stackMode}
              onChange={(e) => setStackMode(e.target.value)}
              aria-label="Stacking mode"
            >
              {STACK_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="ad-btn ad-btn-outline ad-btn-sm" onClick={resetSession}>
            Reset session
          </button>
        </div>
      </div>

      <div className="grid xl:grid-cols-3 gap-6">
        {/* Queue column: add panel + list panel */}
        <div className="xl:col-span-1 space-y-4">
          <div className="ad-card p-4 transition-all duration-200">
            <h3 className="text-sm font-black text-white uppercase tracking-wide mb-2">Add players</h3>
              <p className="text-[11px] text-[var(--ad-muted)] mb-3">
              {stackMode === "mix" &&
                "Add players in order (no tags). Next game groups four mix players from the top, in list order."}
                {stackMode === "random" &&
                  "Tag category & skill for categorized players. Doubles: the top of the list decides — categorized first players get the next three matching tags in order; mix players use the next four mix rows (never mixed together)."}
              {stackMode === "group" &&
                "Submit four names as one fixed unit. The group advances as a single FIFO slot (4 players)."}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--ad-pickle)]/15 text-[var(--ad-pickle)] border border-[var(--ad-pickle)]/30">
                Mode: {STACK_MODES.find((m) => m.id === stackMode)?.label ?? stackMode}
              </span>
            </div>

            {(stackMode === "mix" || stackMode === "random") && (
              <form onSubmit={addPlayer} className="space-y-3">
                {stackMode === "random" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="af-group">
                      <label className="af-label">Category</label>
                      <select
                        className="af-input"
                        value={randomCategory}
                        onChange={(e) => setRandomCategory(e.target.value)}
                      >
                        {CATEGORY_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="af-group">
                      <label className="af-label">Skill level</label>
                      <select
                        className="af-input"
                        value={randomSkill}
                        onChange={(e) => setRandomSkill(e.target.value)}
                      >
                        {SKILL_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    className="af-input flex-1 min-w-0"
                    placeholder="Player name"
                    value={newPlayer}
                    onChange={(e) => setNewPlayer(e.target.value)}
                  />
                  <button type="submit" className="ad-btn ad-btn-primary ad-btn-sm shrink-0 w-full sm:w-auto">
                    Add to queue
                  </button>
                </div>
              </form>
            )}

            {stackMode === "group" && (
              <form onSubmit={addGroupSubmit} className="space-y-2">
                <div className="text-[10px] font-bold uppercase text-[var(--ad-muted)]">Fixed group (4 players)</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <input
                      key={i}
                      className="af-input"
                      placeholder={`Player ${i + 1}`}
                      value={groupNames[i]}
                      onChange={(e) => {
                        const next = [...groupNames];
                        next[i] = e.target.value;
                        setGroupNames(next);
                      }}
                    />
                  ))}
                </div>
                <button type="submit" className="ad-btn ad-btn-primary ad-btn-sm w-full sm:w-auto">
                  Add group to queue
                </button>
              </form>
            )}
          </div>

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
            <h3 className="text-sm font-black text-white uppercase tracking-wide mb-3">Game assignment</h3>

            <div className="rounded-lg border border-[var(--ad-border)] bg-[#0d0f14]/80 p-3 mb-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ad-muted)]">
                  Available courts (auto)
                </div>
                <span className="text-[10px] text-[var(--ad-muted)]" title="Refreshes when bookings change; time window checked every 30s">
                  Live · {format(nowForBookings, "MMM d, HH:mm")}
                </span>
              </div>
              {facilityCourts.length === 0 ? (
                <p className="text-[11px] text-amber-400/95 leading-relaxed">
                  No courts in your facility yet.{" "}
                  <Link to="/admin/courts" className="underline font-semibold text-[var(--ad-pickle)]">
                    Add courts in Court management
                  </Link>{" "}
                  first.
                </p>
              ) : openFacilityCourts.length === 0 ? (
                <p className="text-[11px] text-[var(--ad-muted)] leading-relaxed">
                  No courts are free for paddle assignment right now (inactive, or an approved booking overlaps the
                  current time). Ongoing matches below stay until you mark them finished.
                </p>
              ) : (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {openFacilityCourts.map((fc) => (
                    <li
                      key={fc.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-[var(--ad-text)] truncate">{fc.name}</span>
                      <span className="text-[10px] font-bold uppercase shrink-0 text-emerald-400">Available</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
              <div className="af-group min-w-[140px]">
                <label className="af-label">Format</label>
                <select
                  className="af-input"
                  value={assignMode}
                  onChange={(e) => setAssignMode(e.target.value)}
                >
                  <option value="doubles">Doubles (4)</option>
                  <option value="singles">Singles (2)</option>
                </select>
              </div>
              <div className="af-group flex-1 min-w-[160px]">
                <label className="af-label">Court</label>
                <select
                  className="af-input"
                  value={assignCourtId}
                  onChange={(e) => setAssignCourtId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {courts.map((c) => (
                    <option key={c.id} value={c.id} disabled={c.status !== "available"}>
                      {c.name}
                      {c.facilityCourtId ? " · facility" : ""}
                      {c.status === "ongoing" ? " (busy)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" className="ad-btn ad-btn-primary" onClick={assignMatch}>
                  Take next from queue (FIFO) → court
                </button>
              </div>
            </div>

            <p className="text-[11px] text-[var(--ad-muted)] mb-4">
              Same name cannot appear twice in the queue (including inside a group). FIFO order is preserved for
              “Take next from queue”. Groups count as one slot. To play again, add players back after the game.
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
            <div className="ad-card-header">
              <h3 className="ad-card-title">Match history</h3>
              <span className="text-xs text-[var(--ad-muted)]">{history.length} recorded</span>
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
                                  <div className="text-[var(--ad-text)]">{title}</div>
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
    </div>
  );
}
