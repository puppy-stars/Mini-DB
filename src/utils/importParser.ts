import { parseXlsx } from './xlsxLite';

export interface ParsedImportData {
  headers: string[];
  rows: Record<string, string>[];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

export function parseCsv(content: string): ParsedImportData {
  const rows = parseCsvRows(content);
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((header, index) => {
    const normalized = index === 0 ? header.replace(/^\uFEFF/, '') : header;
    return normalized.trim();
  });

  const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim().length > 0));
  const mappedRows = dataRows.map(row => {
    const mapped: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      mapped[headers[i]] = row[i] ?? '';
    }
    return mapped;
  });

  return { headers, rows: mappedRows };
}

export function parseExcelXml(content: string): ParsedImportData {
  const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/gi;
  const cellRegex = /<Data[^>]*>([\s\S]*?)<\/Data>/gi;

  const allRows: string[][] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(content)) !== null) {
    const rowContent = rowMatch[1];
    const values: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      values.push(decodeXmlEntities(cellMatch[1]).trim());
    }
    if (values.length > 0) {
      allRows.push(values);
    }
  }

  if (allRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = allRows[0].map(header => header.replace(/^\uFEFF/, '').trim());
  const mappedRows = allRows.slice(1).map(row => {
    const mapped: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      mapped[headers[i]] = row[i] ?? '';
    }
    return mapped;
  });

  return { headers, rows: mappedRows };
}

export function parseImportFile(content: string | Uint8Array, extension: string): ParsedImportData {
  const ext = extension.toLowerCase();
  if (ext === '.csv') {
    const text = typeof content === 'string' ? content : new TextDecoder('utf-8').decode(content);
    return parseCsv(text);
  }
  if (ext === '.xml') {
    const text = typeof content === 'string' ? content : new TextDecoder('utf-8').decode(content);
    return parseExcelXml(text);
  }
  if (ext === '.xlsx') {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return parseXlsx(bytes);
  }
  throw new Error(`Unsupported import format: ${extension}`);
}
