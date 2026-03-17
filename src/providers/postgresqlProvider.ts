import { Pool, PoolClient, QueryResult as PgQueryResult } from 'pg';
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

export class PostgreSQLProvider extends BaseDatabaseProvider {
  private pool: Pool | null = null;
  private currentDatabase: string;
  private tunnelInfo: TunnelInfo | null = null;
  private transactionClient: PoolClient | null = null;
  private transactionDatabase: string | undefined;
  private runningClient: PoolClient | null = null;
  private runningPid: number | null = null;

  constructor(config: ConnectionConfig) {
    super(config);
    this.currentDatabase = config.database || 'postgres';
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

      await withRetry(
        () => this.connectToDatabase(this.currentDatabase),
        this.config.retry,
        'PostgreSQL connection'
      );
    } catch (error) {
      this.connected = false;
      if (this.tunnelInfo) {
        const tunnelManager = SSHTunnelManager.getInstance();
        await tunnelManager.closeTunnel(this.config.id);
        this.tunnelInfo = null;
      }
      throw new Error(`Failed to connect to PostgreSQL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildPool(database: string): Pool {
    const host = this.tunnelInfo ? '127.0.0.1' : this.config.host;
    const port = this.tunnelInfo ? this.tunnelInfo.localPort : this.config.port;

    return new Pool({
      host,
      port,
      user: this.config.username,
      password: this.config.password,
      database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      max: this.config.pool?.max || 10,
      min: this.config.pool?.min || 2,
      idleTimeoutMillis: this.config.pool?.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectTimeout || 30000
    });
  }

  private async connectToDatabase(database: string): Promise<void> {
    const nextPool = this.buildPool(database);

    try {
      const testClient = await nextPool.connect();
      testClient.release();

      if (this.pool) {
        await this.pool.end();
      }

      this.pool = nextPool;
      this.currentDatabase = database;
      this.connected = true;
    } catch (error) {
      await nextPool.end().catch(() => undefined);
      throw error;
    }
  }

  private async ensureDatabase(database: string): Promise<void> {
    if (database === this.currentDatabase) {
      return;
    }

    await withRetry(
      () => this.connectToDatabase(database),
      this.config.retry,
      `PostgreSQL switch database (${database})`
    );
  }

  private async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    return await this.pool.connect();
  }

  async disconnect(): Promise<void> {
    if (this.transactionClient) {
      await this.rollbackTransaction().catch(() => undefined);
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
    const client = await this.getClient();
    try {
      const result = await client.query<{ datname: string }>(
        `SELECT datname FROM pg_database 
         WHERE datistemplate = false 
         ORDER BY datname`
      );

      return result.rows.map(row => ({ name: row.datname }));
    } finally {
      client.release();
    }
  }

  async getTables(database: string): Promise<TableInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{ name: string; type: string; row_count: number }>(
        `SELECT 
          c.relname as name,
          CASE c.relkind 
            WHEN 'r' THEN 'TABLE'
            WHEN 'v' THEN 'VIEW'
            WHEN 'm' THEN 'VIEW'
          END as type,
          c.reltuples::bigint as row_count
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'v', 'm')
         ORDER BY c.relkind, c.relname`
      );

      return result.rows.map(row => ({
        name: row.name,
        type: row.type === 'VIEW' ? 'VIEW' : 'TABLE',
        rowCount: row.row_count || 0
      }));
    } finally {
      client.release();
    }
  }

  async getTableColumns(database: string, table: string): Promise<TableColumn[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        is_primary_key: boolean;
      }>(
        `SELECT 
          a.attname as column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
          CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END as is_nullable,
          pg_catalog.pg_get_expr(d.adbin, d.adrelid) as column_default,
          COALESCE(pk.contype = 'p', false) as is_primary_key
         FROM pg_attribute a
         LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
         LEFT JOIN pg_constraint pk ON pk.conrelid = a.attrelid 
           AND a.attnum = ANY(pk.conkey) AND pk.contype = 'p'
         WHERE a.attrelid = $1::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [table]
      );

      return result.rows.map(row => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        defaultValue: row.column_default,
        isPrimaryKey: row.is_primary_key
      }));
    } finally {
      client.release();
    }
  }

  async executeQuery(sql: string, database?: string): Promise<QueryResult> {
    if (database && !this.transactionClient) {
      await this.ensureDatabase(database);
    }

    const useTransactionClient = this.transactionClient !== null;
    const client = useTransactionClient ? this.transactionClient! : await this.getClient();
    if (useTransactionClient && database && this.transactionDatabase && database !== this.transactionDatabase) {
      throw new Error(
        `Transaction started on database "${this.transactionDatabase}", cannot execute query on "${database}"`
      );
    }

    this.runningClient = client;
    this.runningPid = Number((client as unknown as { processID?: number }).processID || 0) || null;

    try {
      const startTime = Date.now();
      const result: PgQueryResult = await client.query(sql);
      const executionTime = Date.now() - startTime;

      if (result.rows && result.rows.length > 0) {
        const columns = Object.keys(result.rows[0]);
        return {
          columns,
          rows: result.rows as Record<string, unknown>[],
          rowCount: result.rowCount || result.rows.length,
          executionTime
        };
      } else if (result.command !== 'SELECT') {
        return {
          columns: ['Affected Rows'],
          rows: [{ 'Affected Rows': result.rowCount || 0 }],
          rowCount: 1,
          affectedRows: result.rowCount || 0,
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
      if (this.runningClient === client) {
        this.runningClient = null;
        this.runningPid = null;
      }
      if (!useTransactionClient) {
        client.release();
      }
    }
  }

  async cancelCurrentQuery(): Promise<void> {
    if (!this.pool || this.runningPid === null) {
      return;
    }

    const pid = this.runningPid;
    try {
      await this.pool.query('SELECT pg_cancel_backend($1)', [pid]);
    } catch (error) {
      if (this.runningClient) {
        this.runningClient.release(true);
        this.runningClient = null;
        this.runningPid = null;
        return;
      }

      throw new Error(
        `Failed to cancel PostgreSQL query: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getServerVersion(): Promise<string> {
    const client = await this.getClient();
    try {
      const result = await client.query<{ version: string }>('SELECT version()');
      const versionString = result.rows[0].version;
      const match = versionString.match(/PostgreSQL (\d+\.\d+)/);
      return match ? match[1] : versionString;
    } finally {
      client.release();
    }
  }

  async getForeignKeys(database: string): Promise<ForeignKeyRelation[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{
        constraint_name: string;
        from_table: string;
        from_column: string;
        to_table: string;
        to_column: string;
      }>(
        `SELECT 
          tc.constraint_name,
          kcu.table_name as from_table,
          kcu.column_name as from_column,
          ccu.table_name as to_table,
          ccu.column_name as to_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu 
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu 
           ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
         ORDER BY tc.constraint_name, kcu.ordinal_position`
      );

      return result.rows.map(row => ({
        constraintName: row.constraint_name,
        fromTable: row.from_table,
        fromColumn: row.from_column,
        toTable: row.to_table,
        toColumn: row.to_column
      }));
    } finally {
      client.release();
    }
  }

  async getTableIndexes(database: string, table: string): Promise<TableIndexInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = $1
         ORDER BY indexname`,
        [table]
      );

      return result.rows.map(row => {
        const columnMatch = row.indexdef.match(/\((.+)\)/);
        const columns = columnMatch
          ? columnMatch[1].split(',').map(col => col.trim().replace(/^"|"$/g, ''))
          : [];
        const methodMatch = row.indexdef.match(/USING\s+([a-zA-Z0-9_]+)/i);

        return {
          name: row.indexname,
          columns,
          unique: /CREATE\s+UNIQUE\s+INDEX/i.test(row.indexdef),
          type: methodMatch ? methodMatch[1].toUpperCase() : undefined
        };
      });
    } finally {
      client.release();
    }
  }

  async getTableConstraints(database: string, table: string): Promise<TableConstraintInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{ constraint_name: string; constraint_type: string }>(
        `SELECT constraint_name, constraint_type
         FROM information_schema.table_constraints
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY constraint_type, constraint_name`,
        [table]
      );

      return result.rows.map(row => ({
        name: row.constraint_name,
        type: row.constraint_type
      }));
    } finally {
      client.release();
    }
  }

  async getProcedures(database: string): Promise<RoutineInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{ name: string }>(
        `SELECT p.proname as name
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'p'
         ORDER BY p.proname`
      );

      return result.rows.map(row => ({
        name: row.name,
        type: 'PROCEDURE'
      }));
    } finally {
      client.release();
    }
  }

  async getFunctions(database: string): Promise<RoutineInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{ name: string }>(
        `SELECT p.proname as name
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f'
         ORDER BY p.proname`
      );

      return result.rows.map(row => ({
        name: row.name,
        type: 'FUNCTION'
      }));
    } finally {
      client.release();
    }
  }

  async getTriggers(database: string): Promise<TriggerInfo[]> {
    await this.ensureDatabase(database);
    const client = await this.getClient();
    try {
      const result = await client.query<{
        trigger_name: string;
        event_object_table: string;
        event_manipulation: string;
      }>(
        `SELECT trigger_name, event_object_table, event_manipulation
         FROM information_schema.triggers
         WHERE trigger_schema = 'public'
         ORDER BY trigger_name`
      );

      return result.rows.map(row => ({
        name: row.trigger_name,
        tableName: row.event_object_table,
        event: row.event_manipulation
      }));
    } finally {
      client.release();
    }
  }

  async beginTransaction(database?: string): Promise<void> {
    if (this.transactionClient) {
      throw new Error('A transaction is already active');
    }

    if (database) {
      await this.ensureDatabase(database);
    }

    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      this.transactionClient = client;
      this.transactionDatabase = database ?? this.currentDatabase;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async commitTransaction(): Promise<void> {
    if (!this.transactionClient) {
      return;
    }
    try {
      await this.transactionClient.query('COMMIT');
    } finally {
      this.transactionClient.release();
      this.transactionClient = null;
      this.transactionDatabase = undefined;
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.transactionClient) {
      return;
    }
    try {
      await this.transactionClient.query('ROLLBACK');
    } finally {
      this.transactionClient.release();
      this.transactionClient = null;
      this.transactionDatabase = undefined;
    }
  }
}
