'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, '');
  if (!text) {
    return { headers: [], records: [] };
  }

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\r' || character === '\n') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      if (row.some(value => value.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field.');
  }
  row.push(cell);
  if (row.some(value => value.length > 0)) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map(header => header.trim());
  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has an unexpected number of columns.`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]]));
  });

  return { headers, records };
}

function readProductCatalog(rootDirectory = PROJECT_ROOT) {
  const csvPath = path.join(rootDirectory, 'source', 'products.csv');
  if (!fs.existsSync(csvPath)) {
    return { headers: [], records: [], missing: true, path: csvPath };
  }

  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  return { ...parsed, missing: false, path: csvPath };
}

module.exports = { parseCsv, readProductCatalog };
