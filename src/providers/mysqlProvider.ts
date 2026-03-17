import * as mysql from 'mysql2/promise';
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

export class MySQLProvider extends BaseDatabaseProvider {
  private connection: mysql.Connection | null = null;
  private pool: mysql.Pool | null = null;
  private tunnelInfo: TunnelInfo | null = null;
  private transactionConnection: mysql.PoolConnection | null = null;
  private transactionDatabase: string | undefined;
  private currentQueryConnection: mysql.PoolConnection | null = null;
  private currentQueryThreadId: number | null = null;

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

        const poolConfig: mysql.PoolOptions = {
          host: host,
          port: port,
          user: this.config.username,
          password: this.config.password,
          database: this.config.database,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
          connectionLimit: this.config.pool?.max || 5,
          waitForConnections: true,
          queueLimit: 0,
          connectTimeout: this.config.connectTimeout || 30000
        };

        this.pool = mysql.createPool(poolConfig);

        const testConn = await this.pool.getConnection();
        await testConn.ping();
        testConn.release();
        
        this.connected = true;
      };

      await withRetry(connectOperation, this.config.retry, 'MySQL connection');
    } catch (error) {
      this.connected = false;
      if (this.tunnelInfo) {
        const tunnelManager = SSHTunnelManager.getInstance();
        await tunnelManager.closeTunnel(this.config.id);
        this.tunnelInfo = null;
      }
      throw new Error(`Failed to connect to MySQL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transactionConnection) {
      await this.rollbackTransaction().catch(() => undefined);
    }

    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
    if (this.pool) {
      await this.pool.end();
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

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      "SHOW DATABASES WHERE `Database` NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
    );

    return rows.map(row => ({ name: row.Database }));
  }

  async getTables(database: string): Promise<TableInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME as name, TABLE_TYPE as type, TABLE_ROWS as row_count 
       FROM information_schema.TABLES 
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_TYPE, TABLE_NAME`,
      [database]
    );

    return rows.map(row => ({
      name: row.name,
      type: row.type === 'VIEW' ? 'VIEW' : 'TABLE',
      rowCount: row.row_count || 0
    }));
  }

  async getTableColumns(database: string, table: string): Promise<TableColumn[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT 
        COLUMN_NAME as name,
        COLUMN_TYPE as type,
        IS_NULLABLE as nullable,
        COLUMN_DEFAULT as default_value,
        COLUMN_KEY as column_key
       FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table]
    );

    return rows.map(row => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable === 'YES',
      defaultValue: row.default_value,
      isPrimaryKey: row.column_key === 'PRI'
    }));
  }

  async executeQuery(sql: string, database?: string): Promise<QueryResult> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const startTime = Date.now();
    const useTransactionConnection = this.transactionConnection !== null;
    let conn: mysql.PoolConnection;

    if (useTransactionConnection) {
      conn = this.transactionConnection!;
      if (database && this.transactionDatabase && database !== this.transactionDatabase) {
        throw new Error(
          `Transaction started on database "${this.transactionDatabase}", cannot execute query on "${database}"`
        );
      }
    } else {
      conn = await this.pool.getConnection();
      if (database) {
        await conn.changeUser({ database });
      }
    }

    const queryConnection = conn;
    this.currentQueryConnection = queryConnection;
    this.currentQueryThreadId = queryConnection.threadId;

    try {
      const [result] = await conn.execute(sql);
      const executionTime = Date.now() - startTime;

      if (Array.isArray(result)) {
        const rows = result as mysql.RowDataPacket[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        
        return {
          columns,
          rows: rows as Record<string, unknown>[],
          rowCount: rows.length,
          executionTime
        };
      } else {
        const resultSet = result as mysql.ResultSetHeader;
        return {
          columns: ['Affected Rows'],
          rows: [{ 'Affected Rows': resultSet.affectedRows }],
          rowCount: 1,
          affectedRows: resultSet.affectedRows,
          executionTime
        };
      }
    } finally {
      if (this.currentQueryConnection === queryConnection) {
        this.currentQueryConnection = null;
        this.currentQueryThreadId = null;
      }
      if (!useTransactionConnection) {
        conn.release();
      }
    }
  }

  async cancelCurrentQuery(): Promise<void> {
    if (!this.pool || this.currentQueryThreadId === null) {
      return;
    }

    const threadId = Math.max(0, Math.floor(this.currentQueryThreadId));
    if (threadId === 0) {
      return;
    }

    try {
      const killer = await this.pool.getConnection();
      try {
        await killer.query(`KILL QUERY ${threadId}`);
      } finally {
        killer.release();
      }
    } catch (error) {
      if (this.currentQueryConnection && this.currentQueryConnection !== this.transactionConnection) {
        this.currentQueryConnection.destroy();
        return;
      }

      throw new Error(
        `Failed to cancel MySQL query: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getServerVersion(): Promise<string> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>('SELECT VERSION() as version');
    return rows[0].version;
  }

  async getForeignKeys(database: string): Promise<ForeignKeyRelation[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT 
        kcu.CONSTRAINT_NAME as constraint_name,
        kcu.TABLE_NAME as from_table,
        kcu.COLUMN_NAME as from_column,
        kcu.REFERENCED_TABLE_NAME as to_table,
        kcu.REFERENCED_COLUMN_NAME as to_column
       FROM information_schema.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ?
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
         AND kcu.REFERENCED_COLUMN_NAME IS NOT NULL
       ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [database]
    );

    return rows.map(row => ({
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

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         INDEX_NAME as index_name,
         COLUMN_NAME as column_name,
         NON_UNIQUE as non_unique,
         INDEX_TYPE as index_type,
         SEQ_IN_INDEX as seq_in_index
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table]
    );

    const indexMap = new Map<string, TableIndexInfo>();
    for (const row of rows) {
      const name = String(row.index_name);
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          columns: [],
          unique: Number(row.non_unique) === 0,
          type: String(row.index_type || '')
        });
      }
      const index = indexMap.get(name)!;
      if (row.column_name) {
        index.columns.push(String(row.column_name));
      }
    }

    return Array.from(indexMap.values());
  }

  async getTableConstraints(database: string, table: string): Promise<TableConstraintInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         CONSTRAINT_NAME as constraint_name,
         CONSTRAINT_TYPE as constraint_type
       FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`,
      [database, table]
    );

    return rows.map(row => ({
      name: String(row.constraint_name),
      type: String(row.constraint_type)
    }));
  }

  async getProcedures(database: string): Promise<RoutineInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT ROUTINE_NAME as routine_name
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'
       ORDER BY ROUTINE_NAME`,
      [database]
    );

    return rows.map(row => ({
      name: String(row.routine_name),
      type: 'PROCEDURE'
    }));
  }

  async getFunctions(database: string): Promise<RoutineInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT ROUTINE_NAME as routine_name
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'
       ORDER BY ROUTINE_NAME`,
      [database]
    );

    return rows.map(row => ({
      name: String(row.routine_name),
      type: 'FUNCTION'
    }));
  }

  async getTriggers(database: string): Promise<TriggerInfo[]> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }

    const [rows] = await this.pool.execute<mysql.RowDataPacket[]>(
      `SELECT
         TRIGGER_NAME as trigger_name,
         EVENT_OBJECT_TABLE as table_name,
         EVENT_MANIPULATION as event_name
       FROM information_schema.TRIGGERS
       WHERE TRIGGER_SCHEMA = ?
       ORDER BY TRIGGER_NAME`,
      [database]
    );

    return rows.map(row => ({
      name: String(row.trigger_name),
      tableName: String(row.table_name || ''),
      event: String(row.event_name || '')
    }));
  }

  async beginTransaction(database?: string): Promise<void> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    if (this.transactionConnection) {
      throw new Error('A transaction is already active');
    }

    const conn = await this.pool.getConnection();
    try {
      if (database) {
        await conn.changeUser({ database });
      }
      await conn.beginTransaction();
      this.transactionConnection = conn;
      this.transactionDatabase = database;
    } catch (error) {
      conn.release();
      throw error;
    }
  }

  async commitTransaction(): Promise<void> {
    if (!this.transactionConnection) {
      return;
    }
    try {
      await this.transactionConnection.commit();
    } finally {
      this.transactionConnection.release();
      this.transactionConnection = null;
      this.transactionDatabase = undefined;
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.transactionConnection) {
      return;
    }
    try {
      await this.transactionConnection.rollback();
    } finally {
      this.transactionConnection.release();
      this.transactionConnection = null;
      this.transactionDatabase = undefined;
    }
  }
}
