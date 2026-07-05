import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { format } from "date-fns";
import { tsToDate } from "../admin/inventoryHelpers";

export async function exportEquipmentReportsExcel({ reportFilteredBorrows, reportFilteredSales, reportRange }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RANAW PICKLEBALL COURT";
  workbook.lastModifiedBy = "System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // Create Renting History Sheet
  const rentSheet = workbook.addWorksheet("Renting History");
  
  // Title and Timestamp Header for Renting
  rentSheet.mergeCells("A1:G1");
  const rentTitle = rentSheet.getCell("A1");
  rentTitle.value = "RANAW PICKLEBALL COURT - EQUIPMENT RENTING REPORT";
  rentTitle.font = { name: "Arial", family: 4, size: 14, bold: true };
  rentTitle.alignment = { horizontal: "center" };

  rentSheet.mergeCells("A2:G2");
  const rentDateStr = rentSheet.getCell("A2");
  rentDateStr.value = `Exported on: ${format(new Date(), "PPpp")}`;
  rentDateStr.font = { name: "Arial", italic: true };
  rentDateStr.alignment = { horizontal: "center" };

  rentSheet.mergeCells("A3:G3");
  const rentPeriod = rentSheet.getCell("A3");
  rentPeriod.value = `Report Period: ${format(reportRange.start, "MMM d, yyyy")} - ${format(reportRange.end, "MMM d, yyyy")}`;
  rentPeriod.alignment = { horizontal: "center" };

  rentSheet.addRow([]); // Empty row for spacing

  // Define Columns for Renting
  rentSheet.columns = [
    { header: "Borrower", key: "borrower", width: 25 },
    { header: "Items", key: "items", width: 40 },
    { header: "Borrowed At", key: "borrowedAt", width: 22 },
    { header: "Returned At", key: "returnedAt", width: 22 },
    { header: "Rental Fee", key: "rentalFee", width: 15 },
    { header: "Overdue Fine", key: "overdueFine", width: 15 },
    { header: "Total Charge", key: "totalCharge", width: 15 },
  ];

  // Style Header Row
  const rentHeaderRow = rentSheet.getRow(5);
  rentHeaderRow.font = { bold: true };
  rentHeaderRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  // Add Renting Data
  reportFilteredBorrows.forEach((b) => {
    const itemsStr = (b.items || []).map((l) => `${l.itemName} x${l.quantity}`).join(", ");
    const borrowedStr = format(tsToDate(b.borrowedAt) || new Date(), "MMM d, yyyy HH:mm");
    const returnedStr = b.actualReturnAt ? format(tsToDate(b.actualReturnAt) || new Date(), "MMM d, yyyy HH:mm") : "—";
    
    const row = rentSheet.addRow({
      borrower: b.renterName || b.borrowerName || "Unknown",
      items: itemsStr,
      borrowedAt: borrowedStr,
      returnedAt: returnedStr,
      rentalFee: b.rentalCharge != null ? Number(b.rentalCharge) : 0,
      overdueFine: b.overdueCharge != null ? Number(b.overdueCharge) : 0,
      totalCharge: b.totalCharge != null ? Number(b.totalCharge) : 0,
    });
    
    // Format money columns
    row.getCell(5).numFmt = "₱#,##0.00";
    row.getCell(6).numFmt = "₱#,##0.00";
    row.getCell(7).numFmt = "₱#,##0.00";
  });


  // Create Sales History Sheet
  const salesSheet = workbook.addWorksheet("Sales History");

  // Title and Timestamp Header for Sales
  salesSheet.mergeCells("A1:E1");
  const salesTitle = salesSheet.getCell("A1");
  salesTitle.value = "RANAW PICKLEBALL COURT - EQUIPMENT SALES REPORT";
  salesTitle.font = { name: "Arial", family: 4, size: 14, bold: true };
  salesTitle.alignment = { horizontal: "center" };

  salesSheet.mergeCells("A2:E2");
  const salesDateStr = salesSheet.getCell("A2");
  salesDateStr.value = `Exported on: ${format(new Date(), "PPpp")}`;
  salesDateStr.font = { name: "Arial", italic: true };
  salesDateStr.alignment = { horizontal: "center" };

  salesSheet.mergeCells("A3:E3");
  const salesPeriod = salesSheet.getCell("A3");
  salesPeriod.value = `Report Period: ${format(reportRange.start, "MMM d, yyyy")} - ${format(reportRange.end, "MMM d, yyyy")}`;
  salesPeriod.alignment = { horizontal: "center" };

  salesSheet.addRow([]); // Empty row for spacing

  // Define Columns for Sales
  salesSheet.columns = [
    { header: "Customer Name", key: "customer", width: 25 },
    { header: "Item Purchased", key: "item", width: 30 },
    { header: "Quantity", key: "qty", width: 12 },
    { header: "Date", key: "date", width: 22 },
    { header: "Total Paid", key: "total", width: 15 },
  ];

  // Style Header Row
  const salesHeaderRow = salesSheet.getRow(5);
  salesHeaderRow.font = { bold: true };
  salesHeaderRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  // Add Sales Data
  reportFilteredSales.forEach((s) => {
    const dateStr = format(tsToDate(s.createdAt) || (s.timestampMs ? new Date(s.timestampMs) : new Date()), "MMM d, yyyy HH:mm");
    
    const row = salesSheet.addRow({
      customer: s.buyerName || "Unknown",
      item: s.itemName || "Item",
      qty: s.quantity || 1,
      date: dateStr,
      total: s.total != null ? Number(s.total) : 0,
    });
    
    // Format money column
    row.getCell(5).numFmt = "₱#,##0.00";
  });

  // Export File
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveAs(blob, `Equipment_Reports_${format(new Date(), "yyyy-MM-dd_HHmm")}.xlsx`);
}
