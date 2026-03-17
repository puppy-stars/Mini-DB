import { QueryResult } from '../models/types';
import { createXlsx } from './xlsxLite';

export type ExportFormat = 'csv' | 'json' | 'excel' | 'xlsx';

export interface ExportOptions {
  format: ExportFormat;
  includeHeaders: boolean;
  dateFormat?: string;
}

export class DataExporter {
  static toCSV(result: QueryResult, options: ExportOptions = { format: 'csv', includeHeaders: true }): string {
    const lines: string[] = [];
    
    if (options.includeHeaders) {
      lines.push(result.columns.map(col => this.escapeCSVField(col)).join(','));
    }
    
    for (const row of result.rows) {
      const values = result.columns.map(col => {
        const value = row[col];
        return this.formatCSVValue(value);
      });
      lines.push(values.join(','));
    }
    
    return lines.join('\n');
  }

  static toJSON(result: QueryResult, options: ExportOptions = { format: 'json', includeHeaders: true }): string {
    if (options.includeHeaders) {
      return JSON.stringify(result.rows, null, 2);
    }
    
    const values = result.rows.map(row => 
      result.columns.map(col => row[col])
    );
    return JSON.stringify(values, null, 2);
  }

  static toExcelXML(result: QueryResult, options: ExportOptions = { format: 'excel', includeHeaders: true }): string {
    const escapeXML = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
    xml += '<Worksheet ss:Name="Query Results">\n';
    xml += '<Table>\n';

    if (options.includeHeaders) {
      xml += '<Row>\n';
      for (const col of result.columns) {
        xml += `<Cell><Data ss:Type="String">${escapeXML(col)}</Data></Cell>\n`;
      }
      xml += '</Row>\n';
    }

    for (const row of result.rows) {
      xml += '<Row>\n';
      for (const col of result.columns) {
        const value = row[col];
        const { type, content } = this.formatExcelValue(value);
        xml += `<Cell><Data ss:Type="${type}">${escapeXML(content)}</Data></Cell>\n`;
      }
      xml += '</Row>\n';
    }

    xml += '</Table>\n';
    xml += '</Worksheet>\n';
    xml += '</Workbook>';

    return xml;
  }

  static toXLSX(result: QueryResult, options: ExportOptions = { format: 'xlsx', includeHeaders: true }): Uint8Array {
    const headers = options.includeHeaders ? result.columns : result.columns.map((_, index) => `col_${index + 1}`);
    const rows = result.rows.map(row => result.columns.map(col => row[col]));
    return createXlsx(headers, rows);
  }

  static export(result: QueryResult, options: ExportOptions): string | Uint8Array {
    switch (options.format) {
      case 'csv':
        return this.toCSV(result, options);
      case 'json':
        return this.toJSON(result, options);
      case 'excel':
        return this.toExcelXML(result, options);
      case 'xlsx':
        return this.toXLSX(result, options);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  static getFileExtension(format: ExportFormat): string {
    switch (format) {
      case 'csv':
        return '.csv';
      case 'json':
        return '.json';
      case 'excel':
        return '.xml';
      case 'xlsx':
        return '.xlsx';
      default:
        return '.txt';
    }
  }

  static getMimeType(format: ExportFormat): string {
    switch (format) {
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      case 'excel':
        return 'application/xml';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default:
        return 'text/plain';
    }
  }

  private static escapeCSVField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  private static formatCSVValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    
    if (value instanceof Date) {
      return this.escapeCSVField(value.toISOString());
    }
    
    if (typeof value === 'object') {
      return this.escapeCSVField(JSON.stringify(value));
    }
    
    const strValue = String(value);
    return this.escapeCSVField(strValue);
  }

  private static formatExcelValue(value: unknown): { type: string; content: string } {
    if (value === null || value === undefined) {
      return { type: 'String', content: '' };
    }
    
    if (typeof value === 'number') {
      return { type: 'Number', content: String(value) };
    }
    
    if (typeof value === 'boolean') {
      return { type: 'Boolean', content: value ? '1' : '0' };
    }
    
    if (value instanceof Date) {
      return { type: 'DateTime', content: value.toISOString() };
    }
    
    if (typeof value === 'object') {
      return { type: 'String', content: JSON.stringify(value) };
    }
    
    return { type: 'String', content: String(value) };
  }
}
