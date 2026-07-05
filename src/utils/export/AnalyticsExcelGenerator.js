import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { format } from 'date-fns';

/**
 * Creates the specialized multi-section Analytics Dashboard export.
 * @param {Object} data - The raw data state from the Analytics component.
 * @param {string} filename - Custom filename
 * @param {string} dateLabel - Label describing the date range of the report
 */
export const generateAnalyticsExcel = async (data, filename = 'Analytics_Dashboard_Report', dateLabel = 'All Time') => {
  if (!data) throw new Error("No data available to export");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RANAW PICKLEBALL COURT SYSTEM';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Analytics Dashboard');
  worksheet.properties.defaultRowHeight = 20;

  let currentRow = 1;

  // -- HELPER: Add Section Header --
  const addSectionHeader = (title) => {
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
    const cell = worksheet.getCell(`A${currentRow}`);
    cell.value = title;
    cell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    currentRow++;
  };

  // -- HELPER: Add Table Headers --
  const addTableHeaders = (headers) => {
    headers.forEach((h, i) => {
      const cell = worksheet.getCell(currentRow, i + 1);
      cell.value = h;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    currentRow++;
  };

  // -- HELPER: Add Data Row --
  const addDataRow = (values, formats = [], isTotal = false) => {
    values.forEach((v, i) => {
      const cell = worksheet.getCell(currentRow, i + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10, bold: isTotal };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      if (formats[i] === 'currency') {
        cell.numFmt = '"₱"#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (formats[i] === 'percent') {
        cell.numFmt = '0.0%';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (typeof v === 'number') {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }

      // Highlight alternating rows
      if (!isTotal && currentRow % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
    currentRow++;
  };

  // --- HEADER SECTION ---
  worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
  let cell = worksheet.getCell(`A${currentRow}`);
  cell.value = 'RANAW PICKLEBALL COURT SYSTEM';
  cell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FF6D28D9' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  currentRow++;

  worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
  cell = worksheet.getCell(`A${currentRow}`);
  cell.value = 'ANALYTICS DASHBOARD';
  cell.font = { name: 'Arial', size: 14, bold: true };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  currentRow++;

  worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
  cell = worksheet.getCell(`A${currentRow}`);
  cell.value = 'Bookings, revenue, and usage patterns across your facility';
  cell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  currentRow++;

  worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
  cell = worksheet.getCell(`A${currentRow}`);
  cell.value = `Export Date: ${format(new Date(), 'MMM d, yyyy h:mm a')} | Filter Range: ${dateLabel} | Facility Snapshot: ${data.courtCount} courts`;
  cell.font = { name: 'Arial', size: 10, color: { argb: 'FF64748B' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  currentRow++;

  // Freeze Headers
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: currentRow }];

  // --- 1. KEY METRICS SUMMARY ---
  addSectionHeader('1. KEY METRICS SUMMARY');
  addTableHeaders(['Metric', 'Value']);
  addDataRow(['Total Bookings', data.bookings?.length || 0]);
  addDataRow(['Court Revenue', data.revenue || 0], ['', 'currency']);
  addDataRow(['Equipment Revenue', data.equipmentRevenue || 0], ['', 'currency']);
  addDataRow(['Registered Players', data.userCount || 0]);
  addDataRow(['Payment Records', data.payments?.length || 0]);

  // --- 2. BOOKINGS PER COURT ---
  addSectionHeader('2. BOOKINGS PER COURT');
  addTableHeaders(['Court Name', 'Bookings Count', 'Percentage']);
  const courtEntries = Object.entries(data.bPerCourt || {}).sort((a, b) => b[1] - a[1]);
  const maxCourt = Math.max(...courtEntries.map(e => e[1]), 1);
  courtEntries.forEach(([name, count]) => {
    addDataRow([name, count, count / maxCourt], ['text', 'number', 'percent']);
  });

  // --- 3. BOOKING STATUS ---
  addSectionHeader('3. BOOKING STATUS');
  addTableHeaders(['Status', 'Count', 'Percentage']);
  const statusEntries = Object.entries(data.bPerStatus || {});
  const totalStatus = statusEntries.reduce((acc, [_, count]) => acc + count, 0) || 1;
  let statusSum = 0;
  statusEntries.forEach(([status, count]) => {
    statusSum += count;
    addDataRow([status, count, count / totalStatus], ['text', 'number', 'percent']);
  });
  addDataRow(['Total', statusSum, 1], ['text', 'number', 'percent'], true);

  // --- 4. BOOKINGS BY DAY OF WEEK ---
  addSectionHeader('4. BOOKINGS BY DAY OF WEEK');
  addTableHeaders(['Day of Week', 'Bookings Count', 'Percentage']);
  const dayEntries = Object.entries(data.bPerDay || {});
  const totalDays = dayEntries.reduce((acc, [_, count]) => acc + count, 0) || 1;
  let daySum = 0;
  dayEntries.forEach(([day, count]) => {
    daySum += count;
    addDataRow([day, count, count / totalDays], ['text', 'number', 'percent']);
  });
  addDataRow(['Total', daySum, 1], ['text', 'number', 'percent'], true);

  // --- 5. PAYMENT METHODS (RECORDS) ---
  addSectionHeader('5. PAYMENT METHODS (RECORDS)');
  addTableHeaders(['Payment Method', 'Payment Count', 'Percentage']);
  const methodEntries = Object.entries(data.methods || {}).sort((a, b) => b[1] - a[1]);
  const totalMethods = methodEntries.reduce((acc, [_, count]) => acc + count, 0) || 1;
  let methodSum = 0;
  methodEntries.forEach(([method, count]) => {
    methodSum += count;
    addDataRow([method, count, count / totalMethods], ['text', 'number', 'percent']);
  });
  addDataRow(['Total', methodSum, 1], ['text', 'number', 'percent'], true);

  // --- 6. MONTHLY BOOKING REVENUE ---
  addSectionHeader('6. MONTHLY BOOKING REVENUE');
  addTableHeaders(['Month', 'Revenue Amount', 'Percentage']);
  const monthlyEntries = Object.entries(data.monthlyRevenue || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const totalMonthlyRev = monthlyEntries.reduce((acc, [_, amt]) => acc + amt, 0) || 1;
  let monthlySum = 0;
  monthlyEntries.forEach(([month, amt]) => {
    monthlySum += amt;
    addDataRow([month, amt, amt / totalMonthlyRev], ['text', 'currency', 'percent']);
  });
  addDataRow(['Total', monthlySum, 1], ['text', 'currency', 'percent'], true);

  // --- 7. CASH VS GCASH (BOOKINGS) ---
  addSectionHeader('7. CASH VS GCASH (BOOKINGS)');
  addTableHeaders(['Payment Method', 'Bookings Count', 'Percentage']);
  const bookingPayEntries = Object.entries(data.bookingPaySplit || {});
  const totalBookingPay = bookingPayEntries.reduce((acc, [_, count]) => acc + count, 0) || 1;
  let bookingPaySum = 0;
  bookingPayEntries.forEach(([method, count]) => {
    bookingPaySum += count;
    addDataRow([method, count, count / totalBookingPay], ['text', 'number', 'percent']);
  });
  addDataRow(['Total', bookingPaySum, 1], ['text', 'number', 'percent'], true);

  // --- 8. MOST BORROWED EQUIPMENT ---
  addSectionHeader('8. MOST BORROWED EQUIPMENT');
  addTableHeaders(['Equipment Name', 'Quantity Borrowed', 'Percentage']);
  const equipmentEntries = Object.entries(data.mostBorrowedEquipment || {}).sort((a, b) => b[1] - a[1]);
  const totalEquipmentQty = equipmentEntries.reduce((acc, [_, count]) => acc + count, 0) || 1;
  let equipmentSum = 0;
  equipmentEntries.forEach(([name, count]) => {
    equipmentSum += count;
    addDataRow([name, count, count / totalEquipmentQty], ['text', 'number', 'percent']);
  });
  addDataRow(['Total', equipmentSum, 1], ['text', 'number', 'percent'], true);

  // Adjust column widths
  worksheet.getColumn(1).width = 30;
  worksheet.getColumn(2).width = 25;
  worksheet.getColumn(3).width = 25;

  worksheet.properties.showGridLines = false;

  // Generate ArrayBuffer and save using file-saver
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${filename}.xlsx`);
};
