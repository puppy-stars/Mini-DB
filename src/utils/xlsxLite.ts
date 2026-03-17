import { inflateRawSync } from 'zlib';

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface CellValue {
  colIndex: number;
  value: string;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIR_HEADER = 0x02014b50;
const ZIP_END_CENTRAL_DIR = 0x06054b50;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function writeUint16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeUint32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ -1) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error('Invalid XLSX file: end of central directory not found');
}

function unzipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const centralDirectorySize = readUint32LE(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32LE(view, eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  let pointer = centralDirectoryOffset;
  while (pointer < centralDirectoryEnd) {
    const signature = readUint32LE(view, pointer);
    if (signature !== ZIP_CENTRAL_DIR_HEADER) {
      throw new Error('Invalid XLSX file: central directory entry is corrupted');
    }

    const compressionMethod = readUint16LE(view, pointer + 10);
    const compressedSize = readUint32LE(view, pointer + 20);
    const uncompressedSize = readUint32LE(view, pointer + 24);
    const fileNameLength = readUint16LE(view, pointer + 28);
    const extraLength = readUint16LE(view, pointer + 30);
    const commentLength = readUint16LE(view, pointer + 32);
    const localHeaderOffset = readUint32LE(view, pointer + 42);
    const fileNameStart = pointer + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = decodeUtf8(bytes.slice(fileNameStart, fileNameEnd));

    const localSignature = readUint32LE(view, localHeaderOffset);
    if (localSignature !== ZIP_LOCAL_FILE_HEADER) {
      throw new Error(`Invalid XLSX file: local header missing for ${fileName}`);
    }

    const localNameLength = readUint16LE(view, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

    let content: Uint8Array;
    if (compressionMethod === ZIP_STORE) {
      content = compressedData;
    } else if (compressionMethod === ZIP_DEFLATE) {
      content = new Uint8Array(inflateRawSync(compressedData));
    } else {
      throw new Error(`Unsupported XLSX compression method: ${compressionMethod}`);
    }

    if (content.length !== uncompressedSize) {
      // Keep parsing but warn by throwing for malformed workbooks.
      throw new Error(`Corrupted XLSX entry size for ${fileName}`);
    }

    entries.set(fileName, content);
    pointer += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function zipEntries(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32LE(localView, 0, ZIP_LOCAL_FILE_HEADER);
    writeUint16LE(localView, 4, 20);
    writeUint16LE(localView, 6, 0);
    writeUint16LE(localView, 8, ZIP_STORE);
    writeUint16LE(localView, 10, 0);
    writeUint16LE(localView, 12, 0);
    writeUint32LE(localView, 14, checksum);
    writeUint32LE(localView, 18, data.length);
    writeUint32LE(localView, 22, data.length);
    writeUint16LE(localView, 26, nameBytes.length);
    writeUint16LE(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32LE(centralView, 0, ZIP_CENTRAL_DIR_HEADER);
    writeUint16LE(centralView, 4, 20);
    writeUint16LE(centralView, 6, 20);
    writeUint16LE(centralView, 8, 0);
    writeUint16LE(centralView, 10, ZIP_STORE);
    writeUint16LE(centralView, 12, 0);
    writeUint16LE(centralView, 14, 0);
    writeUint32LE(centralView, 16, checksum);
    writeUint32LE(centralView, 20, data.length);
    writeUint32LE(centralView, 24, data.length);
    writeUint16LE(centralView, 28, nameBytes.length);
    writeUint16LE(centralView, 30, 0);
    writeUint16LE(centralView, 32, 0);
    writeUint16LE(centralView, 34, 0);
    writeUint16LE(centralView, 36, 0);
    writeUint32LE(centralView, 38, 0);
    writeUint32LE(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const localData = concatBytes(localParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32LE(endView, 0, ZIP_END_CENTRAL_DIR);
  writeUint16LE(endView, 4, 0);
  writeUint16LE(endView, 6, 0);
  writeUint16LE(endView, 8, entries.length);
  writeUint16LE(endView, 10, entries.length);
  writeUint32LE(endView, 12, centralDirectory.length);
  writeUint32LE(endView, 16, localData.length);
  writeUint16LE(endView, 20, 0);

  return concatBytes([localData, centralDirectory, endRecord]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

function columnIndexToName(index: number): string {
  let result = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function columnNameToIndex(name: string): number {
  let value = 0;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      value = value * 26 + (code - 64);
    }
  }
  return Math.max(0, value - 1);
}

function buildCellXml(cellRef: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `<c r="${cellRef}"/>`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${cellRef}"><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${cellRef}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${cellRef}" t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function normalizeCellValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return value;
}

function buildWorksheetXml(headers: string[], rows: unknown[][]): string {
  let sheetRowsXml = '';
  const allRows = [headers, ...rows];

  for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
    const rowNumber = rowIndex + 1;
    const rowValues = allRows[rowIndex];
    let cellsXml = '';
    for (let colIndex = 0; colIndex < rowValues.length; colIndex++) {
      const cellRef = `${columnIndexToName(colIndex)}${rowNumber}`;
      cellsXml += buildCellXml(cellRef, normalizeCellValue(rowValues[colIndex]));
    }
    sheetRowsXml += `<row r="${rowNumber}">${cellsXml}</row>`;
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${sheetRowsXml}</sheetData>` +
    '</worksheet>'
  );
}

function getWorksheetPath(files: Map<string, Uint8Array>): string {
  const workbookPath = 'xl/workbook.xml';
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const workbookXml = files.get(workbookPath);
  const relsXml = files.get(relsPath);
  if (!workbookXml || !relsXml) {
    return 'xl/worksheets/sheet1.xml';
  }

  const workbookText = decodeUtf8(workbookXml);
  const relsText = decodeUtf8(relsXml);
  const sheetMatch = workbookText.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/i);
  if (!sheetMatch) {
    return 'xl/worksheets/sheet1.xml';
  }

  const relId = sheetMatch[1];
  const relRegex = new RegExp(
    `<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"[^>]*>`,
    'i'
  );
  const relMatch = relsText.match(relRegex);
  if (!relMatch) {
    return 'xl/worksheets/sheet1.xml';
  }

  const target = relMatch[1].replace(/^\/+/, '');
  return target.startsWith('xl/') ? target : `xl/${target}`;
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let siMatch: RegExpExecArray | null;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tMatch: RegExpExecArray | null;
    let text = '';
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      text += decodeXml(tMatch[1]);
    }
    values.push(text);
  }
  return values;
}

function parseRowCells(rowXml: string, sharedStrings: string[]): CellValue[] {
  const cells: CellValue[] = [];
  const cellRegex = /<c\b([^>]*?)>([\s\S]*?)<\/c>|<c\b([^>]*?)\/>/gi;
  let match: RegExpExecArray | null;
  let fallbackColIndex = 0;

  while ((match = cellRegex.exec(rowXml)) !== null) {
    const attrs = (match[1] || match[3] || '').trim();
    const inner = match[2] || '';
    const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
    const typeMatch = attrs.match(/\bt="([^"]+)"/i);
    const type = typeMatch ? typeMatch[1] : '';
    const colIndex = refMatch ? columnNameToIndex(refMatch[1].toUpperCase()) : fallbackColIndex++;

    let value = '';
    if (type === 'inlineStr') {
      const tMatches = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)];
      value = tMatches.map(item => decodeXml(item[1])).join('');
    } else {
      const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
      if (vMatch) {
        value = decodeXml(vMatch[1]);
      }
      if (type === 's') {
        const idx = Number(value);
        value = Number.isInteger(idx) && idx >= 0 && idx < sharedStrings.length ? sharedStrings[idx] : '';
      } else if (type === 'b') {
        value = value === '1' ? 'TRUE' : 'FALSE';
      }
    }

    cells.push({ colIndex, value });
  }

  return cells;
}

function parseWorksheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const cells = parseRowCells(rowContent, sharedStrings);
    if (cells.length === 0) {
      rows.push([]);
      continue;
    }

    const maxCol = Math.max(...cells.map(cell => cell.colIndex));
    const rowValues = Array.from({ length: maxCol + 1 }, () => '');
    for (const cell of cells) {
      rowValues[cell.colIndex] = cell.value;
    }
    rows.push(rowValues);
  }

  return rows;
}

export function createXlsx(headers: string[], rowValues: unknown[][]): Uint8Array {
  const safeHeaders = headers.map(header => String(header ?? '').replace(/^\uFEFF/, '').trim());
  const sheetXml = buildWorksheetXml(safeHeaders, rowValues);
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: encodeUtf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>'
      )
    },
    {
      name: '_rels/.rels',
      data: encodeUtf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      )
    },
    {
      name: 'xl/workbook.xml',
      data: encodeUtf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="QueryResults" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>'
      )
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encodeUtf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      )
    },
    {
      name: 'xl/styles.xml',
      data: encodeUtf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
          '<borders count="1"><border/></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
          '</styleSheet>'
      )
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: encodeUtf8(sheetXml)
    }
  ];

  return zipEntries(entries);
}

export function parseXlsx(bytes: Uint8Array): { headers: string[]; rows: Record<string, string>[] } {
  const files = unzipEntries(bytes);
  const sheetPath = getWorksheetPath(files);
  const sheetData = files.get(sheetPath) || files.get('xl/worksheets/sheet1.xml');
  if (!sheetData) {
    throw new Error('Invalid XLSX file: worksheet not found');
  }

  const sharedStringsXml = files.get('xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? parseSharedStrings(decodeUtf8(sharedStringsXml)) : [];
  const sheetXml = decodeUtf8(sheetData);
  const rows = parseWorksheetRows(sheetXml, sharedStrings);

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((header, index) => {
    const normalized = index === 0 ? header.replace(/^\uFEFF/, '') : header;
    const trimmed = normalized.trim();
    return trimmed.length > 0 ? trimmed : `column_${index + 1}`;
  });

  const mappedRows = rows.slice(1)
    .filter(row => row.some(cell => String(cell || '').trim().length > 0))
    .map(row => {
      const mapped: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        mapped[headers[i]] = row[i] ?? '';
      }
      return mapped;
    });

  return { headers, rows: mappedRows };
}
