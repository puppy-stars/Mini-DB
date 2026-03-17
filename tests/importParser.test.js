const assert = require('node:assert/strict');

const { parseImportFile } = require('../out/utils/importParser');
const { createXlsx } = require('../out/utils/xlsxLite');

(() => {
  const csv = '\uFEFFname,age,note\n"Alice",30,"hello"\n"Bob, Jr.",31,"line 1"\n';
  const parsed = parseImportFile(csv, '.csv');

  assert.deepEqual(parsed.headers, ['name', 'age', 'note']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].name, 'Alice');
  assert.equal(parsed.rows[1].name, 'Bob, Jr.');
  console.log('importParser CSV test passed');
})();

(() => {
  const xlsx = createXlsx(
    ['id', 'name', 'enabled'],
    [
      [1, 'MiniDB', true],
      [2, 'Agent', false]
    ]
  );

  const parsed = parseImportFile(xlsx, '.xlsx');
  assert.deepEqual(parsed.headers, ['id', 'name', 'enabled']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].id, '1');
  assert.equal(parsed.rows[0].name, 'MiniDB');
  assert.equal(parsed.rows[0].enabled, 'TRUE');
  console.log('importParser XLSX test passed');
})();
