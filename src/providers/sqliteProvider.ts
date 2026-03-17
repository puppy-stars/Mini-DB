import * as sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import * as path from 'path';
import * as fs from 'fs';
import {
  ConnectionConfig,
  QueryResult,
  TableColumn,
  TableInfo,
  DatabaseInfo,
  ForeignKeyRelation,
  TableIndexInfo,
  TableConstraintInfo,
  RoutineInfo,
  TriggerInfo
} from '../models/types';
import { BaseDatabaseProvider } from './databaseProvider';
import { SqlEscape } from '../utils/sqlEscape';

export class SQLiteProvider extends BaseDatabaseProvider {
  private db: Database | null = null;
  private inTransaction: boolean = false;

  async connect(): Promise<void> {
    try {
      const dbPath = this.config.filePath || this.config.database;
      
      if (!dbPath) {
        throw new Error('SQLite database file path is required');
      }

      if (!fs.existsSync(dbPath)) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      this.db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });

      await this.db.get('SELECT 1');
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to SQLite: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.inTransaction) {
      await this.rollbackTransaction().catch(() => undefined);
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    return [{ name: path.basename(this.config.filePath || this.config.database || 'database.db') }];
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const rows = await this.db.all<{ name: string; type: string }[]>(
      `SELECT name, type FROM sqlite_master 
       WHERE type IN ('table', 'view') 
       AND name NOT LIKE 'sqlite_%'
       ORDER BY type, name`
    );

    return rows.map(row => ({
      name: row.name,
      type: row.type === 'view' ? 'VIEW' : 'TABLE'
    }));
  }

  async getTableColumns(database: string, table: string): Promise<TableColumn[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const escapedTable = SqlEscape.escapeTableName(table, 'sqlite');
    const rows = await this.db.all<{ cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]>(
      `PRAGMA table_info(${escapedTable})`
    );

    return rows.map(row => ({
      name: row.name,
      type: row.type,
      nullable: row.notnull === 0,
      defaultValue: row.dflt_value,
      isPrimaryKey: row.pk > 0
    }));
  }

  async executeQuery(sql: string, database?: string): Promise<QueryResult> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();
    
    const trimmedSql = sql.trim().toUpperCase();
    const isSelect = trimmedSql.startsWith('SELECT') || 
                     trimmedSql.startsWith('PRAGMA') || 
                     trimmedSql.startsWith('EXPLAIN');

    try {
      if (isSelect) {
        const rows = await this.db.all(sql);
        const executionTime = Date.now() - startTime;
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        
        return {
          columns,
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length,
          executionTime
        };
      } else {
        const result = await this.db.run(sql);
        const executionTime = Date.now() - startTime;
        
        return {
          columns: ['Affected Rows', 'Last Insert ID'],
          rows: [{ 
            'Affected Rows': result.changes || 0, 
            'Last Insert ID': result.lastID || 0 
          }],
          rowCount: 1,
          affectedRows: result.changes || 0,
          executionTime
        };
      }
    } catch (error) {
      throw new Error(`Query execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async cancelCurrentQuery(): Promise<void> {
    if (!this.db) {
      return;
    }

    const rawDb = this.db as unknown as { interrupt?: () => void };
    if (typeof rawDb.interrupt === 'function') {
      rawDb.interrupt();
      return;
    }

    throw new Error('SQLite query interruption is not supported by the current driver');
  }

  async getServerVersion(): Promise<string> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const row = await this.db.get<{ version: string }>('SELECT sqlite_version() as version');
    return row?.version || 'Unknown';
  }

  async getForeignKeys(database: string): Promise<ForeignKeyRelation[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const tables = await this.getTables(database);
    const foreignKeys: ForeignKeyRelation[] = [];

    for (const table of tables) {
      if (table.type !== 'TABLE') continue;

      const escapedTable = SqlEscape.escapeTableName(table.name, 'sqlite');
      const rows = await this.db.all<{
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
      }[]>(`PRAGMA foreign_key_list(${escapedTable})`);

      for (const row of rows) {
        foreignKeys.push({
          constraintName: `fk_${table.name}_${row.id}_${row.seq}`,
          fromTable: table.name,
          fromColumn: row.from,
          toTable: row.table,
          toColumn: row.to
        });
      }
    }

    return foreignKeys;
  }

  async getTableIndexes(_database: string, table: string): Promise<TableIndexInfo[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const escapedTable = SqlEscape.escapeTableName(table, 'sqlite');
    const indexRows = await this.db.all<{
      name: string;
      unique: number;
      origin: string;
    }[]>(`PRAGMA index_list(${escapedTable})`);

    const indexes: TableIndexInfo[] = [];
    for (const indexRow of indexRows) {
      const escapedIndex = SqlEscape.safeStringLiteral(indexRow.name, 'sqlite');
      const infoRows = await this.db.all<{ name: string }[]>(
        `PRAGMA index_info(${escapedIndex})`
      );

      indexes.push({
        name: indexRow.name,
        columns: infoRows.map(row => row.name),
        unique: indexRow.unique === 1,
        type: indexRow.origin === 'pk' ? 'PRIMARY KEY' : indexRow.origin === 'u' ? 'UNIQUE' : 'INDEX'
      });
    }

    return indexes;
  }

  async getTableConstraints(database: string, table: string): Promise<TableConstraintInfo[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const constraints: TableConstraintInfo[] = [];
    const columns = await this.getTableColumns(database, table);
    const primaryKeys = columns.filter(col => col.isPrimaryKey).map(col => col.name);
    if (primaryKeys.length > 0) {
      constraints.push({
        name: `pk_${table}`,
        type: `PRIMARY KEY (${primaryKeys.join(', ')})`
      });
    }

    const indexes = await this.getTableIndexes(database, table);
    indexes
      .filter(index => index.type === 'UNIQUE')
      .forEach(index => {
        constraints.push({
          name: index.name,
          type: `UNIQUE (${index.columns.join(', ')})`
        });
      });

    const escapedTable = SqlEscape.escapeTableName(table, 'sqlite');
    const fkRows = await this.db.all<{
      id: number;
      table: string;
      from: string;
      to: string;
    }[]>(`PRAGMA foreign_key_list(${escapedTable})`);

    fkRows.forEach(row => {
      constraints.push({
        name: `fk_${table}_${row.id}`,
        type: `FOREIGN KEY (${row.from}) REFERENCES ${row.table}(${row.to})`
      });
    });

    return constraints;
  }

  async getProcedures(_database: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getFunctions(_database: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getTriggers(_database: string): Promise<TriggerInfo[]> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }

    const rows = await this.db.all<{ name: string; tbl_name: string }[]>(
      `SELECT name, tbl_name
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`
    );

    return rows.map(row => ({
      name: row.name,
      tableName: row.tbl_name
    }));
  }

  async beginTransaction(_database?: string): Promise<void> {
    if (!this.db) {
      throw new Error('Not connected to database');
    }
    if (this.inTransaction) {
      throw new Error('A transaction is already active');
    }
    await this.db.exec('BEGIN TRANSACTION');
    this.inTransaction = true;
  }

  async commitTransaction(): Promise<void> {
    if (!this.db || !this.inTransaction) {
      return;
    }
    await this.db.exec('COMMIT');
    this.inTransaction = false;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.db || !this.inTransaction) {
      return;
    }
    await this.db.exec('ROLLBACK');
    this.inTransaction = false;
  }
}
