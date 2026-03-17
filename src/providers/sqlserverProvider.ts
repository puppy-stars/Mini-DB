import * as mssql from 'mssql';
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
import { withRetry } from '../utils/retry';
import { SSHTunnelManager, TunnelInfo } from '../utils/sshTunnel';

export class SQLServerProvider extends BaseDatabaseProvider {
  private pool: mssql.ConnectionPool | null = null;
  private currentDatabase: string;
  private tunnelInfo: TunnelInfo | null = null;
  private transaction: mssql.Transaction | null = null;
  private transactionDatabase: string | undefined;
  private currentRequest: mssql.Request | null = null;

  constructor(config: ConnectionConfig) {
    super(config);
    this.currentDatabase = config.database || 'master';
  }

  private escapeDatabaseName(database: string): string {
    if (!database || database.trim().length === 0) {
      throw new Error('Database name cannot be empty');
    }
    return `[${database.replace(/]/g, ']]')}]`;
  }

  async connect(): Promise<void> {
    try {
      if (this.config.ssh) {
        const tunnelManager = SSHTunnelManager.getInstance();
        this.tunnelInfo = await tunnelManager.createTunnel(
          this.config.id,
          this.config.ssh,
          this.config.host,
          this.config.port
        );
      }

      const connectOperation = async () => {
        const host = this.tunnelInfo ? '127.0.0.1' : this.config.host;
        const port = this.tunnelInfo ? this.tunnelInfo.localPort : this.config.port;

        const config: mssql.config = {
          server: host,
          user: this.config.username,
          password: this.config.password,
          database: this.currentDatabase,
          connectionTimeout: this.config.connectTimeout || 30000,
          options: {
            encrypt: this.config.ssl ?? false,
            trustServerCertificate: true,
            enableArithAbort: true,
            instanceName: this.config.instanceName,
            port: this.config.instanceName ? undefined : port
          }
        };

        this.pool = new mssql.ConnectionPool(config);
        await this.pool.connect();
        
        this.connected = true;
      };

      await withRetry(connectOperation, this.config.retry, 'SQL Server connection');
    } catch (error) {
      this.connected = false;
      if (this.tunnelInfo) {
        const tunnelManager = SSHTunnelManager.getInstance();
        await tunnelManager.closeTunnel(this.config.id);
        this.tunnelInfo = null;
      }
      throw new Error(`Failed to connect to SQL Server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transaction) {
      await this.rollbackTransaction().catch(() => undefined);
    }

    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
    
    if (this.tunnelInfo) {
      const tunnelManager = SSHTunnelManager.getInstance();
      await tunnelManager.closeTunnel(this.config.id);
      this.tunnelInfo = null;
    }
    
    this.connected = false;
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const result = await this.pool.request().query<{ name: string }>(
      `SELECT name FROM sys.databases 
       WHERE database_id > 4 
       ORDER BY name`
    );

    return result.recordset.map(row => ({ name: row.name }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .query<{ name: string; type: string; row_count: number }>(
        `SELECT 
          t.name as name,
          CASE t.type 
            WHEN 'U' THEN 'TABLE'
            WHEN 'V' THEN 'VIEW'
          END as type,
          p.rows as row_count
         FROM ${escapedDatabase}.sys.objects t
         LEFT JOIN ${escapedDatabase}.sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
         WHERE t.type IN ('U', 'V')
         GROUP BY t.name, t.type, p.rows
         ORDER BY t.type, t.name`
      );

    return result.recordset.map(row => ({
      name: row.name,
      type: row.type === 'VIEW' ? 'VIEW' : 'TABLE',
      rowCount: row.row_count || 0
    }));
  }

  async getTableColumns(database: string, table: string): Promise<TableColumn[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .input('table', mssql.NVarChar, table)
      .query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        is_primary_key: number;
      }>(
        `SELECT 
          c.name as column_name,
          ty.name + 
            CASE 
              WHEN ty.name IN ('varchar', 'nvarchar', 'char', 'nchar') THEN '(' + 
                CASE WHEN c.max_length = -1 THEN 'MAX' ELSE CAST(c.max_length / CASE WHEN ty.name LIKE 'n%' THEN 2 ELSE 1 END AS VARCHAR(10)) END + ')'
              WHEN ty.name IN ('decimal', 'numeric') THEN '(' + CAST(c.precision AS VARCHAR(10)) + ',' + CAST(c.scale AS VARCHAR(10)) + ')'
              ELSE ''
            END as data_type,
          CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END as is_nullable,
          OBJECT_DEFINITION(c.default_object_id) as column_default,
          CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
         FROM ${escapedDatabase}.sys.columns c
         JOIN ${escapedDatabase}.sys.types ty ON c.user_type_id = ty.user_type_id
         JOIN ${escapedDatabase}.sys.tables t ON c.object_id = t.object_id
         LEFT JOIN (
           SELECT ic.object_id, ic.column_id
           FROM ${escapedDatabase}.sys.indexes i
           JOIN ${escapedDatabase}.sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
           WHERE i.is_primary_key = 1
         ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
         WHERE t.name = @table
         ORDER BY c.column_id`
      );

    return result.recordset.map(row => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === 'YES',
      defaultValue: row.column_default,
      isPrimaryKey: row.is_primary_key === 1
    }));
  }

  async executeQuery(sql: string, database?: string): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();
    const useTransaction = this.transaction !== null;

    if (database && useTransaction && this.transactionDatabase && database !== this.transactionDatabase) {
      throw new Error(
        `Transaction started on database "${this.transactionDatabase}", cannot execute query on "${database}"`
      );
    }

    if (database && !useTransaction && database !== this.currentDatabase) {
      await this.pool.query(`USE ${this.escapeDatabaseName(database)}`);
      this.currentDatabase = database;
    }

    const request = useTransaction
      ? new mssql.Request(this.transaction!)
      : this.pool.request();

    this.currentRequest = request;
    try {
      const result = await request.query(sql);
      const executionTime = Date.now() - startTime;

      if (result.recordset && result.recordset.length > 0) {
        const columns = Object.keys(result.recordset[0]);
        return {
          columns,
          rows: result.recordset as Record<string, unknown>[],
          rowCount: result.recordset.length,
          executionTime
        };
      } else if (result.rowsAffected && result.rowsAffected[0] > 0) {
        return {
          columns: ['Affected Rows'],
          rows: [{ 'Affected Rows': result.rowsAffected[0] }],
          rowCount: 1,
          affectedRows: result.rowsAffected[0],
          executionTime
        };
      }

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime
      };
    } finally {
      if (this.currentRequest === request) {
        this.currentRequest = null;
      }
    }
  }

  async cancelCurrentQuery(): Promise<void> {
    if (!this.currentRequest) {
      return;
    }

    try {
      this.currentRequest.cancel();
    } catch (error) {
      throw new Error(
        `Failed to cancel SQL Server query: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getServerVersion(): Promise<string> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const result = await this.pool.request().query<{ version: string }>(
      'SELECT @@VERSION as version'
    );
    
    const versionString = result.recordset[0].version;
    const match = versionString.match(/SQL Server\s+(\d+)/i);
    return match ? match[1] : 'Unknown';
  }

  async getForeignKeys(database: string): Promise<ForeignKeyRelation[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .input('database', mssql.NVarChar, database)
      .query<{
        constraint_name: string;
        from_table: string;
        from_column: string;
        to_table: string;
        to_column: string;
      }>(
        `SELECT 
          fk.name as constraint_name,
          OBJECT_NAME(fk.parent_object_id, DB_ID(@database)) as from_table,
          COL_NAME(fkc.parent_object_id, fkc.parent_column_id) as from_column,
          OBJECT_NAME(fk.referenced_object_id, DB_ID(@database)) as to_table,
          COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) as to_column
         FROM ${escapedDatabase}.sys.foreign_keys fk
         JOIN ${escapedDatabase}.sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
         ORDER BY fk.name, fkc.constraint_column_id`
      );

    return result.recordset.map(row => ({
      constraintName: row.constraint_name,
      fromTable: row.from_table,
      fromColumn: row.from_column,
      toTable: row.to_table,
      toColumn: row.to_column
    }));
  }

  async getTableIndexes(database: string, table: string): Promise<TableIndexInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .input('table', mssql.NVarChar, table)
      .query<{
        index_name: string;
        is_unique: number;
        index_type: string;
        column_names: string | null;
      }>(
        `SELECT
           i.name as index_name,
           i.is_unique as is_unique,
           i.type_desc as index_type,
           STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) as column_names
         FROM ${escapedDatabase}.sys.indexes i
         JOIN ${escapedDatabase}.sys.tables t ON i.object_id = t.object_id
         JOIN ${escapedDatabase}.sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
         JOIN ${escapedDatabase}.sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         WHERE t.name = @table
           AND i.name IS NOT NULL
           AND i.is_hypothetical = 0
         GROUP BY i.name, i.is_unique, i.type_desc
         ORDER BY i.name`
      );

    return result.recordset.map(row => ({
      name: row.index_name,
      columns: row.column_names ? row.column_names.split(',').map(col => col.trim()) : [],
      unique: row.is_unique === 1,
      type: row.index_type
    }));
  }

  async getTableConstraints(database: string, table: string): Promise<TableConstraintInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .input('table', mssql.NVarChar, table)
      .query<{ constraint_name: string; constraint_type: string }>(
        `SELECT
           CONSTRAINT_NAME as constraint_name,
           CONSTRAINT_TYPE as constraint_type
         FROM ${escapedDatabase}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_NAME = @table
         ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`
      );

    return result.recordset.map(row => ({
      name: row.constraint_name,
      type: row.constraint_type
    }));
  }

  async getProcedures(database: string): Promise<RoutineInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .query<{ name: string }>(
        `SELECT name
         FROM ${escapedDatabase}.sys.procedures
         WHERE is_ms_shipped = 0
         ORDER BY name`
      );

    return result.recordset.map(row => ({
      name: row.name,
      type: 'PROCEDURE'
    }));
  }

  async getFunctions(database: string): Promise<RoutineInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .query<{ name: string }>(
        `SELECT name
         FROM ${escapedDatabase}.sys.objects
         WHERE type IN ('FN', 'IF', 'TF', 'FS', 'FT')
         ORDER BY name`
      );

    return result.recordset.map(row => ({
      name: row.name,
      type: 'FUNCTION'
    }));
  }

  async getTriggers(database: string): Promise<TriggerInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const escapedDatabase = this.escapeDatabaseName(database);
    const result = await this.pool.request()
      .query<{ trigger_name: string; table_name: string | null }>(
        `SELECT
           tr.name as trigger_name,
           tb.name as table_name
         FROM ${escapedDatabase}.sys.triggers tr
         LEFT JOIN ${escapedDatabase}.sys.tables tb ON tr.parent_id = tb.object_id
         WHERE tr.is_ms_shipped = 0
         ORDER BY tr.name`
      );

    return result.recordset.map(row => ({
      name: row.trigger_name,
      tableName: row.table_name || undefined
    }));
  }

  async beginTransaction(database?: string): Promise<void> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    if (this.transaction) {
      throw new Error('A transaction is already active');
    }

    const targetDatabase = database || this.currentDatabase;
    if (targetDatabase && targetDatabase !== this.currentDatabase) {
      await this.pool.query(`USE ${this.escapeDatabaseName(targetDatabase)}`);
      this.currentDatabase = targetDatabase;
    }

    const tx = new mssql.Transaction(this.pool);
    await tx.begin();
    this.transaction = tx;
    this.transactionDatabase = targetDatabase;
  }

  async commitTransaction(): Promise<void> {
    if (!this.transaction) {
      return;
    }

    try {
      await this.transaction.commit();
    } finally {
      this.transaction = null;
      this.transactionDatabase = undefined;
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.transaction) {
      return;
    }

    try {
      await this.transaction.rollback();
    } finally {
      this.transaction = null;
      this.transactionDatabase = undefined;
    }
  }
}
