import * as vscode from 'vscode';
import { ConnectionManager } from '../managers/connectionManager';
import { SQL_KEYWORDS, SQL_FUNCTIONS, SQL_DATA_TYPES, MYSQL_SPECIFIC, POSTGRESQL_SPECIFIC } from '../utils/sqlKeywords';
import { DatabaseType } from '../models/types';

interface TableMetadata {
  name: string;
  columns: { name: string; type: string }[];
}

interface DatabaseMetadata {
  tables: Map<string, TableMetadata>;
  lastRefresh: number;
}

export interface MetadataCacheState {
  exists: boolean;
  lastRefresh?: number;
  stale: boolean;
  refreshing: boolean;
}

export class SqlCompletionProvider implements vscode.CompletionItemProvider {
  private connectionManager: ConnectionManager;
  private metadataCache: Map<string, DatabaseMetadata> = new Map();
  private cacheTimeout: number = 300000;
  private pendingRefresh: Map<string, Promise<DatabaseMetadata | null>> = new Map();

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    
    const textBeforeCursor = document.getText(
      new vscode.Range(new vscode.Position(0, 0), position)
    );
    
    const lineText = document.lineAt(position).text;
    const textBeforePosition = lineText.substring(0, position.character);
    
    const wordMatch = textBeforePosition.match(/(\w+)$/);
    const currentWord = wordMatch ? wordMatch[1] : '';
    
    const contextInfo = this.analyzeContext(textBeforeCursor, currentWord);
    await this.resolveContextDbType(contextInfo);
    
    this.addKeywordCompletions(items, contextInfo);
    
    await this.addDatabaseCompletions(items, contextInfo, currentWord);
    
    return items;
  }

  private analyzeContext(textBeforeCursor: string, currentWord: string): SqlContext {
    const context: SqlContext = {
      afterFrom: false,
      afterJoin: false,
      afterSelect: false,
      afterWhere: false,
      afterOrderBy: false,
      afterGroupBy: false,
      afterHaving: false,
      afterInsert: false,
      afterUpdate: false,
      afterSet: false,
      afterOn: false,
      expectingTable: false,
      expectingColumn: false,
      expectingValue: false,
      currentTable: undefined,
      previousWord: undefined,
      dbType: 'mysql'
    };

    const upperText = textBeforeCursor.toUpperCase();
    const words = upperText.split(/\s+/).filter(w => w.length > 0);
    
    if (words.length > 0) {
      context.previousWord = words[words.length - 1];
      if (currentWord && words[words.length - 1] === currentWord.toUpperCase() && words.length > 1) {
        context.previousWord = words[words.length - 2];
      }
    }

    context.afterFrom = /\bFROM\s*$/i.test(textBeforeCursor) || 
                        /\bFROM\s+\w*$/i.test(textBeforeCursor);
    context.afterJoin = /\bJOIN\s*$/i.test(textBeforeCursor) || 
                        /\bJOIN\s+\w*$/i.test(textBeforeCursor);
    context.afterSelect = /\bSELECT\s*$/i.test(textBeforeCursor) || 
                          /\bSELECT\s+[\w\s,]*$/i.test(textBeforeCursor);
    context.afterWhere = /\bWHERE\s*$/i.test(textBeforeCursor) || 
                         /\bWHERE\s+\w*$/i.test(textBeforeCursor);
    context.afterOrderBy = /\bORDER\s+BY\s*$/i.test(textBeforeCursor) || 
                           /\bORDER\s+BY\s+\w*$/i.test(textBeforeCursor);
    context.afterGroupBy = /\bGROUP\s+BY\s*$/i.test(textBeforeCursor) || 
                           /\bGROUP\s+BY\s+\w*$/i.test(textBeforeCursor);
    context.afterHaving = /\bHAVING\s*$/i.test(textBeforeCursor) || 
                          /\bHAVING\s+\w*$/i.test(textBeforeCursor);
    context.afterInsert = /\bINSERT\s+INTO\s*$/i.test(textBeforeCursor) || 
                          /\bINSERT\s+INTO\s+\w*$/i.test(textBeforeCursor);
    context.afterUpdate = /\bUPDATE\s*$/i.test(textBeforeCursor) || 
                          /\bUPDATE\s+\w*$/i.test(textBeforeCursor);
    context.afterSet = /\bSET\s*$/i.test(textBeforeCursor) || 
                       /\bSET\s+\w*$/i.test(textBeforeCursor);
    context.afterOn = /\bON\s*$/i.test(textBeforeCursor) || 
                      /\bON\s+\w*$/i.test(textBeforeCursor);

    const tableMatch = textBeforeCursor.match(/(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)/i);
    if (tableMatch) {
      context.currentTable = tableMatch[1];
    }

    if (context.afterFrom || context.afterJoin || context.afterUpdate || context.afterInsert) {
      context.expectingTable = true;
    }

    if (context.afterSelect || context.afterWhere || context.afterOrderBy || 
        context.afterGroupBy || context.afterSet || context.afterOn) {
      context.expectingColumn = true;
    }

    if (context.afterWhere || /\b=\s*$/i.test(textBeforeCursor)) {
      context.expectingValue = true;
    }

    return context;
  }

  private addKeywordCompletions(items: vscode.CompletionItem[], context: SqlContext): void {
    const keywords = [...SQL_KEYWORDS];
    const functions = [...SQL_FUNCTIONS];
    const dataTypes = [...SQL_DATA_TYPES];
    
    if (context.dbType === 'mysql') {
      keywords.push(...MYSQL_SPECIFIC);
    } else if (context.dbType === 'postgresql') {
      keywords.push(...POSTGRESQL_SPECIFIC);
    }

    keywords.forEach(keyword => {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.detail = 'SQL Keyword';
      item.insertText = keyword;
      items.push(item);
    });

    functions.forEach(func => {
      const item = new vscode.CompletionItem(func, vscode.CompletionItemKind.Function);
      item.detail = 'SQL Function';
      item.insertText = new vscode.SnippetString(`${func}($1)`);
      items.push(item);
    });

    dataTypes.forEach(type => {
      const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.TypeParameter);
      item.detail = 'SQL Data Type';
      item.insertText = type;
      items.push(item);
    });
  }

  private async resolveContextDbType(context: SqlContext): Promise<void> {
    const activeConnectionId = this.getActiveConnectionId();
    if (!activeConnectionId) {
      return;
    }

    const connections = await this.connectionManager.getConnections();
    const connection = connections.find(c => c.id === activeConnectionId);
    if (connection) {
      context.dbType = connection.type;
    }
  }

  private async addDatabaseCompletions(
    items: vscode.CompletionItem[], 
    context: SqlContext,
    currentWord: string
  ): Promise<void> {
    const connections = await this.connectionManager.getConnections();
    if (connections.length === 0) {
      return;
    }

    const activeConnectionId = this.getActiveConnectionId();
    if (!activeConnectionId) {
      return;
    }

    const provider = this.connectionManager.getProvider(activeConnectionId);
    if (!provider || !provider.isConnected()) {
      return;
    }

    const connection = connections.find(c => c.id === activeConnectionId);
    if (connection) {
      context.dbType = connection.type;
    }

    const database = this.getActiveDatabase();
    if (!database) {
      return;
    }

    const cacheKey = `${activeConnectionId}:${database}`;
    let metadata = this.metadataCache.get(cacheKey);
    
    const now = Date.now();
    if (!metadata || (now - metadata.lastRefresh) > this.cacheTimeout) {
      if (!this.pendingRefresh.has(cacheKey)) {
        const refreshPromise = this.refreshMetadata(cacheKey, provider, database);
        this.pendingRefresh.set(cacheKey, refreshPromise);
      }
      
      if (!metadata) {
        metadata = await this.pendingRefresh.get(cacheKey) || undefined;
      } else {
        this.pendingRefresh.get(cacheKey)?.then(m => {
          if (m) {
            this.metadataCache.set(cacheKey, m);
          }
        });
      }
    }

    if (!metadata) {
      return;
    }

    if (context.expectingTable || context.afterFrom || context.afterJoin || 
        context.afterUpdate || context.afterInsert) {
      metadata.tables.forEach(table => {
        const item = new vscode.CompletionItem(table.name, vscode.CompletionItemKind.Class);
        item.detail = 'Table';
        item.documentation = new vscode.MarkdownString(
          `**${table.name}**\n\nColumns: ${table.columns.length}`
        );
        items.push(item);
      });
    }

    if (context.expectingColumn || context.afterSelect || context.afterWhere || 
        context.afterOrderBy || context.afterGroupBy || context.afterSet) {
      const tableToUse = context.currentTable || this.findTableInContext(currentWord, metadata);
      
      if (tableToUse) {
        const tableMeta = metadata.tables.get(tableToUse.toLowerCase());
        if (tableMeta) {
          tableMeta.columns.forEach(col => {
            const item = new vscode.CompletionItem(col.name, vscode.CompletionItemKind.Field);
            item.detail = `Column (${col.type})`;
            item.documentation = new vscode.MarkdownString(
              `**${col.name}** - ${col.type}\n\nTable: ${tableMeta.name}`
            );
            items.push(item);
          });
        }
      } else {
        metadata.tables.forEach(table => {
          table.columns.forEach(col => {
            const item = new vscode.CompletionItem(
              `${table.name}.${col.name}`, 
              vscode.CompletionItemKind.Field
            );
            item.detail = `Column (${col.type})`;
            item.documentation = new vscode.MarkdownString(
              `**${table.name}.${col.name}** - ${col.type}`
            );
            item.insertText = `${table.name}.${col.name}`;
            items.push(item);
          });
        });
      }
    }
  }

  private async refreshMetadata(
    cacheKey: string, 
    provider: any, 
    database: string
  ): Promise<DatabaseMetadata | null> {
    try {
      const tables = await provider.getTables(database);
      const metadata: DatabaseMetadata = {
        tables: new Map(),
        lastRefresh: Date.now()
      };
      
      for (const table of tables) {
        const columns = await provider.getTableColumns(database, table.name);
        metadata.tables.set(table.name.toLowerCase(), {
          name: table.name,
          columns: columns.map((c: any) => ({ name: c.name, type: c.type }))
        });
      }
      
      this.metadataCache.set(cacheKey, metadata);
      this.pendingRefresh.delete(cacheKey);
      return metadata;
    } catch (error) {
      this.pendingRefresh.delete(cacheKey);
      return null;
    }
  }

  private findTableInContext(currentWord: string, metadata: DatabaseMetadata): string | undefined {
    if (currentWord && currentWord.includes('.')) {
      const tableName = currentWord.split('.')[0];
      if (metadata.tables.has(tableName.toLowerCase())) {
        return tableName;
      }
    }
    return undefined;
  }

  private getActiveConnectionId(): string | undefined {
    return (globalThis as any).minidb_activeConnectionId;
  }

  private getActiveDatabase(): string | undefined {
    return (globalThis as any).minidb_activeDatabase;
  }

  static setActiveConnection(connectionId: string | undefined, database?: string): void {
    (globalThis as any).minidb_activeConnectionId = connectionId;
    (globalThis as any).minidb_activeDatabase = database;
  }

  clearCache(): void {
    this.metadataCache.clear();
  }

  refreshCache(connectionId: string, database: string): void {
    const cacheKey = `${connectionId}:${database}`;
    this.metadataCache.delete(cacheKey);
  }

  async preloadMetadata(connectionId: string, database: string): Promise<void> {
    const provider = this.connectionManager.getProvider(connectionId);
    if (!provider || !provider.isConnected()) {
      return;
    }

    const cacheKey = `${connectionId}:${database}`;
    if (this.metadataCache.has(cacheKey) || this.pendingRefresh.has(cacheKey)) {
      return;
    }

    const refreshPromise = this.refreshMetadata(cacheKey, provider, database);
    this.pendingRefresh.set(cacheKey, refreshPromise);
  }

  getCacheState(connectionId: string, database: string): MetadataCacheState {
    const cacheKey = `${connectionId}:${database}`;
    const cached = this.metadataCache.get(cacheKey);
    const refreshing = this.pendingRefresh.has(cacheKey);
    if (!cached) {
      return {
        exists: false,
        stale: false,
        refreshing
      };
    }

    return {
      exists: true,
      lastRefresh: cached.lastRefresh,
      stale: Date.now() - cached.lastRefresh > this.cacheTimeout,
      refreshing
    };
  }
}

interface SqlContext {
  afterFrom: boolean;
  afterJoin: boolean;
  afterSelect: boolean;
  afterWhere: boolean;
  afterOrderBy: boolean;
  afterGroupBy: boolean;
  afterHaving: boolean;
  afterInsert: boolean;
  afterUpdate: boolean;
  afterSet: boolean;
  afterOn: boolean;
  expectingTable: boolean;
  expectingColumn: boolean;
  expectingValue: boolean;
  currentTable: string | undefined;
  previousWord: string | undefined;
  dbType: DatabaseType;
}
