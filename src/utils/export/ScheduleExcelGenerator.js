import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export async function exportScheduleToExcel(divisionName, matches, teams, pools, startTimeStr = "08:00", roundDurationMins = 30) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Match Schedule');

  // Define columns
  worksheet.columns = [
    { header: 'Division', key: 'division', width: 20 },
    { header: 'Bracket', key: 'bracket', width: 20 },
    { header: 'Time', key: 'time', width: 15 },
    { header: 'Team 1', key: 'team1', width: 35 },
    { header: 'Team 2', key: 'team2', width: 35 }
  ];

  // Style header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Helper to parse HH:mm and add minutes
  const formatTime = (timeStr, addMins) => {
    if (!timeStr) return 'TBD';
    const [hoursStr, minsStr] = timeStr.split(':');
    let date = new Date();
    date.setHours(parseInt(hoursStr, 10));
    date.setMinutes(parseInt(minsStr, 10) + addMins);
    
    // Format to AM/PM
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Sort matches by roundNum then bracket
  const sortedMatches = [...matches].sort((a, b) => {
    if (a.roundNum !== b.roundNum) return (a.roundNum || 0) - (b.roundNum || 0);
    return (a.poolId || '').localeCompare(b.poolId || '');
  });

  // Populate data
  sortedMatches.forEach(m => {
    const pool = pools.find(p => p.id === m.poolId);
    
    // Get actual team names
    const t1Obj = teams.find(t => t.id === m.team1Id);
    const t2Obj = teams.find(t => t.id === m.team2Id);
    
    const t1Name = t1Obj ? t1Obj.name : (m.team1Name || 'TBD');
    const t2Name = t2Obj ? t2Obj.name : (m.team2Name || 'TBD');

    // Calculate time based on roundNum (assuming roundNum starts at 1)
    const roundOffset = ((m.roundNum || 1) - 1) * roundDurationMins;
    const matchTime = formatTime(startTimeStr, roundOffset);

    worksheet.addRow({
      division: divisionName,
      bracket: pool ? pool.name.replace('Pool', 'Bracket') : 'N/A',
      time: matchTime,
      team1: t1Name,
      team2: t2Name
    });
  });

  // Export
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${divisionName}_Schedule.xlsx`);
}
