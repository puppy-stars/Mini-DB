import * as vscode from 'vscode';
import { ConnectionConfig } from '../models/types';
import { ConnectionManager } from '../managers/connectionManager';
import { i18n } from '../i18n';

export type ConnectionStatusType = 'connected' | 'disconnected' | 'connecting' | 'error';

export type TreeItemType =
  | 'connection'
  | 'connectedConnection'
  | 'database'
  | 'tablesFolder'
  | 'viewsFolder'
  | 'proceduresFolder'
  | 'functionsFolder'
  | 'triggersFolder'
  | 'table'
  | 'view'
  | 'columnsFolder'
  | 'indexesFolder'
  | 'constraintsFolder'
  | 'column'
  | 'index'
  | 'constraint'
  | 'procedure'
  | 'function'
  | 'trigger';

export class DatabaseTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: TreeItemType,
    public readonly connectionId?: string,
    public readonly databaseName?: string,
    public readonly tableName?: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly config?: ConnectionConfig,
    public readonly connectionStatus: ConnectionStatusType = 'disconnected',
    public readonly detail?: string
  ) {
    super(label, collapsibleState);

    this.contextValue = itemType;
    this.iconPath = this.getIcon();

    if (itemType === 'connection' || itemType === 'connectedConnection') {
      this.description = this.getConnectionDescription();
    }

    if (itemType === 'table' || itemType === 'view') {
      this.command = {
        command: 'minidb.viewTableData',
        title: 'View Table Data',
        arguments: [this]
      };
    }

    this.tooltip = this.getTooltip();
  }

  private getConnectionDescription(): string {
    const host = this.config?.host || '';
    const statusDot = this.getStatusDot();
    const statusText = this.getStatusText();
    return host ? `${host}  ${statusDot} ${statusText}` : `${statusDot} ${statusText}`;
  }

  private getStatusDot(): string {
    switch (this.connectionStatus) {
      case 'connected':
        return '🟢';
      case 'connecting':
        return '🟡';
      case 'error':
        return '🔴';
      case 'disconnected':
      default:
        return '⚪';
    }
  }

  private getStatusText(): string {
    const strings = i18n.strings;
    switch (this.connectionStatus) {
      case 'connected':
        return strings.treeView.statusConnected;
      case 'disconnected':
        return strings.treeView.statusDisconnected;
      case 'connecting':
        return strings.treeView.statusConnecting;
      case 'error':
        return strings.treeView.statusError;
      default:
        return strings.treeView.statusDisconnected;
    }
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.itemType) {
      case 'connection':
      case 'connectedConnection':
        return this.getConnectionIcon();
      case 'database':
        return new vscode.ThemeIcon('folder-database');
      case 'tablesFolder':
      case 'viewsFolder':
      case 'proceduresFolder':
      case 'functionsFolder':
      case 'triggersFolder':
      case 'columnsFolder':
      case 'indexesFolder':
      case 'constraintsFolder':
        return new vscode.ThemeIcon('folder');
      case 'table':
        return new vscode.ThemeIcon('table');
      case 'view':
        return new vscode.ThemeIcon('eye');
      case 'column':
        return new vscode.ThemeIcon('symbol-field');
      case 'index':
        return new vscode.ThemeIcon('symbol-namespace');
      case 'constraint':
        return new vscode.ThemeIcon('shield');
      case 'procedure':
      case 'function':
        return new vscode.ThemeIcon('symbol-method');
      case 'trigger':
        return new vscode.ThemeIcon('zap');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }

  private getConnectionIcon(): vscode.ThemeIcon {
    return new vscode.ThemeIcon('database', this.getConnectionStatusColor());
  }

  private getConnectionStatusColor(): vscode.ThemeColor {
    switch (this.connectionStatus) {
      case 'connected':
        return new vscode.ThemeColor('charts.green');
      case 'connecting':
        return new vscode.ThemeColor('charts.yellow');
      case 'error':
        return new vscode.ThemeColor('charts.red');
      case 'disconnected':
      default:
        return new vscode.ThemeColor('disabledForeground');
    }
  }

  private getTooltip(): string {
    const strings = i18n.strings;
    switch (this.itemType) {
      case 'connection':
      case 'connectedConnection':
        return `${this.config?.name} (${this.config?.type})\n${this.config?.host}:${this.config?.port}`;
      case 'database':
        return `${strings.treeView.tables}: ${this.databaseName}`;
      case 'table':
        return `${strings.treeView.tables}: ${this.tableName}`;
      case 'view':
        return `${strings.treeView.views}: ${this.tableName}`;
      case 'index':
      case 'constraint':
      case 'trigger':
        return this.detail ? `${this.label}\n${this.detail}` : this.label;
      default:
        return this.label;
    }
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<DatabaseTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DatabaseTreeItem | undefined | null | void> = new vscode.EventEmitter<DatabaseTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DatabaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private connectionManager: ConnectionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  refreshItem(item: DatabaseTreeItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  getTreeItem(element: DatabaseTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DatabaseTreeItem): Promise<DatabaseTreeItem[]> {
    if (!element) {
      return this.getConnections();
    }

    switch (element.itemType) {
      case 'connection':
      case 'connectedConnection':
        return this.getDatabases(element.connectionId!);
      case 'database':
        return this.getDatabaseFolders(element.connectionId!, element.databaseName!);
      case 'tablesFolder':
        return this.getTables(element.connectionId!, element.databaseName!);
      case 'viewsFolder':
        return this.getViews(element.connectionId!, element.databaseName!);
      case 'proceduresFolder':
        return this.getProcedures(element.connectionId!, element.databaseName!);
      case 'functionsFolder':
        return this.getFunctions(element.connectionId!, element.databaseName!);
      case 'triggersFolder':
        return this.getTriggers(element.connectionId!, element.databaseName!);
      case 'table':
        return this.getTableFolders(element.connectionId!, element.databaseName!, element.tableName!);
      case 'view':
      case 'columnsFolder':
        return this.getTableColumns(element.connectionId!, element.databaseName!, element.tableName!);
      case 'indexesFolder':
        return this.getTableIndexes(element.connectionId!, element.databaseName!, element.tableName!);
      case 'constraintsFolder':
        return this.getTableConstraints(element.connectionId!, element.databaseName!, element.tableName!);
      default:
        return [];
    }
  }

  private getMetaLabels(): {
    columns: string;
    indexes: string;
    constraints: string;
    procedures: string;
    functions: string;
    triggers: string;
  } {
    if (i18n.language === 'zh') {
      return {
        columns: '列',
        indexes: '索引',
        constraints: '约束',
        procedures: '存储过程',
        functions: '函数',
        triggers: '触发器'
      };
    }

    return {
      columns: 'Columns',
      indexes: 'Indexes',
      constraints: 'Constraints',
      procedures: 'Procedures',
      functions: 'Functions',
      triggers: 'Triggers'
    };
  }

  private async getConnections(): Promise<DatabaseTreeItem[]> {
    const connections = await this.connectionManager.getConnections();
    const strings = i18n.strings;

    if (connections.length === 0) {
      return [
        new DatabaseTreeItem(
          strings.treeView.noConnections,
          'connection',
          undefined,
          undefined,
          undefined,
          vscode.TreeItemCollapsibleState.None
        )
      ];
    }

    return connections.map(conn => {
      const isConnected = this.connectionManager.isConnected(conn.id);
      const status: ConnectionStatusType = isConnected ? 'connected' : 'disconnected';
      return new DatabaseTreeItem(
        conn.name,
        isConnected ? 'connectedConnection' : 'connection',
        conn.id,
        undefined,
        undefined,
        isConnected ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        conn,
        status
      );
    });
  }

  private async getDatabases(connectionId: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = await this.connectionManager.connect(connectionId);
      const databases = await provider.getDatabases();

      if (databases.length === 0) {
        return [
          new DatabaseTreeItem(
            i18n.strings.treeView.noTables,
            'database',
            connectionId
          )
        ];
      }

      return databases.map(db =>
        new DatabaseTreeItem(
          db.name,
          'database',
          connectionId,
          db.name,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'database',
          connectionId
        )
      ];
    }
  }

  private async getDatabaseFolders(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider) {
        return [];
      }

      const labels = this.getMetaLabels();
      const [tables, procedures, functions, triggers] = await Promise.all([
        provider.getTables(database),
        provider.getProcedures ? provider.getProcedures(database) : Promise.resolve([]),
        provider.getFunctions ? provider.getFunctions(database) : Promise.resolve([]),
        provider.getTriggers ? provider.getTriggers(database) : Promise.resolve([])
      ]);

      const regularTables = tables.filter(t => t.type === 'TABLE');
      const views = tables.filter(t => t.type === 'VIEW');
      const items: DatabaseTreeItem[] = [];

      if (regularTables.length > 0) {
        items.push(new DatabaseTreeItem(
          `${i18n.strings.treeView.tables} (${regularTables.length})`,
          'tablesFolder',
          connectionId,
          database,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (views.length > 0) {
        items.push(new DatabaseTreeItem(
          `${i18n.strings.treeView.views} (${views.length})`,
          'viewsFolder',
          connectionId,
          database,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (procedures.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.procedures} (${procedures.length})`,
          'proceduresFolder',
          connectionId,
          database,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (functions.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.functions} (${functions.length})`,
          'functionsFolder',
          connectionId,
          database,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (triggers.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.triggers} (${triggers.length})`,
          'triggersFolder',
          connectionId,
          database,
          undefined,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (items.length === 0) {
        return [
          new DatabaseTreeItem(
            i18n.strings.treeView.noTables,
            'table',
            connectionId,
            database
          )
        ];
      }

      return items;
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'table',
          connectionId,
          database
        )
      ];
    }
  }

  private async getTables(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider) {
        return [];
      }

      const tables = await provider.getTables(database);
      const regularTables = tables.filter(t => t.type === 'TABLE');

      return regularTables.map(table =>
        new DatabaseTreeItem(
          table.name,
          'table',
          connectionId,
          database,
          table.name,
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'table',
          connectionId,
          database
        )
      ];
    }
  }

  private async getViews(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider) {
        return [];
      }

      const tables = await provider.getTables(database);
      const views = tables.filter(t => t.type === 'VIEW');

      return views.map(view =>
        new DatabaseTreeItem(
          view.name,
          'view',
          connectionId,
          database,
          view.name,
          vscode.TreeItemCollapsibleState.Collapsed
        )
      );
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'view',
          connectionId,
          database
        )
      ];
    }
  }

  private async getProcedures(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider || !provider.getProcedures) {
        return [];
      }

      const routines = await provider.getProcedures(database);
      return routines.map(routine =>
        new DatabaseTreeItem(
          routine.name,
          'procedure',
          connectionId,
          database
        )
      );
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'procedure',
          connectionId,
          database
        )
      ];
    }
  }

  private async getFunctions(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider || !provider.getFunctions) {
        return [];
      }

      const routines = await provider.getFunctions(database);
      return routines.map(routine =>
        new DatabaseTreeItem(
          routine.name,
          'function',
          connectionId,
          database
        )
      );
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'function',
          connectionId,
          database
        )
      ];
    }
  }

  private async getTriggers(connectionId: string, database: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider || !provider.getTriggers) {
        return [];
      }

      const triggers = await provider.getTriggers(database);
      return triggers.map(trigger => {
        const detail = [trigger.tableName, trigger.event].filter(Boolean).join(' | ');
        const item = new DatabaseTreeItem(
          trigger.name,
          'trigger',
          connectionId,
          database,
          trigger.tableName,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'disconnected',
          detail || undefined
        );
        item.description = detail || undefined;
        return item;
      });
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'trigger',
          connectionId,
          database
        )
      ];
    }
  }

  private async getTableFolders(connectionId: string, database: string, table: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider) {
        return [];
      }

      const labels = this.getMetaLabels();
      const [columns, indexes, constraints] = await Promise.all([
        provider.getTableColumns(database, table),
        provider.getTableIndexes ? provider.getTableIndexes(database, table) : Promise.resolve([]),
        provider.getTableConstraints ? provider.getTableConstraints(database, table) : Promise.resolve([])
      ]);

      const items: DatabaseTreeItem[] = [];
      if (columns.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.columns} (${columns.length})`,
          'columnsFolder',
          connectionId,
          database,
          table,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (indexes.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.indexes} (${indexes.length})`,
          'indexesFolder',
          connectionId,
          database,
          table,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (constraints.length > 0) {
        items.push(new DatabaseTreeItem(
          `${labels.constraints} (${constraints.length})`,
          'constraintsFolder',
          connectionId,
          database,
          table,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (items.length > 0) {
        return items;
      }

      return this.getTableColumns(connectionId, database, table);
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'column',
          connectionId,
          database,
          table
        )
      ];
    }
  }

  private async getTableColumns(connectionId: string, database: string, table: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider) {
        return [];
      }

      const columns = await provider.getTableColumns(database, table);

      return columns.map(col => {
        const item = new DatabaseTreeItem(
          `${col.name}: ${col.type}`,
          'column',
          connectionId,
          database,
          table
        );
        item.description = col.isPrimaryKey ? '[PK]' : (col.nullable ? 'NULL' : 'NOT NULL');
        return item;
      });
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'column',
          connectionId,
          database,
          table
        )
      ];
    }
  }

  private async getTableIndexes(connectionId: string, database: string, table: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider || !provider.getTableIndexes) {
        return [];
      }

      const indexes = await provider.getTableIndexes(database, table);
      return indexes.map(index => {
        const detailParts = [
          index.unique ? 'UNIQUE' : 'INDEX',
          index.type || '',
          index.columns.length > 0 ? `(${index.columns.join(', ')})` : ''
        ].filter(Boolean);

        const detail = detailParts.join(' ');
        const item = new DatabaseTreeItem(
          index.name,
          'index',
          connectionId,
          database,
          table,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'disconnected',
          detail
        );
        item.description = detail;
        return item;
      });
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'index',
          connectionId,
          database,
          table
        )
      ];
    }
  }

  private async getTableConstraints(connectionId: string, database: string, table: string): Promise<DatabaseTreeItem[]> {
    try {
      const provider = this.connectionManager.getProvider(connectionId);
      if (!provider || !provider.getTableConstraints) {
        return [];
      }

      const constraints = await provider.getTableConstraints(database, table);
      return constraints.map(constraint => {
        const item = new DatabaseTreeItem(
          constraint.name,
          'constraint',
          connectionId,
          database,
          table,
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'disconnected',
          constraint.type
        );
        item.description = constraint.type;
        return item;
      });
    } catch (error) {
      return [
        new DatabaseTreeItem(
          `${i18n.strings.treeView.errorPrefix}${error instanceof Error ? error.message : String(error)}`,
          'constraint',
          connectionId,
          database,
          table
        )
      ];
    }
  }
}
