import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { FORMATS } from './SchemaRegistry';

/**
 * Generates and downloads a standardized Excel export.
 *
 * @param {Array<Object>} data - The dataset to export.
 * @param {Array<Object>} columns - Column definitions from SchemaRegistry.
 * @param {string} pageTitle - Title of the report.
 * @param {string} filename - Desired output filename.
 * @param {Object} options - Export options.
 */
export const generateExcel = async (
  data,
  columns,
  pageTitle,
  filename,
  options = {}
) => {
  const {
    includeHeader = true,
    includeFooter = true,
    dateFormat = 'yyyy-mm-dd',
    currencyFormat = '"$"#,##0.00',
    percentFormat = '0.0%',
    facilityName = 'Main Facility',
    userName = 'System User',
  } = options;

  // Create a new workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'RANAW SYSTEM';
  workbook.created = new Date();
  
  const worksheet = workbook.addWorksheet(pageTitle.substring(0, 31)); // Max sheet name length is 31

  // Setup Print Area & Landscape
  worksheet.pageSetup.orientation = 'landscape';
  worksheet.pageSetup.fitToPage = true;
  worksheet.pageSetup.fitToWidth = 1;
  worksheet.pageSetup.fitToHeight = 0;
  worksheet.properties.defaultRowHeight = 20;

  // Track the current row for insertion
  let currentRow = 1;

  if (includeHeader) {
    // Row 1: RANAW SYSTEM Brand Header
    worksheet.mergeCells(`A${currentRow}:C${currentRow}`);
    const titleCell = worksheet.getCell(`A${currentRow}`);
    titleCell.value = 'RANAW SYSTEM';
    titleCell.font = { name: 'Arial', family: 2, size: 16, bold: true, color: { argb: 'FF6D28D9' } }; // Violet-700
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(currentRow).height = 30;
    currentRow++;

    // Row 2: Page Title
    worksheet.mergeCells(`A${currentRow}:F${currentRow}`);
    const subTitleCell = worksheet.getCell(`A${currentRow}`);
    subTitleCell.value = `${pageTitle} - Export Report`;
    subTitleCell.font = { name: 'Arial', family: 2, size: 14, bold: true };
    subTitleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    worksheet.getRow(currentRow).height = 25;
    currentRow++;

    // Row 3: Meta Info
    const isoDate = new Date().toISOString().split('T')[0];
    worksheet.mergeCells(`A${currentRow}:H${currentRow}`);
    const metaCell = worksheet.getCell(`A${currentRow}`);
    metaCell.value = `Generated: ${isoDate} | Facility: ${facilityName} | Exported by: ${userName}`;
    metaCell.font = { name: 'Arial', family: 2, size: 10, italic: true, color: { argb: 'FF475569' } }; // Slate-600
    metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
    currentRow++;

    // Row 4: Empty space
    currentRow++;
  }

  // Row 5: Column Headers
  const headerRowIndex = currentRow;
  const headerRow = worksheet.getRow(headerRowIndex);
  
  columns.forEach((col, index) => {
    const colNumber = index + 1;
    const cell = headerRow.getCell(colNumber);
    cell.value = col.label;
    cell.font = { name: 'Arial', family: 2, size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate-800
    };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Set column width
    worksheet.getColumn(colNumber).width = col.width || 20;
  });
  headerRow.height = 25;
  currentRow++;

  // Freeze top rows (1 through Header Row)
  worksheet.views = [
    { state: 'frozen', xSplit: 0, ySplit: headerRowIndex }
  ];

  // Disable gridlines
  worksheet.properties.showGridLines = false;

  // Insert Data Rows
  // Chunk processing could be implemented here for very large datasets (> 50k rows),
  // but ExcelJS handles moderate sizes well. We add sequentially.
  data.forEach((rowRecord) => {
    const dataRow = worksheet.getRow(currentRow);
    columns.forEach((col, index) => {
      const colNumber = index + 1;
      const cell = dataRow.getCell(colNumber);
      
      let rawValue = rowRecord[col.key];
      
      // Handle Formatting based on Schema
      if (rawValue !== null && rawValue !== undefined) {
        if (col.format === FORMATS.DATE) {
          cell.value = new Date(rawValue);
          cell.numFmt = dateFormat;
        } else if (col.format === FORMATS.CURRENCY) {
          cell.value = parseFloat(rawValue);
          cell.numFmt = currencyFormat;
        } else if (col.format === FORMATS.PERCENT) {
          cell.value = parseFloat(rawValue);
          cell.numFmt = percentFormat;
        } else {
          cell.value = rawValue;
        }
      } else {
        cell.value = '';
      }

      // Default data cell styling
      cell.font = { name: 'Arial', family: 2, size: 10 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, // Slate-200
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      
      // Align numbers right, text left
      if ([FORMATS.CURRENCY, FORMATS.PERCENT].includes(col.format)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (col.format === FORMATS.DATE) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }
    });
    currentRow++;
  });

  // Footer Row
  if (includeFooter) {
    currentRow++; // add an empty row
    worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
    const footerCell = worksheet.getCell(`A${currentRow}`);
    footerCell.value = 'End of Report | RANAW SYSTEM © 2026';
    footerCell.font = { name: 'Arial', family: 2, size: 9, italic: true, color: { argb: 'FF94A3B8' } }; // Slate-400
    footerCell.alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Generate ArrayBuffer and save using file-saver
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `${filename || pageTitle.replace(/\s+/g, '_')}.xlsx`);
};
