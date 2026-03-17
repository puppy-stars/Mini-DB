import { DatabaseType } from '../models/types';

export class SqlEscape {
  private static readonly VALID_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  private static readonly MAX_IDENTIFIER_LENGTH = 128;

  static escapeIdentifier(identifier: string, dbType: DatabaseType): string {
    if (!identifier || identifier.length === 0) {
      throw new Error('Identifier cannot be empty');
    }

    if (identifier.length > this.MAX_IDENTIFIER_LENGTH) {
      throw new Error(`Identifier exceeds maximum length of ${this.MAX_IDENTIFIER_LENGTH}`);
    }

    if (!this.VALID_IDENTIFIER_REGEX.test(identifier)) {
      throw new Error(`Invalid identifier: "${identifier}". Only alphanumeric characters and underscores are allowed, and it must start with a letter or underscore.`);
    }

    switch (dbType) {
      case 'mysql':
        return `\`${identifier.replace(/`/g, '``')}\``;
      case 'postgresql':
      case 'sqlite':
      case 'oracle':
        return `"${identifier.replace(/"/g, '""')}"`;
      case 'sqlserver':
        return `[${identifier.replace(/]/g, ']]')}]`;
      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
  }

  static escapeTableName(tableName: string, dbType: DatabaseType, schema?: string): string {
    const escapedTable = this.escapeIdentifier(tableName, dbType);
    
    if (schema) {
      const escapedSchema = this.escapeIdentifier(schema, dbType);
      return `${escapedSchema}.${escapedTable}`;
    }
    
    return escapedTable;
  }

  static escapeColumnName(columnName: string, dbType: DatabaseType): string {
    return this.escapeIdentifier(columnName, dbType);
  }

  static escapeDatabaseName(databaseName: string, dbType: DatabaseType): string {
    return this.escapeIdentifier(databaseName, dbType);
  }

  static isValidIdentifier(identifier: string): boolean {
    if (!identifier || identifier.length === 0 || identifier.length > this.MAX_IDENTIFIER_LENGTH) {
      return false;
    }
    return this.VALID_IDENTIFIER_REGEX.test(identifier);
  }

  static safeStringLiteral(value: string, dbType: DatabaseType): string {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }

  static buildSelectQuery(
    tableName: string,
    dbType: DatabaseType,
    options: {
      columns?: string[];
      where?: string;
      orderBy?: string;
      limit?: number;
      offset?: number;
      schema?: string;
    } = {}
  ): string {
    const safeLimit = options.limit !== undefined ? this.ensureNonNegativeInteger(options.limit, 'limit') : undefined;
    const safeOffset = options.offset !== undefined ? this.ensureNonNegativeInteger(options.offset, 'offset') : undefined;

    const escapedTable = this.escapeTableName(tableName, dbType, options.schema);
    
    let columns = '*';
    if (options.columns && options.columns.length > 0) {
      columns = options.columns
        .map(col => this.escapeColumnName(col, dbType))
        .join(', ');
    }
    
    let sql = `SELECT ${columns} FROM ${escapedTable}`;
    
    if (options.where) {
      sql += ` WHERE ${options.where}`;
    }
    
    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy}`;
    }
    
    if (safeLimit !== undefined) {
      switch (dbType) {
        case 'mysql':
        case 'postgresql':
        case 'sqlite':
          sql += ` LIMIT ${safeLimit}`;
          if (safeOffset !== undefined) {
            sql += ` OFFSET ${safeOffset}`;
          }
          break;
        case 'sqlserver': {
          const offset = safeOffset ?? 0;
          if (!options.orderBy) {
            sql += ' ORDER BY (SELECT NULL)';
          }
          sql += ` OFFSET ${offset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
          break;
        }
        case 'oracle': {
          const offset = safeOffset ?? 0;
          sql += ` OFFSET ${offset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
          break;
        }
        default:
          throw new Error(`Unsupported database type: ${dbType}`);
      }
    }
    
    return sql;
  }

  static buildPaginatedQuery(baseSql: string, dbType: DatabaseType, limit: number, offset: number = 0): string {
    const safeLimit = this.ensureNonNegativeInteger(limit, 'limit');
    const safeOffset = this.ensureNonNegativeInteger(offset, 'offset');
    const normalized = baseSql.replace(/;?\s*$/, '').trim();

    switch (dbType) {
      case 'mysql':
      case 'postgresql':
      case 'sqlite':
        // Always paginate on an outer query to avoid syntax errors when base SQL
        // already contains LIMIT/OFFSET.
        return `SELECT * FROM (${normalized}) AS minidb_paginated LIMIT ${safeLimit} OFFSET ${safeOffset}`;
      case 'sqlserver':
        return `SELECT * FROM (${normalized}) minidb_paginated ORDER BY (SELECT NULL) OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
      case 'oracle':
        return `SELECT * FROM (${normalized}) minidb_paginated OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
      default:
        throw new Error(`Unsupported database type: ${dbType}`);
    }
  }

  static buildCountQuery(baseSql: string, dbType: DatabaseType): string {
    const normalized = baseSql.replace(/;?\s*$/, '').trim();
    if (dbType === 'oracle') {
      return `SELECT COUNT(*) AS total FROM (${normalized}) minidb_count`;
    }
    return `SELECT COUNT(*) AS total FROM (${normalized}) AS minidb_count`;
  }

  private static ensureNonNegativeInteger(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }
}
