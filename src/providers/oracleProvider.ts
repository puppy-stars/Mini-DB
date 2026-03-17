import * as oracledb from 'oracledb';
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

export class OracleProvider extends BaseDatabaseProvider {
  private connection: oracledb.Connection | null = null;
  private pool: oracledb.Pool | null = null;
  private tunnelInfo: TunnelInfo | null = null;
  private transactionConnection: oracledb.Connection | null = null;
  private transactionSchema: string | undefined;
  private currentQueryConnection: oracledb.Connection | null = null;

  private escapeIdentifier(identifier: string): string {
    if (!identifier || identifier.trim().length === 0) {
      throw new Error('Identifier cannot be empty');
    }
    return `"${identifier.replace(/"/g, '""')}"`;
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

        const connectString = this.config.serviceName
          ? `${host}:${port}/${this.config.serviceName}`
          : `${host}:${port}/${this.config.database || 'ORCL'}`;

        const poolConfig: oracledb.PoolAttributes = {
          user: this.config.username,
          password: this.config.password,
          connectString: connectString,
          poolMax: this.config.pool?.max || 10,
          poolMin: this.config.pool?.min || 2,
          poolIncrement: 1,
          poolTimeout: Math.floor((this.config.pool?.idleTimeoutMillis || 30000) / 1000),
          queueTimeout: this.config.connectTimeout || 30000
        };

        this.pool = await oracledb.createPool(poolConfig);
        this.connection = await this.pool.getConnection();
        
        this.connected = true;
      };

      await withRetry(connectOperation, this.config.retry, 'Oracle connection');
    } catch (error) {
      this.connected = false;
      if (this.tunnelInfo) {
        const tunnelManager = SSHTunnelManager.getInstance();
        await tunnelManager.closeTunnel(this.config.id);
        this.tunnelInfo = null;
      }
      throw new Error(`Failed to connect to Oracle: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transactionConnection) {
      await this.rollbackTransaction().catch(() => undefined);
    }

    if (this.connection) {
      await this.connection.close();
      this.connection = null;
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

  private async getConnection(): Promise<oracledb.Connection> {
    if (this.transactionConnection) {
      return this.transactionConnection;
    }
    if (this.pool) {
      return await this.pool.getConnection();
    }
    if (this.connection) {
      return this.connection;
    }
    throw new Error('Not connected to database');
  }

  async getDatabases(): Promise<DatabaseInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{ NAME: string }>(
        `SELECT USERNAME as NAME FROM ALL_USERS 
         WHERE ORACLE_MAINTAINED = 'N' 
         ORDER BY USERNAME`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({ name: row.NAME }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getTables(database: string): Promise<TableInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{ NAME: string; TYPE: string; ROW_COUNT: number }>(
        `SELECT 
          OBJECT_NAME as NAME,
          OBJECT_TYPE as TYPE,
          0 as ROW_COUNT
         FROM ALL_OBJECTS 
         WHERE OWNER = :owner
         AND OBJECT_TYPE IN ('TABLE', 'VIEW')
         ORDER BY OBJECT_TYPE, OBJECT_NAME`,
        { owner: database.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.NAME,
        type: row.TYPE === 'VIEW' ? 'VIEW' : 'TABLE',
        rowCount: row.ROW_COUNT || 0
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getTableColumns(database: string, table: string): Promise<TableColumn[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        DATA_LENGTH: number | null;
        DATA_PRECISION: number | null;
        DATA_SCALE: number | null;
        NULLABLE: string;
        DATA_DEFAULT: string | null;
        IS_PRIMARY_KEY: number;
      }>(
        `SELECT 
          c.COLUMN_NAME,
          c.DATA_TYPE || 
            CASE 
              WHEN c.DATA_TYPE IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') THEN '(' || c.DATA_LENGTH || ')'
              WHEN c.DATA_TYPE IN ('NUMBER') AND c.DATA_PRECISION IS NOT NULL THEN '(' || c.DATA_PRECISION || CASE WHEN c.DATA_SCALE > 0 THEN ',' || c.DATA_SCALE ELSE '' END || ')'
              ELSE ''
            END as DATA_TYPE,
          c.NULLABLE,
          c.DATA_DEFAULT,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as IS_PRIMARY_KEY
         FROM ALL_TAB_COLUMNS c
         LEFT JOIN (
           SELECT cols.COLUMN_NAME, cols.TABLE_NAME, cols.OWNER
           FROM ALL_CONSTRAINTS cons
           JOIN ALL_CONS_COLUMNS cols ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
           WHERE cons.CONSTRAINT_TYPE = 'P'
         ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME AND c.TABLE_NAME = pk.TABLE_NAME AND c.OWNER = pk.OWNER
         WHERE c.OWNER = :owner AND c.TABLE_NAME = :table
         ORDER BY c.COLUMN_ID`,
        { 
          owner: database.toUpperCase(), 
          table: table.toUpperCase() 
        },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE,
        nullable: row.NULLABLE === 'Y',
        defaultValue: row.DATA_DEFAULT,
        isPrimaryKey: row.IS_PRIMARY_KEY === 1
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async executeQuery(sql: string, database?: string): Promise<QueryResult> {
    const conn = await this.getConnection();
    try {
      if (database && this.transactionSchema && this.transactionSchema !== database.toUpperCase()) {
        throw new Error(
          `Transaction started on schema "${this.transactionSchema}", cannot execute query on "${database.toUpperCase()}"`
        );
      }

      if (database) {
        await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${this.escapeIdentifier(database.toUpperCase())}`);
      }

      const startTime = Date.now();
      this.currentQueryConnection = conn;
      const result = await conn.execute(sql, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        resultSet: false
      });
      const executionTime = Date.now() - startTime;

      if (result.rows && result.rows.length > 0) {
        const rows = result.rows as Record<string, unknown>[];
        const columns = Object.keys(rows[0]);
        return {
          columns,
          rows: rows,
          rowCount: rows.length,
          executionTime
        };
      } else if (result.rowsAffected && result.rowsAffected > 0) {
        return {
          columns: ['Affected Rows'],
          rows: [{ 'Affected Rows': result.rowsAffected }],
          rowCount: 1,
          affectedRows: result.rowsAffected,
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
      if (this.currentQueryConnection === conn) {
        this.currentQueryConnection = null;
      }
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async cancelCurrentQuery(): Promise<void> {
    if (!this.currentQueryConnection) {
      return;
    }

    try {
      await this.currentQueryConnection.break();
    } catch (error) {
      throw new Error(
        `Failed to cancel Oracle query: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getServerVersion(): Promise<string> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{ VERSION: string }>(
        'SELECT BANNER as VERSION FROM v$version WHERE ROWNUM = 1',
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const versionString = (result.rows?.[0] as { VERSION: string })?.VERSION || '';
      const match = versionString.match(/Release (\d+\.\d+)/i);
      return match ? match[1] : versionString;
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getForeignKeys(database: string): Promise<ForeignKeyRelation[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{
        CONSTRAINT_NAME: string;
        FROM_TABLE: string;
        FROM_COLUMN: string;
        TO_TABLE: string;
        TO_COLUMN: string;
      }>(
        `SELECT 
          fk.CONSTRAINT_NAME,
          cols.TABLE_NAME as FROM_TABLE,
          cols.COLUMN_NAME as FROM_COLUMN,
          ref.TABLE_NAME as TO_TABLE,
          ref.COLUMN_NAME as TO_COLUMN
         FROM ALL_CONSTRAINTS fk
         JOIN ALL_CONS_COLUMNS cols ON fk.CONSTRAINT_NAME = cols.CONSTRAINT_NAME AND fk.OWNER = cols.OWNER
         JOIN ALL_CONSTRAINTS pk ON fk.R_CONSTRAINT_NAME = pk.CONSTRAINT_NAME AND fk.R_OWNER = pk.OWNER
         JOIN ALL_CONS_COLUMNS ref ON pk.CONSTRAINT_NAME = ref.CONSTRAINT_NAME AND pk.OWNER = ref.OWNER
         WHERE fk.CONSTRAINT_TYPE = 'R'
         AND fk.OWNER = :owner
         ORDER BY fk.CONSTRAINT_NAME, cols.POSITION`,
        { owner: database.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        constraintName: row.CONSTRAINT_NAME,
        fromTable: row.FROM_TABLE,
        fromColumn: row.FROM_COLUMN,
        toTable: row.TO_TABLE,
        toColumn: row.TO_COLUMN
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getTableIndexes(database: string, table: string): Promise<TableIndexInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{
        INDEX_NAME: string;
        UNIQUENESS: string;
        INDEX_TYPE: string;
        COLUMN_NAME: string;
        COLUMN_POSITION: number;
      }>(
        `SELECT
           idx.INDEX_NAME,
           idx.UNIQUENESS,
           idx.INDEX_TYPE,
           col.COLUMN_NAME,
           col.COLUMN_POSITION
         FROM ALL_INDEXES idx
         JOIN ALL_IND_COLUMNS col
           ON idx.OWNER = col.INDEX_OWNER
          AND idx.INDEX_NAME = col.INDEX_NAME
         WHERE idx.TABLE_OWNER = :owner
           AND idx.TABLE_NAME = :table
         ORDER BY idx.INDEX_NAME, col.COLUMN_POSITION`,
        { owner: database.toUpperCase(), table: table.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const indexMap = new Map<string, TableIndexInfo>();
      for (const row of result.rows || []) {
        if (!indexMap.has(row.INDEX_NAME)) {
          indexMap.set(row.INDEX_NAME, {
            name: row.INDEX_NAME,
            columns: [],
            unique: row.UNIQUENESS === 'UNIQUE',
            type: row.INDEX_TYPE
          });
        }
        indexMap.get(row.INDEX_NAME)!.columns.push(row.COLUMN_NAME);
      }

      return Array.from(indexMap.values());
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getTableConstraints(database: string, table: string): Promise<TableConstraintInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{
        CONSTRAINT_NAME: string;
        CONSTRAINT_TYPE: string;
      }>(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
         FROM ALL_CONSTRAINTS
         WHERE OWNER = :owner
           AND TABLE_NAME = :table
           AND CONSTRAINT_TYPE IN ('P', 'R', 'U', 'C')
         ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME`,
        { owner: database.toUpperCase(), table: table.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.CONSTRAINT_NAME,
        type: row.CONSTRAINT_TYPE
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getProcedures(database: string): Promise<RoutineInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT DISTINCT OBJECT_NAME
         FROM ALL_PROCEDURES
         WHERE OWNER = :owner
           AND OBJECT_TYPE = 'PROCEDURE'
         ORDER BY OBJECT_NAME`,
        { owner: database.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.OBJECT_NAME,
        type: 'PROCEDURE'
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getFunctions(database: string): Promise<RoutineInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{ OBJECT_NAME: string }>(
        `SELECT DISTINCT OBJECT_NAME
         FROM ALL_PROCEDURES
         WHERE OWNER = :owner
           AND OBJECT_TYPE = 'FUNCTION'
         ORDER BY OBJECT_NAME`,
        { owner: database.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.OBJECT_NAME,
        type: 'FUNCTION'
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async getTriggers(database: string): Promise<TriggerInfo[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute<{
        TRIGGER_NAME: string;
        TABLE_NAME: string;
        TRIGGERING_EVENT: string;
      }>(
        `SELECT TRIGGER_NAME, TABLE_NAME, TRIGGERING_EVENT
         FROM ALL_TRIGGERS
         WHERE OWNER = :owner
         ORDER BY TRIGGER_NAME`,
        { owner: database.toUpperCase() },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      return (result.rows || []).map(row => ({
        name: row.TRIGGER_NAME,
        tableName: row.TABLE_NAME,
        event: row.TRIGGERING_EVENT
      }));
    } finally {
      if (this.pool && conn !== this.transactionConnection) {
        await conn.close();
      }
    }
  }

  async beginTransaction(database?: string): Promise<void> {
    if (this.transactionConnection) {
      throw new Error('A transaction is already active');
    }

    let conn: oracledb.Connection;
    if (this.pool) {
      conn = await this.pool.getConnection();
    } else if (this.connection) {
      conn = this.connection;
    } else {
      throw new Error('Not connected to database');
    }

    if (database) {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${this.escapeIdentifier(database.toUpperCase())}`);
      this.transactionSchema = database.toUpperCase();
    } else {
      this.transactionSchema = undefined;
    }

    this.transactionConnection = conn;
  }

  async commitTransaction(): Promise<void> {
    if (!this.transactionConnection) {
      return;
    }

    const conn = this.transactionConnection;
    this.transactionConnection = null;
    this.transactionSchema = undefined;

    try {
      await conn.commit();
    } finally {
      if (this.pool) {
        await conn.close();
      }
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.transactionConnection) {
      return;
    }

    const conn = this.transactionConnection;
    this.transactionConnection = null;
    this.transactionSchema = undefined;

    try {
      await conn.rollback();
    } finally {
      if (this.pool) {
        await conn.close();
      }
    }
  }
}
