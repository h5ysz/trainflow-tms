const ExcelJS = require('exceljs');

async function inspect(path, label) {
  console.log(`\n=== ${label} ===`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  console.log(`Sheets: ${wb.worksheets.length}`);
  for (const ws of wb.worksheets) {
    console.log(`\n  Sheet: "${ws.name}" (${ws.rowCount} rows, ${ws.columnCount} cols)`);
    // Print header row
    const header = ws.getRow(1).values;
    console.log(`  Headers: ${header.filter(Boolean).join(' | ')}`);
    // Print first data row
    if (ws.rowCount > 1) {
      const row2 = ws.getRow(2).values;
      console.log(`  Row 1:  ${row2.filter(Boolean).join(' | ')}`);
    }
    // Check column widths
    const widths = ws.columns.map(c => Math.round(c.width || 0)).join(', ');
    console.log(`  Col widths: ${widths}`);
    // Check header style
    const hCell = ws.getCell('A1');
    console.log(`  Header font: bold=${hCell.font?.bold}, color=${hCell.font?.color?.argb}`);
    console.log(`  Header fill: ${hCell.fill?.fgColor?.argb}`);
  }
}

(async () => {
  await inspect('/tmp/export-en.xlsx', 'ENGLISH Export');
  await inspect('/tmp/export-ar.xlsx', 'ARABIC Export (all items)');
})();
