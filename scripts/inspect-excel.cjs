const ExcelJS = require('exceljs');
const fs = require('fs');
(async () => {
  const files = [
    '/home/z/my-project/upload/Registration sheet ES -2025.xlsx',
    '/home/z/my-project/upload/HRBL_0004_FO_001  (السلامه الكهربيه)نموذج طلب دورة تدريبية.xlsx',
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    console.log('\n=== ' + f.split('/').pop() + ' ===');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    const ws = wb.worksheets[0];
    console.log(`rowCount: ${ws.rowCount}, columnCount: ${ws.columnCount}`);
    console.log('First 10 rows:');
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= Math.min(15, row.cellCount); c++) {
        const v = row.getCell(c).value;
        let s = '';
        if (v === null || v === undefined) s = '';
        else if (typeof v === 'object') {
          if (v.text) s = String(v.text);
          else if (v.result !== undefined) s = String(v.result);
          else if (v.richText) s = v.richText.map(r => r.text).join('');
          else s = JSON.stringify(v);
        } else s = String(v);
        if (s.length > 30) s = s.slice(0, 30) + '…';
        cells.push(`[${c}]${s}`);
      }
      console.log(`  R${r}: ${cells.join(' | ')}`);
    }
    // Also show merged cells
    console.log('Merged cells:', Object.keys(ws._merges || {}).slice(0, 10).join(', '));
  }
})();
