import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseBoqSpreadsheetBase64 } from '../modules/boq/boq.service';

describe('BOQ spreadsheet parser (exceljs)', () => {
  it('parses an .xlsx workbook, including formula results', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BOQ');
    ws.addRow(['WBS', 'Section', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount']);
    ws.addRow(['02.01.1', 'DRAINAGE', 'Reinforced concrete box culvert', 'm3', 120, 85000]);
    ws.getCell('G2').value = { formula: 'E2*F2', result: 10200000 };
    ws.addRow(['', '', '', '', '', '', '']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const items = await parseBoqSpreadsheetBase64(buffer.toString('base64'));
    assert.equal(items.length, 1);
    assert.equal(items[0].wbsCode, '02.01.1');
    assert.equal(items[0].totalQuantity, 120);
    assert.equal(items[0].budgetedCostNgn, 10200000);
  });

  it('parses a .csv file', async () => {
    const csv = 'WBS,Section,Description,Unit,Quantity,Rate\n03.01,EARTHWORKS,Bulk excavation to formation level,m3,500,4500\n';
    const items = await parseBoqSpreadsheetBase64(Buffer.from(csv).toString('base64'));
    assert.equal(items.length, 1);
    assert.equal(items[0].budgetedCostNgn, 500 * 4500);
  });

  it('rejects a file that is neither xlsx nor csv content', async () => {
    await assert.rejects(
      parseBoqSpreadsheetBase64(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]).toString('base64')),
      /Could not read the BOQ file/
    );
  });
});
