'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(PROJECT_ROOT, 'source', 'products.csv');
const EXAMPLE_CSV_PATH = path.join(PROJECT_ROOT, 'source', 'products.csv.example');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field.');
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header, index) => (
    index === 0 ? header.replace(/^\uFEFF/, '').trim() : header.trim()
  ));
  const records = rows.slice(1).map((cells, rowIndex) => {
    const record = { __row: rowIndex + 2 };
    headers.forEach((header, index) => {
      record[header] = (cells[index] || '').trim();
    });
    if (cells.length > headers.length) {
      record.__extraColumns = cells.length - headers.length;
    }
    return record;
  });
  return { headers, records };
}

function readCatalog(root = PROJECT_ROOT) {
  const csvPath = path.join(root, 'source', 'products.csv');
  const examplePath = path.join(root, 'source', 'products.csv.example');
  if (fs.existsSync(csvPath)) {
    return {
      ...parseCsv(fs.readFileSync(csvPath, 'utf8')),
      path: csvPath,
      isExample: false,
    };
  }
  if (fs.existsSync(examplePath)) {
    return {
      ...parseCsv(fs.readFileSync(examplePath, 'utf8')),
      path: examplePath,
      isExample: true,
    };
  }
  return {
    headers: [],
    records: [],
    path: csvPath,
    isExample: false,
    missing: true,
  };
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function markdownTable(headers, rows) {
  if (rows.length === 0) {
    return '_沒有可列出的項目。_';
  }
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
  ].join('\n');
}

function writeReport(root, filename, content) {
  const outputPath = path.join(root, filename);
  fs.writeFileSync(outputPath, `${content.trim()}\n`, 'utf8');
  return outputPath;
}

module.exports = {
  EXAMPLE_CSV_PATH,
  PROJECT_ROOT,
  CSV_PATH,
  escapeMarkdown,
  markdownTable,
  parseCsv,
  readCatalog,
  writeReport,
};
