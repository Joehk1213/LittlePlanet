'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(PROJECT_ROOT, 'source', 'products.csv');

function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError('CSV input must be text.');
  }

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field.trim());
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote) {
      if (character === ',') {
        finishField();
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') {
          index += 1;
        }
        finishRow();
      } else if (character !== ' ' && character !== '\t') {
        throw new Error('CSV contains unexpected characters after a quoted field.');
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === '"') {
      throw new Error('CSV contains a quote inside an unquoted field.');
    } else if (character === ',') {
      finishField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSV contains an unterminated quoted field.');
  }
  if (field.length > 0 || row.length > 0 || closedQuote) {
    finishRow();
  }
  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = rows[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim()
  );
  if (headers.some((header) => !header)) {
    throw new Error('CSV contains an empty column name.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate column names.');
  }

  const records = rows.slice(1).map((cells, index) => {
    const record = { __row: index + 2 };
    headers.forEach((header, columnIndex) => {
      record[header] = cells[columnIndex] ?? '';
    });
    if (cells.length < headers.length) {
      record.__missingColumns = headers.length - cells.length;
    }
    if (cells.length > headers.length) {
      record.__extraColumns = cells.length - headers.length;
    }
    return record;
  });
  return { headers, records };
}

function readCatalog(root = PROJECT_ROOT) {
  const csvPath = path.join(root, 'source', 'products.csv');
  if (!fs.existsSync(csvPath)) {
    return { headers: [], records: [], path: csvPath, missing: true };
  }
  return {
    ...parseCsv(fs.readFileSync(csvPath, 'utf8')),
    path: csvPath,
    missing: false,
  };
}

function escapeMarkdown(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, ' ');
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

function getHongKongDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

module.exports = {
  CSV_PATH,
  PROJECT_ROOT,
  escapeMarkdown,
  getHongKongDate,
  markdownTable,
  parseCsv,
  readCatalog,
  writeReport,
};
