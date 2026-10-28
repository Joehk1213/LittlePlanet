'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_PRODUCT_ID = 4268n;
const MAX_PRODUCT_ID = 4294n;
const DEFAULT_CSV_PATH = path.join(process.cwd(), 'source', 'products.csv');

function parseCsv(text) {
  const input = text.replace(/^\uFEFF/, '');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;

  function finishField() {
    record.push(field);
    field = '';
    afterQuote = false;
  }

  function finishRecord() {
    finishField();
    if (record.some((value) => value.length > 0)) {
      records.push(record);
    }
    record = [];
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote) {
      if (character === ',') {
        finishField();
      } else if (character === '\n' || character === '\r') {
        if (character === '\r' && input[index + 1] === '\n') {
          index += 1;
        }
        finishRecord();
      } else {
        throw new Error(`Unexpected character after closing quote at character ${index + 1}.`);
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error(`Unexpected quote inside an unquoted field at character ${index + 1}.`);
      }
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') {
        index += 1;
      }
      finishRecord();
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error('CSV ends inside a quoted field.');
  }
  if (afterQuote || field.length > 0 || record.length > 0) {
    finishRecord();
  }
  if (records.length === 0) {
    throw new Error('CSV contains no header row.');
  }

  const headers = records[0].map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    throw new Error('CSV contains an empty column name.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV contains duplicate column names.');
  }

  const rows = records.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(
        `CSV record ${index + 2} has ${values.length} fields; expected ${headers.length}.`
      );
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
  });

  return { headers, rows };
}

function readProductsCsv(filePath = DEFAULT_CSV_PATH) {
  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function parseNonNegativeNumber(value) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isIsoDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }
  const timestamp = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
    value
  );
  if (!timestamp) {
    return false;
  }
  const date = new Date(`${timestamp[1]}T00:00:00.000Z`);
  const offsetHours = timestamp[6] === undefined ? 0 : Number(timestamp[6]);
  const offsetMinutes = timestamp[7] === undefined ? 0 : Number(timestamp[7]);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== timestamp[1] ||
    Number(timestamp[2]) > 23 ||
    Number(timestamp[3]) > 59 ||
    Number(timestamp[4]) > 59 ||
    offsetHours > 14 ||
    offsetMinutes > 59 ||
    (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function validateProductsCsv({ headers, rows }) {
  const errors = [];
  const requiredHeaders = ['id', 'name', 'cost_price', 'stock', 'tier_prices', 'preorder_deadline'];
  const headerSet = new Set(headers);
  for (const header of requiredHeaders) {
    if (!headerSet.has(header)) {
      errors.push(`Missing required column: ${header}`);
    }
  }

  const seenIds = new Set();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const id = row.id;
    if (id !== undefined) {
      if (!/^\d+$/.test(id)) {
        errors.push(`Record ${rowNumber}: id must be an integer bigint.`);
      } else {
        const numericId = BigInt(id);
        if (numericId < MIN_PRODUCT_ID || numericId > MAX_PRODUCT_ID) {
          errors.push(`Record ${rowNumber}: id must be between 4268 and 4294.`);
        }
        const canonicalId = numericId.toString();
        if (seenIds.has(canonicalId)) {
          errors.push(`Record ${rowNumber}: duplicate id ${canonicalId}.`);
        }
        seenIds.add(canonicalId);
      }
    }

    if (row.name !== undefined && row.name.trim().length === 0) {
      errors.push(`Record ${rowNumber}: name must not be empty.`);
    }

    if (row.cost_price !== undefined && parseNonNegativeNumber(row.cost_price) === null) {
      errors.push(`Record ${rowNumber}: cost_price must be a non-negative number.`);
    }

    if (
      row.stock !== undefined &&
      (!/^\d+$/.test(row.stock) || BigInt(row.stock) > 2147483647n)
    ) {
      errors.push(`Record ${rowNumber}: stock must be a non-negative PostgreSQL integer.`);
    }

    if (row.tier_prices !== undefined && row.tier_prices !== '') {
      try {
        JSON.parse(row.tier_prices);
      } catch {
        errors.push(`Record ${rowNumber}: tier_prices must contain valid JSON.`);
      }
    }

    if (
      row.preorder_deadline !== undefined &&
      row.preorder_deadline !== '' &&
      !isIsoDate(row.preorder_deadline)
    ) {
      errors.push(`Record ${rowNumber}: preorder_deadline must be an ISO date or timestamp.`);
    }
  });

  return errors;
}

if (require.main === module) {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV_PATH;
  try {
    const csv = readProductsCsv(filePath);
    const errors = validateProductsCsv(csv);
    console.log(`CSV: ${path.relative(process.cwd(), filePath)}`);
    console.log(`Records: ${csv.rows.length}`);
    console.log(`Columns: ${csv.headers.length}`);
    if (errors.length > 0) {
      for (const error of errors) {
        console.log(`ERROR: ${error}`);
      }
      console.log(`Validation failed: ${errors.length} error(s).`);
      process.exitCode = 1;
    } else {
      console.log('Validation passed.');
    }
  } catch (error) {
    console.error(`Validation could not run: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseCsv,
  readProductsCsv,
  validateProductsCsv,
  parseNonNegativeNumber,
};
