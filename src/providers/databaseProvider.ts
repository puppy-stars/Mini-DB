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

export interface IDatabaseProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDatabases(): Promise<DatabaseInfo[]>;
  getTables(database: string): Promise<TableInfo[]>;
  getTableColumns(database: string, table: string): Promise<TableColumn[]>;
  executeQuery(sql: string, database?: string): Promise<QueryResult>;
  getServerVersion(): Promise<string>;
  getForeignKeys(database: string): Promise<ForeignKeyRelation[]>;
  cancelCurrentQuery?(): Promise<void>;
  getTableIndexes?(database: string, table: string): Promise<TableIndexInfo[]>;
  getTableConstraints?(database: string, table: string): Promise<TableConstraintInfo[]>;
  getProcedures?(database: string): Promise<RoutineInfo[]>;
  getFunctions?(database: string): Promise<RoutineInfo[]>;
  getTriggers?(database: string): Promise<TriggerInfo[]>;
  beginTransaction?(database?: string): Promise<void>;
  commitTransaction?(): Promise<void>;
  rollbackTransaction?(): Promise<void>;
}

export abstract class BaseDatabaseProvider implements IDatabaseProvider {
  protected config: ConnectionConfig;
  protected connected: boolean = false;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getDatabases(): Promise<DatabaseInfo[]>;
  abstract getTables(database: string): Promise<TableInfo[]>;
  abstract getTableColumns(database: string, table: string): Promise<TableColumn[]>;
  abstract executeQuery(sql: string, database?: string): Promise<QueryResult>;
  abstract getServerVersion(): Promise<string>;
  abstract getForeignKeys(database: string): Promise<ForeignKeyRelation[]>;

  async cancelCurrentQuery(): Promise<void> {
    throw new Error('Query cancel is not supported by this provider');
  }

  async getTableIndexes(_database: string, _table: string): Promise<TableIndexInfo[]> {
    return [];
  }

  async getTableConstraints(_database: string, _table: string): Promise<TableConstraintInfo[]> {
    return [];
  }

  async getProcedures(_database: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getFunctions(_database: string): Promise<RoutineInfo[]> {
    return [];
  }

  async getTriggers(_database: string): Promise<TriggerInfo[]> {
    return [];
  }

  async beginTransaction(_database?: string): Promise<void> {
    throw new Error('Transaction is not supported by this provider');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('Transaction is not supported by this provider');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('Transaction is not supported by this provider');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
