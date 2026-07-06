// src/utils/bracketV2Generator.js

/**
 * Main bracket generator router
 */
export function generateMedalBracket(teams, divisionId, bracketType = "single-elimination", scoringMode = "traditional", winScore = 11, format = "bo1") {
  if (bracketType === "double-elimination") {
    return generateDoubleEliminationV2(teams, divisionId, scoringMode, winScore, format);
  }
  return generateSingleEliminationV2(teams, divisionId, scoringMode, winScore, format);
}

function getSeedingOrder(n) {
  if (n === 2) return [0, 1];
  if (n === 4) return [0, 3, 1, 2];
  if (n === 8) return [0, 7, 3, 4, 1, 6, 2, 5];
  if (n === 16) return [0, 15, 7, 8, 3, 12, 4, 11, 1, 14, 6, 9, 2, 13, 5, 10];
  const order = [];
  for (let i = 0; i < n / 2; i++) {
    order.push(i, n - 1 - i);
  }
  return order;
}

function createMatchBase(divisionId, scoringMode, winScore, format) {
  return {
    divisionId,
    poolId: null,
    score1: 0,
    score2: 0,
    winnerId: null,
    status: 'scheduled',
    court: '',
    time: null,
    scoringMode,
    winScore,
    format
  };
}

export function generateSingleEliminationV2(teams, divisionId, scoringMode, winScore, format) {
  let size = 2;
  while (size < teams.length) size *= 2;
  const seedOrder = getSeedingOrder(size);
  const initialMatches = [];
  
  for (let i = 0; i < size; i += 2) {
    const t1Idx = seedOrder[i];
    const t2Idx = seedOrder[i + 1];
    const team1 = t1Idx < teams.length ? teams[t1Idx] : { id: 'bye', name: 'BYE' };
    const team2 = t2Idx < teams.length ? teams[t2Idx] : { id: 'bye', name: 'BYE' };
    
    let winnerId = null;
    let status = 'scheduled';
    if (team1.id === 'bye' && team2.id !== 'bye') { winnerId = team2.id; status = 'completed'; }
    else if (team2.id === 'bye' && team1.id !== 'bye') { winnerId = team1.id; status = 'completed'; }
    else if (team1.id === 'bye' && team2.id === 'bye') { winnerId = 'bye'; status = 'completed'; }

    initialMatches.push({
      ...createMatchBase(divisionId, scoringMode, winScore, format),
      id: `m-r1-${Date.now()}-${i}`,
      round: size === 2 ? 'Final' : size === 4 ? 'Semifinal' : size === 8 ? 'Quarterfinal' : 'Round 1',
      roundNum: 1,
      matchNum: (i / 2) + 1,
      team1Id: team1.id,
      team1Name: team1.name,
      team2Id: team2.id,
      team2Name: team2.name,
      winnerId,
      status,
      nextMatchId: null
    });
  }

  const allMatches = [...initialMatches];
  let currentRoundMatches = initialMatches;
  let roundNum = 2;
  let currentSize = size / 2;
  let matchCounter = 1;

  while (currentSize > 1) {
    const nextRoundMatches = [];
    const roundName = currentSize === 2 ? 'Final' : currentSize === 4 ? 'Semifinal' : `Round ${roundNum}`;
    for (let i = 0; i < currentSize; i += 2) {
      const match = {
        ...createMatchBase(divisionId, scoringMode, winScore, format),
        id: `m-r${roundNum}-${Date.now()}-${i}`,
        round: roundName,
        roundNum,
        matchNum: matchCounter++,
        team1Id: null,
        team1Name: 'TBD',
        team2Id: null,
        team2Name: 'TBD',
        nextMatchId: null
      };

      currentRoundMatches[i].nextMatchId = match.id;
      currentRoundMatches[i + 1].nextMatchId = match.id;

      if (currentRoundMatches[i].winnerId && currentRoundMatches[i].winnerId !== 'bye') {
        match.team1Id = currentRoundMatches[i].winnerId;
        match.team1Name = currentRoundMatches[i].winnerId;
      }
      if (currentRoundMatches[i + 1].winnerId && currentRoundMatches[i + 1].winnerId !== 'bye') {
        match.team2Id = currentRoundMatches[i + 1].winnerId;
        match.team2Name = currentRoundMatches[i + 1].winnerId;
      }

      nextRoundMatches.push(match);
      allMatches.push(match);
    }
    currentRoundMatches = nextRoundMatches;
    currentSize /= 2;
    roundNum++;
  }
  return allMatches;
}

export function generateDoubleEliminationV2(teams, divisionId, scoringMode, winScore, format) {
  // A simplified DE structure generating match placeholders for V2 UI
  let size = 2;
  while (size < teams.length) size *= 2;
  const seedOrder = getSeedingOrder(size);
  
  const allMatches = [];
  const winnerRounds = [];
  let matchCounter = 1;

  let currentRoundMatches = [];
  for (let i = 0; i < size; i += 2) {
    const t1Idx = seedOrder[i];
    const t2Idx = seedOrder[i + 1];
    const team1 = t1Idx < teams.length ? teams[t1Idx] : { id: 'bye', name: 'BYE' };
    const team2 = t2Idx < teams.length ? teams[t2Idx] : { id: 'bye', name: 'BYE' };
    
    let winnerId = null;
    let status = 'scheduled';
    if (team1.id === 'bye' && team2.id !== 'bye') { winnerId = team2.id; status = 'completed'; }
    else if (team2.id === 'bye' && team1.id !== 'bye') { winnerId = team1.id; status = 'completed'; }
    else if (team1.id === 'bye' && team2.id === 'bye') { winnerId = 'bye'; status = 'completed'; }

    const match = {
      ...createMatchBase(divisionId, scoringMode, winScore, format),
      id: `m-w1-${Date.now()}-${matchCounter}`,
      round: 'W-Round 1',
      roundNum: 1,
      matchNum: matchCounter++,
      team1Id: team1.id,
      team1Name: team1.name,
      team2Id: team2.id,
      team2Name: team2.name,
      winnerId,
      status,
      nextMatchId: null, // next winner match
      nextLoserMatchId: null
    };
    currentRoundMatches.push(match);
    allMatches.push(match);
  }
  winnerRounds.push(currentRoundMatches);

  let roundNum = 2;
  let currentSize = size / 2;
  while (currentSize > 1) {
    const nextRoundMatches = [];
    for (let i = 0; i < currentSize; i += 2) {
      const match = {
        ...createMatchBase(divisionId, scoringMode, winScore, format),
        id: `m-w${roundNum}-${Date.now()}-${matchCounter}`,
        round: `W-Round ${roundNum}`,
        roundNum,
        matchNum: matchCounter++,
        team1Id: null,
        team1Name: 'TBD',
        team2Id: null,
        team2Name: 'TBD',
        nextMatchId: null,
        nextLoserMatchId: null
      };
      
      currentRoundMatches[i].nextMatchId = match.id;
      currentRoundMatches[i + 1].nextMatchId = match.id;
      
      nextRoundMatches.push(match);
      allMatches.push(match);
    }
    winnerRounds.push(nextRoundMatches);
    currentRoundMatches = nextRoundMatches;
    currentSize /= 2;
    roundNum++;
  }

  // Create Losers bracket placeholders (simplified)
  // For V2, we just create the matches. V2 resolves team1Id/team2Id via manual assignment or UI updates if not strictly bound.
  // To keep it clean and prevent complex graph resolution, we create basic L-Rounds.
  let lRoundNum = 1;
  const lMatches = [];
  for (let i = 0; i < (size/2); i++) {
    const match = {
      ...createMatchBase(divisionId, scoringMode, winScore, format),
      id: `m-l1-${Date.now()}-${matchCounter}`,
      round: `L-Round 1`,
      roundNum: roundNum + lRoundNum, // Offset round number for display
      matchNum: matchCounter++,
      team1Id: null,
      team1Name: 'TBD (Loser)',
      team2Id: null,
      team2Name: 'TBD (Loser)',
      nextMatchId: null
    };
    winnerRounds[0][i].nextLoserMatchId = match.id;
    lMatches.push(match);
    allMatches.push(match);
  }

  return allMatches;
}
