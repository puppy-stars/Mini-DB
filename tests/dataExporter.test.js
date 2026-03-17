const assert = require('node:assert/strict');

const { DataExporter } = require('../out/utils/dataExporter');
const { parseXlsx } = require('../out/utils/xlsxLite');

(() => {
  const result = {
    columns: ['id', 'name'],
    rows: [
      { id: 1, name: 'MiniDB' },
      { id: 2, name: 'Codex' }
    ],
    rowCount: 2,
    executionTime: 1
  };

  const csv = DataExporter.export(result, { format: 'csv', includeHeaders: true });
  assert.equal(typeof csv, 'string');
  assert.match(csv, /^id,name/m);
  assert.match(csv, /MiniDB/);
  console.log('dataExporter CSV test passed');
})();

(() => {
  const result = {
    columns: ['id', 'name', 'active'],
    rows: [
      { id: 1, name: 'MiniDB', active: true },
      { id: 2, name: 'Codex', active: false }
    ],
    rowCount: 2,
    executionTime: 1
  };

  const xlsx = DataExporter.export(result, { format: 'xlsx', includeHeaders: true });
  assert.ok(xlsx instanceof Uint8Array);
  assert.ok(xlsx.length > 100);

  const parsed = parseXlsx(xlsx);
  assert.deepEqual(parsed.headers, ['id', 'name', 'active']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].name, 'Codex');
  assert.equal(parsed.rows[1].active, 'FALSE');
  console.log('dataExporter XLSX test passed');
})();
