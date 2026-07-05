// src/utils/bracketGenerator.js
// src/utils/bracketGenerator.js

// Pickleball scoring rules: 11 points, win by 2
export function isGameWon(scoreA, scoreB) {
  // Both must be at least 11 (except one is exactly 11 and other is 10 or less)
  if (scoreA >= 11 && scoreB <= scoreA - 2) return true;
  if (scoreB >= 11 && scoreA <= scoreB - 2) return true;
  return false;
}

// Get the winner of a game: "A", "B", or null
export function getGameWinner(scoreA, scoreB) {
  if (scoreA >= 11 && scoreB <= scoreA - 2) return "A";
  if (scoreB >= 11 && scoreA <= scoreB - 2) return "B";
  return null;
}

/** Rally scoring: first to 21, win by 2 */
export const RALLY_WIN_POINTS = 21;

export function isRallyGameWon(scoreA, scoreB) {
  if (scoreA >= RALLY_WIN_POINTS && scoreB <= scoreA - 2) return true;
  if (scoreB >= RALLY_WIN_POINTS && scoreA <= scoreB - 2) return true;
  return false;
}

export function getRallyGameWinner(scoreA, scoreB) {
  if (scoreA >= RALLY_WIN_POINTS && scoreB <= scoreA - 2) return "A";
  if (scoreB >= RALLY_WIN_POINTS && scoreA <= scoreB - 2) return "B";
  return null;
}

export function isGameWonForMode(scoreA, scoreB, scoringMode) {
  return scoringMode === "rally" ? isRallyGameWon(scoreA, scoreB) : isGameWon(scoreA, scoreB);
}

/** Doubles rally: even team score → right serves, odd → left */
export function rallyServingSideForTeamScore(teamScore) {
  return teamScore % 2 === 0 ? "right" : "left";
}

/**
 * Rally scoring: every rally won awards a point; side-out when receiving team wins.
 * Updates match.currentGame for next rally (serve + doubles position).
 */
export function recordRallyPoint(match, scoringTeam, newScoreA, newScoreB) {
  const gameWinner = getRallyGameWinner(newScoreA, newScoreB);
  if (gameWinner) {
    return {
      gameEnded: true,
      winner: gameWinner,
      scoreA: newScoreA,
      scoreB: newScoreB,
    };
  }

  const prev = match.currentGame || getNextServer(match);
  const newServingTeam = scoringTeam;
  const servingTeamScore = newServingTeam === "A" ? newScoreA : newScoreB;
  const servingSide = rallyServingSideForTeamScore(servingTeamScore);

  match.currentGame = {
    servingTeam: newServingTeam,
    firstServer: servingSide === "right",
    servingSide,
    pointsServed: (prev.pointsServed || 0) + 1,
  };

  return {
    gameEnded: false,
    fault: false,
    serving: match.currentGame,
  };
}

// Serving logic for doubles
export function getNextServer(match) {
  if (!match.currentGame) {
    return {
      servingTeam: "A",
      firstServer: false,
      servingSide: "right",
      pointsServed: 0,
    };
  }
  return { ...match.currentGame };
}

export function advanceServer(match) {
  const current = match.currentGame || getNextServer(match);
  
  // Alternate serving side after each point
  const newSide = current.servingSide === "right" ? "left" : "right";
  const newPointsServed = current.pointsServed + 1;
  
  return {
    servingTeam: current.servingTeam,
    firstServer: current.firstServer,
    servingSide: newSide,
    pointsServed: newPointsServed,
  };
}

export function handleFault(match) {
  const current = match.currentGame || getNextServer(match);
  
  // If second server faults, side-out (switch to other team)
  if (!current.firstServer) {
    return {
      servingTeam: current.servingTeam === "A" ? "B" : "A",
      firstServer: true,
      servingSide: "right",
      pointsServed: 0,
    };
  }
  
  // First server faults, go to second server
  return {
    servingTeam: current.servingTeam,
    firstServer: false,
    servingSide: current.servingSide,
    pointsServed: current.pointsServed,
  };
}

// Record a fault by the serving team and rotate server
export function recordFault(match) {
  const newServing = handleFault(match);
  match.currentGame = newServing;
  
  return {
    servingTeam: newServing.servingTeam,
    firstServer: newServing.firstServer,
    servingSide: newServing.servingSide,
  };
}

// Record a point for a team and check if game ended.
// Traditional pickleball: only the serving team can score points. If the receiving team
// "scores" (receiver POINT button), it is a fault on the serve — no points change; 1st→2nd
// serve or side out (same as recordFault).
export function recordPoint(match, scoringTeam, scoreA, scoreB) {
  const current = match.currentGame || getNextServer(match);
  const servingTeam = current.servingTeam;

  if (scoringTeam !== servingTeam) {
    const newServing = handleFault(match);
    match.currentGame = newServing;
    return {
      gameEnded: false,
      fault: true,
      serving: newServing,
    };
  }

  const gameWinner = getGameWinner(scoreA, scoreB);

  if (gameWinner) {
    return {
      gameEnded: true,
      winner: gameWinner,
      scoreA,
      scoreB,
    };
  }

  const nextServing = advanceServer(match);
  match.currentGame = nextServing;

  return {
    gameEnded: false,
    fault: false,
    serving: nextServing,
  };
}

/**
 * Main bracket generator - routes to appropriate format
 * @param {string[]} teams - Array of team names
 * @param {string} format - Match format (bo1, bo3, bo5)
 * @param {string} tournamentFormat - Tournament format (single-elimination, double-elimination, round-robin)
 */
export function generateBracket(teams, format, tournamentFormat = "single-elimination") {
  switch (tournamentFormat) {
    case "round-robin":
      return generateRoundRobin(teams, format);
    case "double-elimination":
      return generateDoubleElimination(teams, format);
    case "single-elimination":
    default:
      return generateSingleElimination(teams, format);
  }
}

/**
 * Generate single-elimination bracket
 */
function generateSingleElimination(teams, format) {
  const size = nextPowerOf2(teams.length);
  const padded = [...teams];
  while (padded.length < size) padded.push("BYE");

  const rounds = [];
  let currentRound = [];

  for (let i = 0; i < padded.length; i += 2) {
    currentRound.push({
      matchId: `SE-R1-M${i / 2 + 1}`,
      round: 1,
      teamA: padded[i],
      teamB: padded[i + 1],
      sets: [],
      scoreA: 0,
      scoreB: 0,
      winner: null,
      loser: null,
      format,
      tournamentFormat: "single-elimination",
      nextMatchId: null,
      fromMatchA: null,
      fromMatchB: null,
      currentGame: {
        servingTeam: "A",
        firstServer: false,
        servingSide: "right",
        pointsServed: 0,
      },
    });
  }
  rounds.push(currentRound);

  let roundNum = 2;
  while (currentRound.length > 1) {
    const nextRound = [];
    for (let i = 0; i < currentRound.length; i += 2) {
      const match = {
        matchId: `SE-R${roundNum}-M${i / 2 + 1}`,
        round: roundNum,
        teamA: null,
        teamB: null,
        sets: [],
        scoreA: 0,
        scoreB: 0,
        winner: null,
        loser: null,
        format,
        tournamentFormat: "single-elimination",
        nextMatchId: null,
        fromMatchA: currentRound[i].matchId,
        fromMatchB: currentRound[i + 1]?.matchId ?? null,
        currentGame: {
          servingTeam: "A",
          firstServer: false,
          servingSide: "right",
          pointsServed: 0,
        },
      };
      nextRound.push(match);
      currentRound[i].nextMatchId = match.matchId;
      if (currentRound[i + 1]) currentRound[i + 1].nextMatchId = match.matchId;
    }
    rounds.push(nextRound);
    currentRound = nextRound;
    roundNum++;
  }

  const matchMap = {};
  rounds.forEach((round) => round.forEach((m) => { matchMap[m.matchId] = m; }));

  // Auto-advance BYEs
  rounds[0].forEach((match) => {
    if (match.teamB === "BYE") {
      match.winner = match.teamA;
      match.loser = "BYE";
      advanceWinner(match, matchMap);
    }
  });

  return { rounds, matchMap };
}

/**
 * Generate round-robin bracket
 * Each team plays against every other team once
 */
function generateRoundRobin(teams, format) {
  const rounds = [];
  const matchMap = {};
  let matchCounter = 1;

  // Create matches for every pair of teams
  const matches = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        teamAIdx: i,
        teamBIdx: j,
        teamA: teams[i],
        teamB: teams[j],
      });
    }
  }

  // Distribute matches into rounds (trying to minimize rounds)
  let roundNum = 1;

  while (matches.length > 0) {
    const roundMatches = [];
    const usedTeams = new Set();

    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      if (!usedTeams.has(match.teamAIdx) && !usedTeams.has(match.teamBIdx)) {
        const matchId = `RR-R${roundNum}-M${matchCounter}`;
        roundMatches.push({
          matchId,
          round: roundNum,
          teamA: match.teamA,
          teamB: match.teamB,
          sets: [],
          scoreA: 0,
          scoreB: 0,
          winner: null,
          loser: null,
          format,
          tournamentFormat: "round-robin",
          nextMatchId: null,
          currentGame: {
            servingTeam: "A",
            firstServer: false,
            servingSide: "right",
            pointsServed: 0,
          },
        });
        matchMap[matchId] = roundMatches[roundMatches.length - 1];
        usedTeams.add(match.teamAIdx);
        usedTeams.add(match.teamBIdx);
        matches.splice(i, 1);
        matchCounter++;
      }
    }

    if (roundMatches.length > 0) {
      rounds.push(roundMatches);
      roundNum++;
    }
  }

  // Calculate standings after all matches
  const standings = teams.map((team, idx) => ({
    team,
    wins: 0,
    losses: 0,
    points: 0,
  }));

  return { rounds, matchMap, standings, isRoundRobin: true };
}

/**
 * Generate double-elimination bracket
 * Teams play winner's bracket and loser's bracket
 */
function generateDoubleElimination(teams, format) {
  const size = nextPowerOf2(teams.length);
  const padded = [...teams];
  while (padded.length < size) padded.push("BYE");

  const matchMap = {};
  let matchId = 1;

  // Winner's bracket (like single elimination)
  const winnerRounds = [];
  let currentRound = [];

  for (let i = 0; i < padded.length; i += 2) {
    const id = `DE-W${matchId++}`;
    currentRound.push({
      matchId: id,
      round: 1,
      bracket: "winners",
      teamA: padded[i],
      teamB: padded[i + 1],
      sets: [],
      scoreA: 0,
      scoreB: 0,
      winner: null,
      loser: null,
      format,
      tournamentFormat: "double-elimination",
      nextWinnerId: null,
      nextLoserId: null,
      fromWinnerA: null,
      fromWinnerB: null,
      fromLoserA: null,
      currentGame: {
        servingTeam: "A",
        firstServer: false,
        servingSide: "right",
        pointsServed: 0,
      },
    });
    matchMap[id] = currentRound[currentRound.length - 1];
  }
  winnerRounds.push(currentRound);

  // Build winner's bracket
  let roundNum = 2;
  while (currentRound.length > 1) {
    const nextRound = [];
    for (let i = 0; i < currentRound.length; i += 2) {
      const id = `DE-W${matchId++}`;
      const match = {
        matchId: id,
        round: roundNum,
        bracket: "winners",
        teamA: null,
        teamB: null,
        sets: [],
        scoreA: 0,
        scoreB: 0,
        winner: null,
        loser: null,
        format,
        tournamentFormat: "double-elimination",
        nextWinnerId: null,
        nextLoserId: null,
        fromWinnerA: currentRound[i].matchId,
        fromWinnerB: currentRound[i + 1]?.matchId ?? null,
        currentGame: {
          servingTeam: "A",
          firstServer: false,
          servingSide: "right",
          pointsServed: 0,
        },
      };
      nextRound.push(match);
      matchMap[id] = match;
      currentRound[i].nextWinnerId = id;
      if (currentRound[i + 1]) currentRound[i + 1].nextWinnerId = id;
    }
    winnerRounds.push(nextRound);
    currentRound = nextRound;
    roundNum++;
  }

  // Loser's bracket (complex - simplified single-elimination path for now)
  // In a full double-elim, losers bracket is intricate; this provides basic structure
  const loserRounds = [];
  const firstLoserRound = [];

  // First loser's round gets winners from first winner's round
  const firstWinnerRound = winnerRounds[0];
  for (let i = 0; i < firstWinnerRound.length; i++) {
    const id = `DE-L${matchId++}`;
    firstLoserRound.push({
      matchId: id,
      round: 1,
      bracket: "losers",
      teamA: null,
      teamB: null,
      sets: [],
      scoreA: 0,
      scoreB: 0,
      winner: null,
      loser: null,
      format,
      tournamentFormat: "double-elimination",
      nextWinnerId: null,
      nextLoserId: null,
      fromLosers: [],
      currentGame: {
        servingTeam: "A",
        firstServer: false,
        servingSide: "right",
        pointsServed: 0,
      },
    });
    matchMap[id] = firstLoserRound[i];
    firstWinnerRound[i].nextLoserId = id;
  }

  loserRounds.push(firstLoserRound);

  // Auto-advance BYEs in winner's bracket
  winnerRounds[0].forEach((match) => {
    if (match.teamB === "BYE") {
      match.winner = match.teamA;
      match.loser = "BYE";
      advanceWinner(match, matchMap);
      advanceLoser(match, matchMap);
    }
  });

  // Combine all rounds
  const allRounds = [
    ...winnerRounds.map(r => r.map(m => ({ ...m, phase: "Winners Bracket" }))),
    ...loserRounds.map(r => r.map(m => ({ ...m, phase: "Losers Bracket" }))),
  ];

  return {
    rounds: allRounds,
    matchMap,
    hasWinnersBracket: true,
    hasLosersBracket: true,
    isDoubleElimination: true,
  };
}

export function advanceWinner(match, matchMap) {
  // Handle single elimination
  if (match.nextMatchId) {
    const next = matchMap[match.nextMatchId];
    if (!next) return;
    if (next.fromMatchA === match.matchId) next.teamA = match.winner;
    else next.teamB = match.winner;
  }

  // Handle double elimination winner's bracket
  if (match.nextWinnerId) {
    const next = matchMap[match.nextWinnerId];
    if (!next) return;
    if (next.fromWinnerA === match.matchId) next.teamA = match.winner;
    else if (next.fromWinnerB === match.matchId) next.teamB = match.winner;
  }
}

export function advanceLoser(match, matchMap) {
  // Handle double elimination loser's bracket
  if (match.nextLoserId) {
    const next = matchMap[match.nextLoserId];
    if (!next) return;
    // Loser advances to loser's bracket
    if (!next.teamA) next.teamA = match.loser;
    else if (!next.teamB) next.teamB = match.loser;
  }
}

// winner must always be "A" or "B" — never a team name
// scoreA and scoreB are the final scores of the game
export function recordSetWin(match, winner, matchMap, scoreA = 0, scoreB = 0, scoringMode = "traditional") {
  if (winner !== "A" && winner !== "B") {
    console.error("recordSetWin: winner must be 'A' or 'B', got:", winner);
    return;
  }

  const gameWinner =
    scoringMode === "rally" ? getRallyGameWinner(scoreA, scoreB) : getGameWinner(scoreA, scoreB);
  if (!gameWinner) {
    console.error(
      "recordSetWin: Invalid game score.",
      scoringMode === "rally" ? "Rally: need 21+ with 2-point lead." : "Traditional: need 11+ with 2-point lead.",
    );
    return;
  }

  if (gameWinner !== winner) {
    console.error(`recordSetWin: Game winner should be ${gameWinner}, but got ${winner}`);
    return;
  }

  const needed = setsNeeded(match.format);

  // Store set result with actual scores
  match.sets = [
    ...match.sets,
    { winner, scoreA: Number(scoreA), scoreB: Number(scoreB) },
  ];
  match.scoreA = 0;
  match.scoreB = 0;
  
  // Reset serving for next game
  match.currentGame = {
    servingTeam: "A",
    firstServer: false,
    servingSide: "right",
    pointsServed: 0,
  };

  const winsA = match.sets.filter((s) => s.winner === "A").length;
  const winsB = match.sets.filter((s) => s.winner === "B").length;

  if (winsA >= needed) {
    match.winner = match.teamA;
    match.loser = match.teamB;
    advanceWinner(match, matchMap);
    // In double elimination, loser advances to loser's bracket
    if (match.tournamentFormat === "double-elimination") {
      advanceLoser(match, matchMap);
    }
  } else if (winsB >= needed) {
    match.winner = match.teamB;
    match.loser = match.teamA;
    advanceWinner(match, matchMap);
    // In double elimination, loser advances to loser's bracket
    if (match.tournamentFormat === "double-elimination") {
      advanceLoser(match, matchMap);
    }
  }
}

export function undoLastSet(match, matchMap) {
  if (!match.sets || match.sets.length === 0) return;

  if (match.winner) {
    const next = matchMap[match.nextMatchId];
    if (next) {
      if (next.fromMatchA === match.matchId) next.teamA = null;
      else next.teamB = null;
      next.winner = null;
      next.loser = null;
      next.sets = [];
      next.scoreA = 0;
      next.scoreB = 0;
    }
    match.winner = null;
    match.loser = null;
  }

  match.sets = match.sets.slice(0, -1);
  match.scoreA = 0;
  match.scoreB = 0;
  
  // Reset serving for current game
  match.currentGame = {
    servingTeam: "A",
    firstServer: false,
    servingSide: "right",
    pointsServed: 0,
  };
}

export function setsNeeded(format) {
  if (format === "bo3") return 2;
  if (format === "bo5") return 3;
  return 1;
}

export function setsTotal(format) {
  if (format === "bo3") return 3;
  if (format === "bo5") return 5;
  return 1;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}