import * as vscode from 'vscode';

export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'sqlserver' | 'oracle';
export type ConnectionEnvironment = 'prod' | 'test' | 'dev';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ConnectionPoolConfig {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  acquireTimeoutMillis: number;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  environment?: ConnectionEnvironment;
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  passwordMigrated?: boolean;
  connectTimeout?: number;
  retry?: RetryConfig;
  ssh?: SSHConfig;
  pool?: ConnectionPoolConfig;
  filePath?: string;
  instanceName?: string;
  serviceName?: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: 'TABLE' | 'VIEW';
  rowCount?: number;
}

export interface DatabaseInfo {
  name: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  affectedRows?: number;
  executionTime: number;
  columnMetadata?: QueryColumnMetadata[];
}

export interface QueryColumnMetadata {
  name: string;
  type?: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
}

export interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface PaginatedResult {
  rows: Record<string, unknown>[];
  pagination: PaginationState;
}

export interface ConnectionStatus {
  isConnected: boolean;
  serverVersion?: string;
  error?: string;
}

export interface ForeignKeyRelation {
  constraintName: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface TableIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  type?: string;
}

export interface TableConstraintInfo {
  name: string;
  type: string;
}

export interface RoutineInfo {
  name: string;
  type: 'PROCEDURE' | 'FUNCTION';
}

export interface TriggerInfo {
  name: string;
  tableName?: string;
  event?: string;
}

export interface TableRelation {
  tableName: string;
  columns: TableColumn[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyRelation[];
  referencedBy: ForeignKeyRelation[];
}

export const CONNECTIONS_KEY = 'minidb.connections';

export function getConnectionIcon(type: DatabaseType): vscode.ThemeIcon {
  switch (type) {
    case 'mysql':
      return new vscode.ThemeIcon('database');
    case 'postgresql':
      return new vscode.ThemeIcon('server');
    case 'sqlite':
      return new vscode.ThemeIcon('file');
    case 'sqlserver':
      return new vscode.ThemeIcon('server-process');
    case 'oracle':
      return new vscode.ThemeIcon('cloud');
    default:
      return new vscode.ThemeIcon('database');
  }
}
