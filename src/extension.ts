import * as vscode from 'vscode';
import { ConnectionManager } from './managers/connectionManager';
import { ConnectionTreeProvider, DatabaseTreeItem } from './views/connectionTreeProvider';
import { ConnectionConfig, DatabaseType, QueryResult } from './models/types';
import { ConnectionFormPanel } from './views/connectionFormPanel';
import { QueryResultPanel } from './views/queryResultPanel';
import { TableRelationPanel } from './views/tableRelationPanel';
import { SqlConsolePanel } from './views/sqlConsolePanel';
import { TableStructurePanel } from './views/tableStructurePanel';
import { DataEditorPanel } from './views/dataEditorPanel';
import { ExplainPlanPanel } from './views/explainPlanPanel';
import { IDatabaseProvider } from './providers/databaseProvider';
import { HomePanel, HomeSnapshot, HomeActionName, HomeActionPayload, HomeCardId } from './views/homePanel';
import {
  ConnectionDetailsPanel,
  ConnectionDetailsPayload,
  ConnectionDetailsDatabase
} from './views/connectionDetailsPanel';
import { i18n, Language } from './i18n';
import { SqlEscape } from './utils/sqlEscape';
import { extractTotalRows } from './utils/queryResultUtils';
import { QueryHistoryManager } from './utils/queryHistory';
import { ObjectFavoritesManager, FavoriteObjectType } from './utils/objectFavorites';
import { parseImportFile } from './utils/importParser';
import { SqlCompletionProvider } from './providers/sqlCompletionProvider';
import { SqlFormatter, SqlFormattingEditProvider, SqlRangeFormattingEditProvider } from './utils/sqlFormatter';

let connectionManager: ConnectionManager;
let treeProvider: ConnectionTreeProvider;
let activeQueryConnection: string | undefined;
let activeQueryDatabase: string | undefined;
let statusBarItem: vscode.StatusBarItem;
let sqlCompletionProvider: SqlCompletionProvider;
let queryHistoryManager: QueryHistoryManager;
let objectFavoritesManager: ObjectFavoritesManager;
let runningQueryConnectionId: string | undefined;
let homeContextSelectionConnectionId: string | undefined;
let homeContextSelectionDatabase: string | undefined;
const DEFAULT_QUERY_PAGE_SIZE = 50;
const LANGUAGE_CONTEXT_KEY = 'minidb.language';
const LAST_ACTIVE_CONTEXT_KEY = 'minidb.lastActiveContext';

interface MetadataRefreshState {
  connectionId?: string;
  database?: string;
  isRefreshing: boolean;
  lastRefreshAt?: number;
  lastCacheAt?: number;
  lastDurationMs?: number;
  lastError?: string;
}

const metadataRefreshState: MetadataRefreshState = {
  isRefreshing: false
};

interface PersistedActiveContext {
  connectionId: string;
  databaseName?: string | null;
  updatedAt: number;
}

let workspaceStateStore: vscode.Memento | undefined;

function persistActiveContext(connectionId: string | undefined, databaseName: string | undefined): void {
  if (!workspaceStateStore) {
    return;
  }

  if (!connectionId) {
    void workspaceStateStore.update(LAST_ACTIVE_CONTEXT_KEY, undefined);
    return;
  }

  const payload: PersistedActiveContext = {
    connectionId,
    databaseName: databaseName ?? null,
    updatedAt: Date.now()
  };
  void workspaceStateStore.update(LAST_ACTIVE_CONTEXT_KEY, payload);
}

function setActiveQueryContext(connectionId: string | undefined, databaseName: string | undefined): void {
  activeQueryConnection = connectionId;
  activeQueryDatabase = databaseName;
  SqlCompletionProvider.setActiveConnection(connectionId, databaseName);
  persistActiveContext(connectionId, databaseName);
  updateStatusBar();
}

async function restorePersistedActiveContext(): Promise<void> {
  const saved = workspaceStateStore?.get<PersistedActiveContext>(LAST_ACTIVE_CONTEXT_KEY);
  if (!saved?.connectionId) {
    return;
  }

  const connections = await connectionManager.getConnections();
  const exists = connections.some(connection => connection.id === saved.connectionId);
  if (!exists) {
    void workspaceStateStore?.update(LAST_ACTIVE_CONTEXT_KEY, undefined);
    return;
  }

  setActiveQueryContext(saved.connectionId, saved.databaseName ?? undefined);

  const restoreStrategy = vscode.workspace
    .getConfiguration('minidb')
    .get<'contextOnly' | 'autoConnect'>('startupRestoreStrategy', 'contextOnly');

  if (restoreStrategy !== 'autoConnect') {
    return;
  }

  try {
    await connectionManager.connect(saved.connectionId);
    treeProvider.refresh();
    if (saved.databaseName) {
      void sqlCompletionProvider.preloadMetadata(saved.connectionId, saved.databaseName);
    }
  } catch {
    // Ignore startup auto-connect failures and keep restored context only.
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  workspaceStateStore = context.workspaceState;
  const config = vscode.workspace.getConfiguration('minidb');
  const languageConfig = config.inspect<Language>('language');
  const configuredLanguage =
    languageConfig?.workspaceFolderValue ??
    languageConfig?.workspaceValue ??
    languageConfig?.globalValue;
  const detectedLanguage: Language = vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  i18n.language = configuredLanguage ?? detectedLanguage;
  await vscode.commands.executeCommand('setContext', LANGUAGE_CONTEXT_KEY, i18n.language);

  connectionManager = new ConnectionManager(context);
  queryHistoryManager = new QueryHistoryManager(context);
  objectFavoritesManager = new ObjectFavoritesManager(context);
  treeProvider = new ConnectionTreeProvider(connectionManager);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'minidb.selectConnection';
  context.subscriptions.push(statusBarItem);

  const treeView = vscode.window.createTreeView('minidb.connections', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'sql') {
        updateStatusBar();
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }
    })
  );

  if (vscode.window.activeTextEditor?.document.languageId === 'sql') {
    updateStatusBar();
    statusBarItem.show();
  }

  registerSqlIntelligence(context);
  await restorePersistedActiveContext();
  registerCommands(context);

  let homeOpenedForSession = false;
  const openHomeIfNeeded = async () => {
    if (homeOpenedForSession) {
      return;
    }
    homeOpenedForSession = true;
    await vscode.commands.executeCommand('minidb.openHome');
  };

  context.subscriptions.push(
    treeView.onDidChangeVisibility(event => {
      if (event.visible) {
        void openHomeIfNeeded();
      }
    })
  );

  if (treeView.visible) {
    void openHomeIfNeeded();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('minidb.language')) {
        const config = vscode.workspace.getConfiguration('minidb');
        const newLang = config.get<Language>('language', 'en');
        i18n.language = newLang;
        void vscode.commands.executeCommand('setContext', LANGUAGE_CONTEXT_KEY, newLang);
        treeProvider.refresh();
      }
      if (e.affectsConfiguration('minidb')) {
        treeProvider.refresh();
      }
    })
  );
}

function registerSqlIntelligence(context: vscode.ExtensionContext): void {
  sqlCompletionProvider = new SqlCompletionProvider(connectionManager);

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'sql',
    sqlCompletionProvider,
    '.', ' ', '('
  );
  context.subscriptions.push(completionProvider);

  const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'sql',
    new SqlFormattingEditProvider()
  );
  context.subscriptions.push(formattingProvider);

  const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    'sql',
    new SqlRangeFormattingEditProvider()
  );
  context.subscriptions.push(rangeFormattingProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.formatSql', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'sql') {
        vscode.window.showErrorMessage(i18n.strings.sqlIntelligence.noSqlFile);
        return;
      }

      const document = editor.document;
      const text = document.getText();
      const options = vscode.workspace.getConfiguration('editor');
      const indent = options.get<boolean>('insertSpaces', true) 
        ? ' '.repeat(options.get<number>('tabSize', 2))
        : '\t';

      const formatted = SqlFormatter.format(text, {
        indent,
        uppercase: true,
        linesBetweenQueries: 1
      });

      const edit = vscode.TextEdit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        ),
        formatted
      );

      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(document.uri, [edit]);
      await vscode.workspace.applyEdit(workspaceEdit);
      
      vscode.window.showInformationMessage(i18n.strings.sqlIntelligence.formatSuccess);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.refreshMetadata', async () => {
      const isChinese = i18n.language === 'zh';
      const strings = i18n.strings;
      const connections = await connectionManager.getConnections();
      if (connections.length === 0) {
        vscode.window.showWarningMessage(strings.messages.noConnections);
        return;
      }

      let targetConnectionId = activeQueryConnection;
      let targetDatabase = activeQueryDatabase;

      if (!targetConnectionId || !connections.some(c => c.id === targetConnectionId)) {
        const connectedConnections = connections.filter(c => connectionManager.isConnected(c.id));
        if (connectedConnections.length === 1) {
          targetConnectionId = connectedConnections[0].id;
        } else if (connectedConnections.length > 1) {
          const selectedConnected = await vscode.window.showQuickPick(
            connectedConnections.map(connection => ({
              label: connection.name,
              description: `${connection.type} - ${connection.host}:${connection.port}`,
              id: connection.id
            })),
            {
              placeHolder: isChinese ? '选择已连接的数据库连接' : 'Select a connected database connection'
            }
          );
          if (!selectedConnected) {
            return;
          }
          targetConnectionId = selectedConnected.id;
        } else {
          const selected = await vscode.window.showQuickPick(
            connections.map(connection => ({
              label: connection.name,
              description: `${connection.type} - ${connection.host}:${connection.port}`,
              id: connection.id
            })),
            {
              placeHolder: strings.messages.selectConnection
            }
          );
          if (!selected) {
            return;
          }
          targetConnectionId = selected.id;
        }
      }

      if (!targetConnectionId) {
        vscode.window.showWarningMessage(strings.sqlIntelligence.noActiveConnection);
        return;
      }

      let provider = connectionManager.getProvider(targetConnectionId);
      if (!provider || !provider.isConnected()) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: strings.messages.connectingDb || strings.messages.connecting,
            cancellable: false
          },
          async () => {
            await connectionManager.connect(targetConnectionId!);
          }
        );
        provider = connectionManager.getProvider(targetConnectionId);
        treeProvider.refresh();
      }

      if (!provider || !provider.isConnected()) {
        vscode.window.showWarningMessage(strings.messages.notConnected);
        return;
      }

      if (!targetDatabase) {
        const connConfig = connections.find(c => c.id === targetConnectionId);
        if (connConfig?.database) {
          targetDatabase = connConfig.database;
        }
      }

      if (!targetDatabase) {
        const databases = await provider.getDatabases();
        if (databases.length === 0) {
          vscode.window.showWarningMessage(
            isChinese ? '该连接下未找到数据库。' : 'No databases found for this connection.'
          );
          return;
        }

        if (databases.length === 1) {
          targetDatabase = databases[0].name;
        } else {
          const selectedDatabase = await vscode.window.showQuickPick(
            databases.map(database => ({
              label: database.name
            })),
            {
              placeHolder: isChinese ? '选择要刷新的数据库元数据' : 'Select database metadata to refresh'
            }
          );
          if (!selectedDatabase) {
            return;
          }
          targetDatabase = selectedDatabase.label;
        }
      }

      if (!targetDatabase) {
        vscode.window.showWarningMessage(strings.sqlIntelligence.noActiveConnection);
        return;
      }

      const refreshStartedAt = Date.now();
      metadataRefreshState.isRefreshing = true;
      metadataRefreshState.connectionId = targetConnectionId;
      metadataRefreshState.database = targetDatabase;
      metadataRefreshState.lastError = undefined;
      void HomePanel.currentPanel?.refresh().catch(() => undefined);

      try {
        setActiveQueryContext(targetConnectionId, targetDatabase);
        sqlCompletionProvider.refreshCache(targetConnectionId, targetDatabase);
        await sqlCompletionProvider.preloadMetadata(targetConnectionId, targetDatabase);
        const cacheState = sqlCompletionProvider.getCacheState(targetConnectionId, targetDatabase);
        metadataRefreshState.lastRefreshAt = Date.now();
        metadataRefreshState.lastDurationMs = Date.now() - refreshStartedAt;
        metadataRefreshState.lastCacheAt = cacheState.lastRefresh;
        metadataRefreshState.lastError = undefined;
        vscode.window.showInformationMessage(strings.sqlIntelligence.metadataRefreshed);
      } catch (error) {
        metadataRefreshState.lastError = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(metadataRefreshState.lastError);
      } finally {
        metadataRefreshState.isRefreshing = false;
        void HomePanel.currentPanel?.refresh().catch(() => undefined);
      }
    })
  );
}

function updateStatusBar(): void {
  const s = i18n.strings;
  if (activeQueryConnection) {
    connectionManager.getConnections().then(connections => {
      const conn = connections.find(c => c.id === activeQueryConnection);
      if (conn) {
        const dbInfo = activeQueryDatabase ? ` - ${activeQueryDatabase}` : '';
        statusBarItem.text = `$(database) ${conn.name}${dbInfo}`;
        statusBarItem.tooltip = `Connected to: ${conn.host}:${conn.port}`;
      }
    });
  } else {
    statusBarItem.text = `$(database) ${s.statusBar.noConnection}`;
    statusBarItem.tooltip = s.statusBar.tooltip;
  }
}

function registerCommands(context: vscode.ExtensionContext): void {
  let s = i18n.strings;
  let isChinese = i18n.language === 'zh';
  const formatError = (error: unknown): string => error instanceof Error ? error.message : String(error);
  const failedToConnectMessage = (error: unknown): string =>
    `${isChinese ? '\u8fde\u63a5\u5931\u8d25' : 'Failed to connect'}: ${formatError(error)}`;
  const queryCancelledByUserMessage = isChinese ? '\u67e5\u8be2\u5df2\u88ab\u7528\u6237\u53d6\u6d88' : 'Query cancelled by user';

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('minidb.language')) {
        s = i18n.strings;
        isChinese = i18n.language === 'zh';
      }
    })
  );

  const localizedMenuCommandMap: Array<{ aliasId: string; targetId: string }> = [
    { aliasId: 'minidb.menu.connect.en', targetId: 'minidb.connect' },
    { aliasId: 'minidb.menu.connect.zh', targetId: 'minidb.connect' },
    { aliasId: 'minidb.menu.disconnect.en', targetId: 'minidb.disconnect' },
    { aliasId: 'minidb.menu.disconnect.zh', targetId: 'minidb.disconnect' },
    { aliasId: 'minidb.menu.editConnection.en', targetId: 'minidb.editConnection' },
    { aliasId: 'minidb.menu.editConnection.zh', targetId: 'minidb.editConnection' },
    { aliasId: 'minidb.menu.deleteConnection.en', targetId: 'minidb.deleteConnection' },
    { aliasId: 'minidb.menu.deleteConnection.zh', targetId: 'minidb.deleteConnection' },
    { aliasId: 'minidb.menu.newQuery.en', targetId: 'minidb.newQuery' },
    { aliasId: 'minidb.menu.newQuery.zh', targetId: 'minidb.newQuery' },
    { aliasId: 'minidb.menu.refreshTables.en', targetId: 'minidb.refreshTables' },
    { aliasId: 'minidb.menu.refreshTables.zh', targetId: 'minidb.refreshTables' },
    { aliasId: 'minidb.menu.viewTableData.en', targetId: 'minidb.viewTableData' },
    { aliasId: 'minidb.menu.viewTableData.zh', targetId: 'minidb.viewTableData' },
    { aliasId: 'minidb.menu.editTableData.en', targetId: 'minidb.editTableData' },
    { aliasId: 'minidb.menu.editTableData.zh', targetId: 'minidb.editTableData' },
    { aliasId: 'minidb.menu.importData.en', targetId: 'minidb.importData' },
    { aliasId: 'minidb.menu.importData.zh', targetId: 'minidb.importData' },
    { aliasId: 'minidb.menu.viewTableStructure.en', targetId: 'minidb.viewTableStructure' },
    { aliasId: 'minidb.menu.viewTableStructure.zh', targetId: 'minidb.viewTableStructure' },
    { aliasId: 'minidb.menu.viewTableRelations.en', targetId: 'minidb.viewTableRelations' },
    { aliasId: 'minidb.menu.viewTableRelations.zh', targetId: 'minidb.viewTableRelations' },
    { aliasId: 'minidb.menu.openSqlConsole.en', targetId: 'minidb.openSqlConsole' },
    { aliasId: 'minidb.menu.openSqlConsole.zh', targetId: 'minidb.openSqlConsole' }
  ];

  for (const mapping of localizedMenuCommandMap) {
    context.subscriptions.push(
      vscode.commands.registerCommand(mapping.aliasId, async (...args: unknown[]) => {
        await vscode.commands.executeCommand(mapping.targetId, ...args);
      })
    );
  }

  const refreshHomePanel = async (): Promise<void> => {
    if (!HomePanel.currentPanel) {
      return;
    }
    await HomePanel.currentPanel.refresh().catch(() => undefined);
  };

  const HOME_CARD_ORDER_KEY = 'minidb.home.cardOrder';
  const HOME_CARD_HIDDEN_KEY = 'minidb.home.hiddenCards';
  const HOME_CARD_FIXED_ID: HomeCardId = 'connections';
  const HOME_CARD_CONFIGURABLE_ORDER: HomeCardId[] = [
    'quickActions',
    'metadata',
    'recentQueries',
    'favoriteQueries',
    'favoriteObjects'
  ];
  const HOME_CARD_DEFAULT_ORDER: HomeCardId[] = [
    HOME_CARD_FIXED_ID,
    ...HOME_CARD_CONFIGURABLE_ORDER
  ];
  const HOME_HEALTH_CACHE_TTL_MS = 30_000;

  interface HomeCardLayout {
    cardOrder: HomeCardId[];
    hiddenCards: HomeCardId[];
  }

  interface ConnectionHealthState {
    latencyMs?: number;
    serverVersion?: string;
    error?: string;
    checkedAt: number;
  }

  interface NamedQuickPick extends vscode.QuickPickItem {
    id: string;
  }

  interface HomeContextDatabaseState {
    name: string;
  }

  const homeHealthCache = new Map<string, ConnectionHealthState>();
  const homeHealthInFlight = new Map<string, Promise<void>>();
  const homeContextDatabasesCache = new Map<string, HomeContextDatabaseState[]>();
  const homeContextDatabasesError = new Map<string, string>();
  const homeContextDatabasesLoading = new Set<string>();

  const isHomeCardId = (value: string): value is HomeCardId =>
    HOME_CARD_DEFAULT_ORDER.includes(value as HomeCardId);

  const normalizeCardOrder = (rawOrder?: readonly string[]): HomeCardId[] => {
    const normalized: HomeCardId[] = [HOME_CARD_FIXED_ID];
    if (rawOrder) {
      for (const item of rawOrder) {
        if (item === HOME_CARD_FIXED_ID) {
          continue;
        }
        if (!isHomeCardId(item) || normalized.includes(item)) {
          continue;
        }
        normalized.push(item);
      }
    }
    for (const cardId of HOME_CARD_CONFIGURABLE_ORDER) {
      if (!normalized.includes(cardId)) {
        normalized.push(cardId);
      }
    }
    // Keep favorites section below Favorite SQL for consistent home layout.
    const favoriteObjectIndex = normalized.indexOf('favoriteObjects');
    if (favoriteObjectIndex >= 0) {
      normalized.splice(favoriteObjectIndex, 1);
      const favoriteSqlIndex = normalized.indexOf('favoriteQueries');
      if (favoriteSqlIndex >= 0) {
        normalized.splice(favoriteSqlIndex + 1, 0, 'favoriteObjects');
      } else {
        normalized.push('favoriteObjects');
      }
    }
    return normalized;
  };

  const normalizeHiddenCards = (rawHidden?: readonly string[]): HomeCardId[] => {
    if (!rawHidden) {
      return [];
    }

    const normalized: HomeCardId[] = [];
    for (const item of rawHidden) {
      if (item === HOME_CARD_FIXED_ID) {
        continue;
      }
      if (!isHomeCardId(item) || normalized.includes(item)) {
        continue;
      }
      normalized.push(item);
    }
    return normalized;
  };

  const getHomeCardLayout = (): HomeCardLayout => {
    const storedOrder = context.workspaceState.get<string[]>(HOME_CARD_ORDER_KEY);
    const storedHidden = context.workspaceState.get<string[]>(HOME_CARD_HIDDEN_KEY);
    return {
      cardOrder: normalizeCardOrder(storedOrder),
      hiddenCards: normalizeHiddenCards(storedHidden)
    };
  };

  const saveHomeCardLayout = async (layout: HomeCardLayout): Promise<void> => {
    const normalizedOrder = normalizeCardOrder(layout.cardOrder);
    const normalizedHidden = normalizeHiddenCards(layout.hiddenCards);
    await context.workspaceState.update(HOME_CARD_ORDER_KEY, normalizedOrder);
    await context.workspaceState.update(HOME_CARD_HIDDEN_KEY, normalizedHidden);
  };

  const getCardTitle = (cardId: HomeCardId): string => {
    switch (cardId) {
      case 'connections':
        return isChinese ? '连接概览' : 'Connections';
      case 'quickActions':
        return isChinese ? '快速开始' : 'Quick Actions';
      case 'favoriteObjects':
        return isChinese ? '对象收藏' : 'Object Favorites';
      case 'metadata':
        return isChinese ? '元数据状态' : 'Metadata Status';
      case 'recentQueries':
        return isChinese ? '最近 SQL' : 'Recent SQL';
      case 'favoriteQueries':
      default:
        return isChinese ? '收藏 SQL' : 'Favorite SQL';
    }
  };

  const extractFirstScalar = (rows: Record<string, unknown>[]): string | undefined => {
    if (!rows.length) {
      return undefined;
    }
    const firstRow = rows[0];
    const firstColumn = Object.keys(firstRow)[0];
    if (!firstColumn) {
      return undefined;
    }
    const value = firstRow[firstColumn];
    if (value === null || value === undefined) {
      return undefined;
    }
    return String(value);
  };

  const trimVersion = (value: string | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }
    const firstLine = value.split(/\r?\n/)[0].trim();
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  };

  const getPingSql = (dbType: DatabaseType): string =>
    dbType === 'oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1';

  const getVersionSql = (dbType: DatabaseType): string => {
    switch (dbType) {
      case 'mysql':
        return 'SELECT VERSION() AS version';
      case 'postgresql':
        return 'SELECT version() AS version';
      case 'sqlite':
        return 'SELECT sqlite_version() AS version';
      case 'sqlserver':
        return 'SELECT @@VERSION AS version';
      case 'oracle':
        return 'SELECT version AS version FROM product_component_version WHERE ROWNUM = 1';
      default:
        return 'SELECT 1 AS version';
    }
  };

  const measureConnectionHealth = async (connection: ConnectionConfig): Promise<ConnectionHealthState> => {
    const provider = connectionManager.getProvider(connection.id);
    if (!provider || !provider.isConnected()) {
      return {
        checkedAt: Date.now(),
        error: 'notConnected'
      };
    }

    const pingStartedAt = Date.now();
    await executeProviderQuery(provider, connection.id, getPingSql(connection.type), connection.database);
    const latencyMs = Date.now() - pingStartedAt;

    let serverVersion: string | undefined;
    try {
      const versionResult = await executeProviderQuery(
        provider,
        connection.id,
        getVersionSql(connection.type),
        connection.database
      );
      serverVersion = trimVersion(extractFirstScalar(versionResult.rows));
    } catch {
      serverVersion = undefined;
    }

    return {
      latencyMs,
      serverVersion,
      checkedAt: Date.now()
    };
  };

  const scheduleConnectionHealthRefresh = (connection: ConnectionConfig): void => {
    if (!connectionManager.isConnected(connection.id)) {
      homeHealthCache.delete(connection.id);
      homeHealthInFlight.delete(connection.id);
      return;
    }

    const cached = homeHealthCache.get(connection.id);
    const isStale = !cached || Date.now() - cached.checkedAt > HOME_HEALTH_CACHE_TTL_MS;
    if (!isStale || homeHealthInFlight.has(connection.id)) {
      return;
    }

    const task = measureConnectionHealth(connection)
      .then(health => {
        homeHealthCache.set(connection.id, health);
      })
      .catch(error => {
        homeHealthCache.set(connection.id, {
          checkedAt: Date.now(),
          error: formatError(error)
        });
      })
      .finally(() => {
        homeHealthInFlight.delete(connection.id);
        void refreshHomePanel();
      });

    homeHealthInFlight.set(connection.id, task);
  };

  const configureHomeCards = async (): Promise<void> => {
    const operation = await vscode.window.showQuickPick(
      [
        {
          label: isChinese ? '调整卡片排序' : 'Reorder Cards',
          description: isChinese ? '按展示顺序重新排列主页卡片' : 'Choose a new display order for cards',
          id: 'order'
        },
        {
          label: isChinese ? '显示/隐藏卡片' : 'Show/Hide Cards',
          description: isChinese ? '按需显示或隐藏卡片' : 'Toggle card visibility',
          id: 'visibility'
        },
        {
          label: isChinese ? '恢复默认布局' : 'Reset Layout',
          description: isChinese ? '恢复默认排序并显示全部卡片' : 'Restore default order and visibility',
          id: 'reset'
        }
      ] as NamedQuickPick[],
      {
        placeHolder: isChinese ? '选择卡片布局操作' : 'Select a card layout action'
      }
    );

    if (!operation) {
      return;
    }

    const currentLayout = getHomeCardLayout();

    if (operation.id === 'reset') {
      await saveHomeCardLayout({
        cardOrder: [...HOME_CARD_DEFAULT_ORDER],
        hiddenCards: []
      });
      vscode.window.showInformationMessage(isChinese ? '主页卡片布局已恢复默认。' : 'Home card layout reset.');
      await refreshHomePanel();
      return;
    }

    if (operation.id === 'visibility') {
      const visibilityPicks = HOME_CARD_CONFIGURABLE_ORDER.map(cardId => ({
        label: getCardTitle(cardId),
        picked: !currentLayout.hiddenCards.includes(cardId),
        id: cardId
      }));
      const selected = await vscode.window.showQuickPick(visibilityPicks, {
        canPickMany: true,
        placeHolder: isChinese ? '选择要显示的卡片' : 'Select cards to show'
      });
      if (!selected) {
        return;
      }
      const visibleCards = new Set(selected.map(item => item.id));
      await saveHomeCardLayout({
        cardOrder: currentLayout.cardOrder,
        hiddenCards: HOME_CARD_CONFIGURABLE_ORDER.filter(cardId => !visibleCards.has(cardId))
      });
      vscode.window.showInformationMessage(isChinese ? '卡片显示设置已更新。' : 'Card visibility updated.');
      await refreshHomePanel();
      return;
    }

    if (operation.id === 'order') {
      const remaining = currentLayout.cardOrder.filter(cardId => cardId !== HOME_CARD_FIXED_ID);
      const nextOrder: HomeCardId[] = [];
      for (let index = 0; index < HOME_CARD_CONFIGURABLE_ORDER.length; index++) {
        const selected = await vscode.window.showQuickPick(
          remaining.map(cardId => ({
            label: getCardTitle(cardId),
            id: cardId
          })),
          {
            placeHolder: isChinese
              ? `选择第 ${index + 1}/${HOME_CARD_CONFIGURABLE_ORDER.length} 个卡片`
              : `Select card ${index + 1}/${HOME_CARD_CONFIGURABLE_ORDER.length}`
          }
        );

        if (!selected) {
          return;
        }

        nextOrder.push(selected.id);
        const removeIndex = remaining.indexOf(selected.id);
        if (removeIndex >= 0) {
          remaining.splice(removeIndex, 1);
        }
      }

      await saveHomeCardLayout({
        cardOrder: [HOME_CARD_FIXED_ID, ...nextOrder],
        hiddenCards: currentLayout.hiddenCards
      });
      vscode.window.showInformationMessage(isChinese ? '卡片排序已更新。' : 'Card order updated.');
      await refreshHomePanel();
    }
  };

  const ensureConnectedProvider = async (connectionId: string) => {
    let provider = connectionManager.getProvider(connectionId);
    if (provider && provider.isConnected()) {
      return provider;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: s.messages.connectingDb || s.messages.connecting,
        cancellable: false
      },
      async () => {
        await connectionManager.connect(connectionId);
      }
    );

    provider = connectionManager.getProvider(connectionId);
    if (!provider || !provider.isConnected()) {
      throw new Error(s.messages.notConnected);
    }

    return provider;
  };

  const clearHomeContextDatabases = (connectionId?: string): void => {
    if (connectionId) {
      homeContextDatabasesCache.delete(connectionId);
      homeContextDatabasesError.delete(connectionId);
      homeContextDatabasesLoading.delete(connectionId);
      return;
    }
    homeContextDatabasesCache.clear();
    homeContextDatabasesError.clear();
    homeContextDatabasesLoading.clear();
  };

  const loadHomeContextDatabases = async (
    connectionId: string,
    options?: {
      force?: boolean;
      connectIfNeeded?: boolean;
      showErrorMessage?: boolean;
      refreshPanel?: boolean;
    }
  ): Promise<HomeContextDatabaseState[]> => {
    const force = Boolean(options?.force);
    if (!force && homeContextDatabasesCache.has(connectionId)) {
      return homeContextDatabasesCache.get(connectionId) || [];
    }

    if (homeContextDatabasesLoading.has(connectionId)) {
      return homeContextDatabasesCache.get(connectionId) || [];
    }

    homeContextDatabasesLoading.add(connectionId);
    homeContextDatabasesError.delete(connectionId);
    if (options?.refreshPanel) {
      await refreshHomePanel();
    }

    try {
      let provider = connectionManager.getProvider(connectionId);
      if (!provider || !provider.isConnected()) {
        if (!options?.connectIfNeeded) {
          throw new Error(s.messages.notConnected);
        }
        provider = await ensureConnectedProvider(connectionId);
        treeProvider.refresh();
      }

      const databases = (await provider.getDatabases())
        .map(database => database.name)
        .filter((name): name is string => Boolean(name))
        .sort((left, right) => left.localeCompare(right));

      const states = databases.map(databaseName => ({
        name: databaseName
      }));
      homeContextDatabasesCache.set(connectionId, states);
      const names = states.map(item => item.name);

      if (
        homeContextSelectionConnectionId === connectionId &&
        homeContextSelectionDatabase &&
        !names.includes(homeContextSelectionDatabase)
      ) {
        homeContextSelectionDatabase = undefined;
      }

      return states;
    } catch (error) {
      const message = formatError(error);
      homeContextDatabasesError.set(connectionId, message);
      if (options?.showErrorMessage) {
        vscode.window.showErrorMessage(message);
      }
      return homeContextDatabasesCache.get(connectionId) || [];
    } finally {
      homeContextDatabasesLoading.delete(connectionId);
      if (options?.refreshPanel) {
        await refreshHomePanel();
      }
    }
  };

  const normalizeSqlForRiskCheck = (sql: string): string => {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^--.*$/gm, ' ')
      .trim();
  };

  const getRiskySqlOperation = (sql: string): string | undefined => {
    const normalized = normalizeSqlForRiskCheck(sql).toUpperCase();
    const match = normalized.match(/^(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/);
    return match?.[1];
  };

  const getConnectionEnvironment = async (connectionId?: string): Promise<string | undefined> => {
    if (!connectionId) {
      return undefined;
    }
    const connections = await connectionManager.getConnections();
    return connections.find(connection => connection.id === connectionId)?.environment;
  };

  const confirmRiskySqlIfNeeded = async (
    sql: string,
    connectionId?: string,
    database?: string
  ): Promise<boolean> => {
    const config = vscode.workspace.getConfiguration('minidb');
    const shouldConfirm = config.get<boolean>('confirmRiskySql', true);
    if (!shouldConfirm) {
      return true;
    }

    const operation = getRiskySqlOperation(sql);
    if (!operation) {
      return true;
    }

    const environment = await getConnectionEnvironment(connectionId);
    const isProd = environment === 'prod';
    const warningTitle = isChinese
      ? `即将执行高风险 SQL（${operation}）`
      : `You are about to run a high-risk SQL (${operation})`;
    const contextMessage = [
      connectionId ? `${isChinese ? '连接' : 'Connection'}: ${connectionId}` : undefined,
      database ? `${isChinese ? '数据库' : 'Database'}: ${database}` : undefined,
      environment ? `${isChinese ? '环境' : 'Environment'}: ${environment.toUpperCase()}` : undefined
    ]
      .filter(Boolean)
      .join(' | ');

    const detail = isProd
      ? (isChinese
        ? '当前连接标记为 PROD，执行 UPDATE/DELETE 可能造成不可逆影响。是否继续？'
        : 'This connection is tagged as PROD. UPDATE/DELETE style queries may cause irreversible changes. Continue?')
      : (isChinese
        ? '该 SQL 可能修改或删除数据。是否继续执行？'
        : 'This SQL may modify or delete data. Continue?');

    const confirmed = await vscode.window.showWarningMessage(
      `${warningTitle}${contextMessage ? `\n${contextMessage}` : ''}\n${detail}`,
      { modal: true },
      isChinese ? '继续执行' : 'Execute Anyway'
    );

    return Boolean(confirmed);
  };

  const maskString = (value: string | undefined): string | undefined =>
    value ? '******' : undefined;

  const sanitizeConnectionConfig = (connection: ConnectionConfig): Record<string, unknown> => ({
    id: connection.id,
    name: connection.name,
    type: connection.type,
    environment: connection.environment,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: maskString(connection.password),
    database: connection.database,
    ssl: connection.ssl,
    connectTimeout: connection.connectTimeout,
    filePath: connection.filePath,
    instanceName: connection.instanceName,
    serviceName: connection.serviceName,
    retry: connection.retry,
    pool: connection.pool,
    ssh: connection.ssh
      ? {
        host: connection.ssh.host,
        port: connection.ssh.port,
        username: connection.ssh.username,
        password: maskString(connection.ssh.password),
        privateKey: maskString(connection.ssh.privateKey),
        passphrase: maskString(connection.ssh.passphrase)
      }
      : undefined
  });

  const buildConnectionDetailsPayload = async (
    connection: ConnectionConfig,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<ConnectionDetailsPayload> => {
    const details: ConnectionDetailsPayload = {
      connectionName: connection.name,
      connection: sanitizeConnectionConfig(connection),
      runtime: {
        isConnected: false,
        checkedAt: Date.now()
      },
      databases: [],
      generatedAt: Date.now()
    };

    let provider = connectionManager.getProvider(connection.id);
    if (!provider || !provider.isConnected()) {
      details.runtime.connectError = isChinese ? '连接未建立' : 'Connection is not established';
      details.runtime.checkedAt = Date.now();
      details.generatedAt = Date.now();
      return details;
    }

    details.runtime.isConnected = true;

    const pingStartedAt = Date.now();
    try {
      progress.report({
        message: isChinese ? '正在检测连接健康度...' : 'Checking connection health...'
      });
      await executeProviderQuery(provider, connection.id, getPingSql(connection.type), connection.database);
      details.runtime.latencyMs = Date.now() - pingStartedAt;
    } catch (error) {
      details.runtime.healthError = formatError(error);
    }

    try {
      const version = await provider.getServerVersion();
      details.runtime.serverVersion = trimVersion(version);
    } catch (error) {
      if (!details.runtime.healthError) {
        details.runtime.healthError = formatError(error);
      }
    }
    details.runtime.checkedAt = Date.now();

    homeHealthCache.set(connection.id, {
      latencyMs: details.runtime.latencyMs,
      serverVersion: details.runtime.serverVersion,
      error: details.runtime.healthError,
      checkedAt: details.runtime.checkedAt
    });

    let databases: Array<{ name: string }> = [];
    try {
      progress.report({
        message: isChinese ? '正在读取数据库列表...' : 'Loading database list...'
      });
      databases = await provider.getDatabases();
    } catch (error) {
      details.runtime.healthError = details.runtime.healthError || formatError(error);
      details.generatedAt = Date.now();
      return details;
    }

    for (let index = 0; index < databases.length; index++) {
      const database = databases[index];
      const progressIncrement = databases.length > 0 ? 100 / databases.length : 100;
      progress.report({
        message: isChinese
          ? `正在读取数据库 ${database.name} (${index + 1}/${databases.length})`
          : `Loading ${database.name} (${index + 1}/${databases.length})`,
        increment: progressIncrement
      });

      const dbDetails: ConnectionDetailsDatabase = {
        name: database.name,
        tableCount: 0,
        viewCount: 0,
        tables: []
      };

      try {
        const tables = await provider.getTables(database.name);
        dbDetails.tableCount = tables.filter(table => table.type === 'TABLE').length;
        dbDetails.viewCount = tables.filter(table => table.type === 'VIEW').length;

        for (const table of tables.sort((a, b) => a.name.localeCompare(b.name))) {
          let columns: Array<{
            name: string;
            type: string;
            nullable: boolean;
            defaultValue: string | null;
            isPrimaryKey: boolean;
          }> = [];

          try {
            const tableColumns = await provider.getTableColumns(database.name, table.name);
            columns = tableColumns.map(column => ({
              name: column.name,
              type: column.type,
              nullable: column.nullable,
              defaultValue: column.defaultValue,
              isPrimaryKey: column.isPrimaryKey
            }));
          } catch {
            columns = [];
          }

          dbDetails.tables.push({
            name: table.name,
            schema: table.schema,
            type: table.type,
            rowCount: table.rowCount,
            columns
          });
        }

        try {
          const foreignKeys = await provider.getForeignKeys(database.name);
          dbDetails.foreignKeyCount = foreignKeys.length;
        } catch (error) {
          dbDetails.foreignKeyError = formatError(error);
        }
      } catch (error) {
        dbDetails.error = formatError(error);
      }

      details.databases.push(dbDetails);
    }

    details.generatedAt = Date.now();
    return details;
  };

  const connectHomeConnection = async (connectionId: string): Promise<void> => {
    const connections = await connectionManager.getConnections();
    const connection = connections.find(item => item.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage(s.messages.noConnection);
      return;
    }

    if (connectionManager.isConnected(connectionId)) {
      return;
    }

    try {
      await ensureConnectedProvider(connectionId);
      treeProvider.refresh();
      void refreshHomePanel();
      vscode.window.showInformationMessage(s.messages.connected);
    } catch (error) {
      vscode.window.showErrorMessage(failedToConnectMessage(error));
    }
  };

  const disconnectHomeConnection = async (connectionId: string): Promise<void> => {
    const connections = await connectionManager.getConnections();
    const connection = connections.find(item => item.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage(s.messages.noConnection);
      return;
    }

    if (!connectionManager.isConnected(connectionId)) {
      return;
    }

    try {
      await connectionManager.disconnect(connectionId);
      homeHealthCache.delete(connectionId);
      homeHealthInFlight.delete(connectionId);
      clearHomeContextDatabases(connectionId);
      if (homeContextSelectionConnectionId === connectionId) {
        homeContextSelectionConnectionId = undefined;
        homeContextSelectionDatabase = undefined;
      }
      if (activeQueryConnection === connectionId) {
        setActiveQueryContext(undefined, undefined);
      }
      treeProvider.refresh();
      void refreshHomePanel();
      vscode.window.showInformationMessage(s.messages.disconnected);
    } catch (error) {
      vscode.window.showErrorMessage(
        isChinese
          ? `断开连接失败: ${formatError(error)}`
          : `Failed to disconnect: ${formatError(error)}`
      );
    }
  };

  const openHomeConnectionDetails = async (connectionId: string): Promise<void> => {
    const connections = await connectionManager.getConnections();
    const connection = connections.find(item => item.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage(s.messages.noConnection);
      return;
    }

    if (!connectionManager.isConnected(connectionId)) {
      vscode.window.showWarningMessage(
        isChinese ? '请先连接该数据库后再查看详细信息。' : 'Please connect this database before viewing details.'
      );
      return;
    }

    const details = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isChinese ? `正在加载连接详情: ${connection.name}` : `Loading connection details: ${connection.name}`,
        cancellable: false
      },
      async progress => await buildConnectionDetailsPayload(connection, progress)
    );

    const panel = ConnectionDetailsPanel.createOrShow(context.extensionUri);
    panel.update(details);
    void refreshHomePanel();
  };

  const getQueryTimeoutMs = (): number => {
    const timeout = vscode.workspace.getConfiguration('minidb').get<number>('queryTimeout', 30000);
    if (!Number.isFinite(timeout)) {
      return 30000;
    }
    return Math.max(0, Math.floor(timeout));
  };

  const cancelQueryForConnection = async (
    connectionId: string,
    disconnectFallback: boolean
  ): Promise<'provider' | 'disconnect' | 'none'> => {
    const provider = connectionManager.getProvider(connectionId);
    if (provider?.cancelCurrentQuery) {
      try {
        await provider.cancelCurrentQuery();
        return 'provider';
      } catch {
        if (!disconnectFallback) {
          throw new Error(isChinese ? '无法取消当前查询。' : 'Unable to cancel current query.');
        }
      }
    }

    if (disconnectFallback) {
      await connectionManager.disconnect(connectionId).catch(() => undefined);
      treeProvider.refresh();
      return 'disconnect';
    }

    return 'none';
  };

  const withQueryTimeout = async <T>(
    connectionId: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const timeoutMs = getQueryTimeoutMs();
    if (timeoutMs <= 0) {
      return await operation();
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        void cancelQueryForConnection(connectionId, true).catch(() => undefined);
        reject(
          new Error(
            isChinese ? `查询超时（${timeoutMs}ms）` : `Query timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  const executeProviderQuery = async (
    provider: IDatabaseProvider,
    connectionId: string,
    sql: string,
    database?: string
  ): Promise<QueryResult> => {
    return await withQueryTimeout(connectionId, async () => await provider.executeQuery(sql, database));
  };

  const runCancelableQuery = async <T>(
    connectionId: string,
    title: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true
      },
      async (_progress, token) => {
        runningQueryConnectionId = connectionId;

        let cancelDisposable: vscode.Disposable | undefined;
        const cancelPromise = new Promise<never>((_, reject) => {
          cancelDisposable = token.onCancellationRequested(async () => {
            await cancelQueryForConnection(connectionId, true).catch(() => undefined);
            reject(new Error(queryCancelledByUserMessage));
          });
        });

        try {
          return await Promise.race([operation(), cancelPromise]);
        } finally {
          cancelDisposable?.dispose();
          if (runningQueryConnectionId === connectionId) {
            runningQueryConnectionId = undefined;
          }
        }
      }
    );
  };

  const formatImportValue = (rawValue: string, dbType: DatabaseType, columnType?: string): string => {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      return 'NULL';
    }

    const type = (columnType || '').toLowerCase();
    const isNumericType = /(int|decimal|numeric|float|double|real|number)/.test(type);
    if (isNumericType) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        return String(parsed);
      }
    }

    const isBoolType = /(bool|boolean|bit)/.test(type);
    if (isBoolType) {
      const lowered = trimmed.toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(lowered)) {
        return dbType === 'postgresql' ? 'TRUE' : '1';
      }
      if (['0', 'false', 'no', 'n'].includes(lowered)) {
        return dbType === 'postgresql' ? 'FALSE' : '0';
      }
    }

    return SqlEscape.safeStringLiteral(trimmed, dbType);
  };

  const createUntitledSqlEditor = async (): Promise<vscode.TextEditor> => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const uri = vscode.Uri.parse(`untitled:query-${timestamp}.sql`);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    if (editor.document.languageId !== 'sql') {
      await vscode.languages.setTextDocumentLanguage(editor.document, 'sql');
    }

    return editor;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.addConnection', () => {
      const panel = ConnectionFormPanel.createOrShow(
        context.extensionUri,
        connectionManager
      );
      panel.onSave(() => {
        treeProvider.refresh();
        void refreshHomePanel();
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.refreshConnections', () => {
      treeProvider.refresh();
      void refreshHomePanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.deleteConnection', async (item: DatabaseTreeItem) => {
      if (!item.connectionId) {
        return;
      }

      const config = await connectionManager.getConnections();
      const connection = config.find(c => c.id === item.connectionId);
      
      const confirm = await vscode.window.showWarningMessage(
        `${s.messages.confirmDelete} "${connection?.name}"?`,
        s.messages.delete,
        s.messages.cancel
      );

      if (confirm === s.messages.delete) {
        await connectionManager.deleteConnection(item.connectionId);
        await objectFavoritesManager.clear(item.connectionId);
        homeHealthCache.delete(item.connectionId);
        homeHealthInFlight.delete(item.connectionId);
        clearHomeContextDatabases(item.connectionId);
        if (homeContextSelectionConnectionId === item.connectionId) {
          homeContextSelectionConnectionId = undefined;
          homeContextSelectionDatabase = undefined;
        }
        if (activeQueryConnection === item.connectionId) {
          setActiveQueryContext(undefined, undefined);
        }
        treeProvider.refresh();
        void refreshHomePanel();
        vscode.window.showInformationMessage(`Connection "${connection?.name}" ${s.messages.deleted}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.connect', async (item: DatabaseTreeItem) => {
      if (!item.connectionId) {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: s.messages.connecting,
            cancellable: false
          },
          async () => {
            await connectionManager.connect(item.connectionId!);
          }
        );
        const connections = await connectionManager.getConnections();
        const connectedConfig = connections.find(connection => connection.id === item.connectionId);
        const nextDatabase = activeQueryConnection === item.connectionId
          ? (activeQueryDatabase ?? connectedConfig?.database)
          : connectedConfig?.database;
        setActiveQueryContext(item.connectionId, nextDatabase);
        if (sqlCompletionProvider && nextDatabase) {
          void sqlCompletionProvider.preloadMetadata(item.connectionId, nextDatabase);
        }
        treeProvider.refresh();
        void refreshHomePanel();
        vscode.window.showInformationMessage(s.messages.connected);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.disconnect', async (item: DatabaseTreeItem) => {
      if (!item.connectionId) {
        return;
      }

      await connectionManager.disconnect(item.connectionId);
      homeHealthCache.delete(item.connectionId);
      homeHealthInFlight.delete(item.connectionId);
      clearHomeContextDatabases(item.connectionId);
      if (homeContextSelectionConnectionId === item.connectionId) {
        homeContextSelectionConnectionId = undefined;
        homeContextSelectionDatabase = undefined;
      }
      if (activeQueryConnection === item.connectionId) {
        setActiveQueryContext(undefined, undefined);
      }
      treeProvider.refresh();
      void refreshHomePanel();
      vscode.window.showInformationMessage(s.messages.disconnected);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.editConnection', async (item: DatabaseTreeItem) => {
      if (!item.connectionId) {
        return;
      }

      const connections = await connectionManager.getConnections();
      const connection = connections.find(c => c.id === item.connectionId);
      
      if (connection) {
        const panel = ConnectionFormPanel.createOrShow(
          context.extensionUri,
          connectionManager,
          connection
        );
        panel.onSave(() => {
          treeProvider.refresh();
          void refreshHomePanel();
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.newQuery', async (item: DatabaseTreeItem) => {
      if (!item.connectionId) {
        return;
      }

      setActiveQueryContext(item.connectionId, item.databaseName);
      
      if (sqlCompletionProvider && item.databaseName) {
        sqlCompletionProvider.preloadMetadata(item.connectionId, item.databaseName);
      }

      const connections = await connectionManager.getConnections();
      const conn = connections.find(c => c.id === item.connectionId);
      const connName = conn?.name || 'Unknown';
      const dbInfo = item.databaseName ? ` (${s.queryEditor.databaseLabel}: ${item.databaseName})` : '';

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `query-${timestamp}.sql`;
      const uri = vscode.Uri.parse(`untitled:${fileName}`);
      
      const doc = await vscode.workspace.openTextDocument(uri);
      
      const isChinese = i18n.language === 'zh';
      const queryHeaderLines = [
        `-- ${s.queryEditor.connectionLabel}: ${connName}${dbInfo}`,
        isChinese
          ? '-- \u6267\u884c\u67e5\u8be2: Ctrl+Alt+E / F9 (macOS: Cmd+Alt+E)'
          : '-- Execute Query: Ctrl+Alt+E / F9 (macOS: Cmd+Alt+E)',
        isChinese
          ? '-- \u6267\u884c\u8ba1\u5212: Ctrl+Alt+P (macOS: Cmd+Alt+P)'
          : '-- Explain Query: Ctrl+Alt+P (macOS: Cmd+Alt+P)',
        isChinese
          ? '-- \u53d6\u6d88\u67e5\u8be2: Ctrl+Alt+X (macOS: Cmd+Alt+X)'
          : '-- Cancel Running Query: Ctrl+Alt+X (macOS: Cmd+Alt+X)',
        isChinese
          ? '-- \u67e5\u8be2\u5386\u53f2: Ctrl+Alt+H (macOS: Cmd+Alt+H)'
          : '-- Query History: Ctrl+Alt+H (macOS: Cmd+Alt+H)',
        isChinese
          ? '-- \u6536\u85cf\u5217\u8868: Ctrl+Alt+J (macOS: Cmd+Alt+J)'
          : '-- Favorite Queries: Ctrl+Alt+J (macOS: Cmd+Alt+J)',
        isChinese
          ? '-- \u6536\u85cf/\u53d6\u6d88\u6536\u85cf: Ctrl+Alt+S (macOS: Cmd+Alt+S)'
          : '-- Toggle Favorite Query: Ctrl+Alt+S (macOS: Cmd+Alt+S)',
        isChinese
          ? '-- \u5bf9\u8c61\u641c\u7d22: Ctrl+Alt+O (macOS: Cmd+Alt+O)'
          : '-- Search Objects: Ctrl+Alt+O (macOS: Cmd+Alt+O)'
      ];

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), `${queryHeaderLines.join('\n')}\n\n`);
      await vscode.workspace.applyEdit(edit);
      
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      const position = new vscode.Position(9, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position));
      
      statusBarItem.show();
      void refreshHomePanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.executeQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(s.messages.noActiveEditor);
        return;
      }

      if (!activeQueryConnection) {
        const connections = await connectionManager.getConnections();
        if (connections.length === 0) {
          vscode.window.showErrorMessage(s.messages.noConnections);
          return;
        }

        const picks = connections.map(c => ({
          label: c.name,
          description: `${c.type} - ${c.host}:${c.port}`,
          id: c.id
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: s.messages.selectConnection
        });

        if (!selected) {
          return;
        }

        const nextDatabase = activeQueryConnection === selected.id ? activeQueryDatabase : undefined;
        setActiveQueryContext(selected.id, nextDatabase);
        void refreshHomePanel();
      }

      try {
        await ensureConnectedProvider(activeQueryConnection!);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      let sql = editor.document.getText();
      const selection = editor.selection;
      if (!selection.isEmpty) {
        sql = editor.document.getText(selection);
      }

      sql = sql.replace(/^--.*$/gm, '').trim();
      
      if (!sql) {
        vscode.window.showErrorMessage(s.messages.noQuery);
        return;
      }

      const allowExecution = await confirmRiskySqlIfNeeded(sql, activeQueryConnection, activeQueryDatabase);
      if (!allowExecution) {
        return;
      }

      await queryHistoryManager.addQuery(activeQueryConnection, activeQueryDatabase, sql);

      const activeConnections = await connectionManager.getConnections();
      const activeConnConfig = activeConnections.find(c => c.id === activeQueryConnection);
      const activeDbType = activeConnConfig?.type ?? 'mysql';
      const config = vscode.workspace.getConfiguration('minidb');
      const maxResults = Math.max(1, config.get<number>('maxResults', 1000));
      const hasExplicitPagination = /\bLIMIT\b|\bOFFSET\b|\bFETCH\s+NEXT\b|\bTOP\s+\d+/i.test(sql);
      const isSelectLikeQuery = /^\s*(SELECT|WITH)\b/i.test(sql);

      const executeQueryCallback = async (querySql: string) => {
        const p = connectionManager.getProvider(activeQueryConnection!);
        if (!p) {
          throw new Error(s.messages.notConnected);
        }
        return await executeProviderQuery(p, activeQueryConnection!, querySql, activeQueryDatabase);
      };

      try {
        const panel = QueryResultPanel.createOrShow(context.extensionUri, executeQueryCallback, activeDbType);

        if (isSelectLikeQuery && !hasExplicitPagination) {
          const { firstPageResult, totalRows } = await runCancelableQuery(
            activeQueryConnection!,
            s.messages.executing,
            async () => {
              const p = connectionManager.getProvider(activeQueryConnection!);
              const firstPageSize = Math.min(DEFAULT_QUERY_PAGE_SIZE, maxResults);

              let totalRows = 0;
              try {
                const countSql = SqlEscape.buildCountQuery(sql, activeDbType);
                if (!p) {
                  throw new Error(s.messages.notConnected);
                }
                const countResult = await executeProviderQuery(
                  p,
                  activeQueryConnection!,
                  countSql,
                  activeQueryDatabase
                );
                totalRows = extractTotalRows(countResult) ?? 0;
              } catch {
                totalRows = 0;
              }

              const paginatedSql = SqlEscape.buildPaginatedQuery(sql, activeDbType, firstPageSize, 0);
              if (!p) {
                throw new Error(s.messages.notConnected);
              }
              const firstPageResult = await executeProviderQuery(
                p,
                activeQueryConnection!,
                paginatedSql,
                activeQueryDatabase
              );
              if (totalRows === 0 && firstPageResult.rows.length > 0) {
                totalRows = firstPageResult.rows.length;
              }

              return { firstPageResult, totalRows };
            }
          );

          panel.updateResult(firstPageResult, sql);
        } else {
          const result = await runCancelableQuery(
            activeQueryConnection!,
            s.messages.executing,
            async () => {
              const p = connectionManager.getProvider(activeQueryConnection!);
              if (!p) {
                throw new Error(s.messages.notConnected);
              }
              return await executeProviderQuery(p, activeQueryConnection!, sql, activeQueryDatabase);
            }
          );

          panel.updateResult(result, sql);
        }
      } catch (error) {
        const panel = QueryResultPanel.createOrShow(context.extensionUri, undefined, activeDbType);
        panel.showError(error instanceof Error ? error.message : String(error), sql);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.explainQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(s.messages.noActiveEditor);
        return;
      }

      if (!activeQueryConnection) {
        const connections = await connectionManager.getConnections();
        if (connections.length === 0) {
          vscode.window.showErrorMessage(s.messages.noConnections);
          return;
        }

        const picks = connections.map(c => ({
          label: c.name,
          description: `${c.type} - ${c.host}:${c.port}`,
          id: c.id
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: s.messages.selectConnection
        });

        if (!selected) {
          return;
        }

        const nextDatabase = activeQueryConnection === selected.id ? activeQueryDatabase : undefined;
        setActiveQueryContext(selected.id, nextDatabase);
        void refreshHomePanel();
      }

      if (!activeQueryConnection) {
        vscode.window.showErrorMessage(s.messages.noConnection);
        return;
      }

      try {
        await ensureConnectedProvider(activeQueryConnection!);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      let sql = editor.document.getText();
      const selection = editor.selection;
      if (!selection.isEmpty) {
        sql = editor.document.getText(selection);
      }

      sql = sql.replace(/^--.*$/gm, '').trim();
      if (!sql) {
        vscode.window.showErrorMessage(s.messages.noQuery);
        return;
      }

      const activeConnections = await connectionManager.getConnections();
      const activeConnConfig = activeConnections.find(c => c.id === activeQueryConnection);
      const activeDbType = activeConnConfig?.type ?? 'mysql';

      try {
        let explainSql = '';
        const result = await runCancelableQuery(
          activeQueryConnection!,
          isChinese ? '\u6b63\u5728\u751f\u6210\u6267\u884c\u8ba1\u5212...' : 'Explaining query...',
          async () => {
            const provider = connectionManager.getProvider(activeQueryConnection!);
            if (!provider) {
              throw new Error(s.messages.notConnected);
            }

            switch (activeDbType) {
              case 'oracle':
                explainSql = `EXPLAIN PLAN FOR ${sql}`;
                await executeProviderQuery(provider, activeQueryConnection!, explainSql, activeQueryDatabase);
                explainSql = 'SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())';
                return await executeProviderQuery(provider, activeQueryConnection!, explainSql, activeQueryDatabase);
              case 'sqlserver':
                explainSql = `SET SHOWPLAN_TEXT ON; ${sql}; SET SHOWPLAN_TEXT OFF;`;
                return await executeProviderQuery(provider, activeQueryConnection!, explainSql, activeQueryDatabase);
              default:
                explainSql = `EXPLAIN ${sql}`;
                return await executeProviderQuery(provider, activeQueryConnection!, explainSql, activeQueryDatabase);
            }
          }
        );

        const panel = ExplainPlanPanel.createOrShow(context.extensionUri);
        panel.updatePlan(sql, explainSql, activeDbType, result);
      } catch (error) {
        const panel = ExplainPlanPanel.createOrShow(context.extensionUri);
        panel.showError(sql, error instanceof Error ? error.message : String(error));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.cancelQuery', async () => {
      if (!runningQueryConnectionId) {
        vscode.window.showInformationMessage(
          isChinese ? '\u5f53\u524d\u6ca1\u6709\u6b63\u5728\u6267\u884c\u7684\u67e5\u8be2\u3002' : 'No running query to cancel.'
        );
        return;
      }

      const connectionId = runningQueryConnectionId;
      runningQueryConnectionId = undefined;
      await cancelQueryForConnection(connectionId, true).catch(() => undefined);
      updateStatusBar();
      void refreshHomePanel();
      vscode.window.showInformationMessage(isChinese ? '\u67e5\u8be2\u5df2\u53d6\u6d88\u3002' : 'Query cancelled.');
    })
  );

  const insertSqlIntoActiveEditor = async (sqlText: string): Promise<void> => {
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      editor = await createUntitledSqlEditor();
    }

    await editor.edit(editBuilder => {
      if (!editor.selection.isEmpty) {
        editBuilder.replace(editor.selection, sqlText);
      } else {
        editBuilder.insert(editor.selection.active, sqlText);
      }
    });
  };

  const applyHomeContext = (connectionId: string, databaseName: string): void => {
    setActiveQueryContext(connectionId, databaseName);
    metadataRefreshState.connectionId = connectionId;
    metadataRefreshState.database = databaseName;
    void refreshHomePanel();
  };

  const requireHomeContextSelection = async (): Promise<{ connectionId: string; databaseName: string } | undefined> => {
    if (!homeContextSelectionConnectionId || !homeContextSelectionDatabase) {
      vscode.window.showWarningMessage(
        isChinese
          ? '请先在首页选择连接和数据库。'
          : 'Please select connection and database in Home first.'
      );
      return undefined;
    }

    return await restoreHomeConnection(homeContextSelectionConnectionId, homeContextSelectionDatabase);
  };

  const restoreHomeConnection = async (
    connectionId: string,
    preferredDatabase?: string,
    forceDatabasePick: boolean = false
  ): Promise<{ connectionId: string; databaseName: string } | undefined> => {
    const connections = await connectionManager.getConnections();
    const connection = connections.find(c => c.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage(s.messages.noConnection);
      return undefined;
    }

    const databases = await loadHomeContextDatabases(connectionId, {
      force: true,
      connectIfNeeded: true,
      showErrorMessage: true
    });
    const databaseNames = databases.map(item => item.name);
    if (databaseNames.length === 0) {
      vscode.window.showErrorMessage(
        isChinese ? '该连接下未找到数据库。' : 'No databases found for this connection.'
      );
      return undefined;
    }

    let databaseName = preferredDatabase;
    if (!forceDatabasePick) {
      databaseName =
        preferredDatabase ||
        (homeContextSelectionConnectionId === connectionId ? homeContextSelectionDatabase : undefined) ||
        (activeQueryConnection === connectionId ? activeQueryDatabase : undefined) ||
        connection.database;
    }

    if (!databaseName || !databaseNames.includes(databaseName)) {
      if (databaseNames.length === 1) {
        databaseName = databaseNames[0];
      } else {
        const selectedDatabase = await vscode.window.showQuickPick(
          databaseNames.map(databaseNameItem => ({
            label: databaseNameItem
          })),
          {
            placeHolder: isChinese ? '选择数据库' : 'Select a database'
          }
        );

        if (!selectedDatabase) {
          return undefined;
        }
        databaseName = selectedDatabase.label;
      }
    }

    applyHomeContext(connectionId, databaseName);
    if (sqlCompletionProvider) {
      void sqlCompletionProvider.preloadMetadata(connectionId, databaseName);
    }

    return {
      connectionId,
      databaseName
    };
  };

  const selectHomeContextConnection = async (connectionId: string): Promise<void> => {
    const connections = await connectionManager.getConnections();
    if (!connections.some(connection => connection.id === connectionId)) {
      vscode.window.showErrorMessage(s.messages.noConnection);
      return;
    }

    const isSameConnection = homeContextSelectionConnectionId === connectionId;
    homeContextSelectionConnectionId = connectionId;
    if (!isSameConnection) {
      homeContextSelectionDatabase = undefined;
    }
    metadataRefreshState.connectionId = connectionId;
    metadataRefreshState.database = homeContextSelectionDatabase;

    await loadHomeContextDatabases(connectionId, {
      force: isSameConnection,
      connectIfNeeded: true,
      showErrorMessage: true,
      refreshPanel: true
    });
  };

  const selectHomeContextDatabase = async (connectionId: string, databaseName: string): Promise<void> => {
    homeContextSelectionConnectionId = connectionId;
    homeContextSelectionDatabase = databaseName;

    const contextInfo = await restoreHomeConnection(connectionId, databaseName);
    if (!contextInfo) {
      return;
    }

    await refreshHomePanel();
  };

  const executeSqlFromHome = async (sqlText: string, payload?: HomeActionPayload): Promise<void> => {
    const normalizedSql = sqlText.trim();
    if (!normalizedSql) {
      return;
    }

    const contextInfo = payload?.connectionId
      ? await restoreHomeConnection(payload.connectionId, payload.database)
      : await requireHomeContextSelection();
    if (!contextInfo) {
      return;
    }

    const provider = connectionManager.getProvider(contextInfo.connectionId);
    if (!provider || !provider.isConnected()) {
      vscode.window.showErrorMessage(s.messages.notConnected);
      return;
    }

    const allowExecution = await confirmRiskySqlIfNeeded(
      normalizedSql,
      contextInfo.connectionId,
      contextInfo.databaseName
    );
    if (!allowExecution) {
      return;
    }

    await queryHistoryManager.addQuery(
      contextInfo.connectionId,
      contextInfo.databaseName,
      normalizedSql
    );

    const activeConnections = await connectionManager.getConnections();
    const activeConnConfig = activeConnections.find(c => c.id === contextInfo.connectionId);
    const activeDbType = activeConnConfig?.type ?? 'mysql';
    const config = vscode.workspace.getConfiguration('minidb');
    const maxResults = Math.max(1, config.get<number>('maxResults', 1000));
    const hasExplicitPagination = /\bLIMIT\b|\bOFFSET\b|\bFETCH\s+NEXT\b|\bTOP\s+\d+/i.test(normalizedSql);
    const isSelectLikeQuery = /^\s*(SELECT|WITH)\b/i.test(normalizedSql);

    const executeQueryCallback = async (querySql: string) => {
      const p = connectionManager.getProvider(contextInfo.connectionId);
      if (!p) {
        throw new Error(s.messages.notConnected);
      }
      return await executeProviderQuery(p, contextInfo.connectionId, querySql, contextInfo.databaseName);
    };

    try {
      const panel = QueryResultPanel.createOrShow(context.extensionUri, executeQueryCallback, activeDbType);
      if (isSelectLikeQuery && !hasExplicitPagination) {
        const { firstPageResult } = await runCancelableQuery(
          contextInfo.connectionId,
          s.messages.executing,
          async () => {
            const p = connectionManager.getProvider(contextInfo.connectionId);
            const firstPageSize = Math.min(DEFAULT_QUERY_PAGE_SIZE, maxResults);
            const paginatedSql = SqlEscape.buildPaginatedQuery(normalizedSql, activeDbType, firstPageSize, 0);
            if (!p) {
              throw new Error(s.messages.notConnected);
            }
            const firstPageResult = await executeProviderQuery(
              p,
              contextInfo.connectionId,
              paginatedSql,
              contextInfo.databaseName
            );
            return { firstPageResult };
          }
        );
        panel.updateResult(firstPageResult, normalizedSql);
      } else {
        const result = await runCancelableQuery(
          contextInfo.connectionId,
          s.messages.executing,
          async () => {
            const p = connectionManager.getProvider(contextInfo.connectionId);
            if (!p) {
              throw new Error(s.messages.notConnected);
            }
            return await executeProviderQuery(p, contextInfo.connectionId, normalizedSql, contextInfo.databaseName);
          }
        );
        panel.updateResult(result, normalizedSql);
      }
    } catch (error) {
      const panel = QueryResultPanel.createOrShow(context.extensionUri, undefined, activeDbType);
      panel.showError(error instanceof Error ? error.message : String(error), normalizedSql);
    }
  };

  const explainSqlFromHome = async (sqlText: string, payload?: HomeActionPayload): Promise<void> => {
    const normalizedSql = sqlText.trim();
    if (!normalizedSql) {
      return;
    }

    const contextInfo = payload?.connectionId
      ? await restoreHomeConnection(payload.connectionId, payload.database)
      : await requireHomeContextSelection();
    if (!contextInfo) {
      return;
    }

    const provider = connectionManager.getProvider(contextInfo.connectionId);
    if (!provider || !provider.isConnected()) {
      vscode.window.showErrorMessage(s.messages.notConnected);
      return;
    }

    const activeConnections = await connectionManager.getConnections();
    const activeConnConfig = activeConnections.find(c => c.id === contextInfo.connectionId);
    const activeDbType = activeConnConfig?.type ?? 'mysql';

    try {
      let explainSql = '';
      const result = await runCancelableQuery(
        contextInfo.connectionId,
        isChinese ? '正在生成执行计划...' : 'Explaining query...',
        async () => {
          switch (activeDbType) {
            case 'oracle':
              explainSql = `EXPLAIN PLAN FOR ${normalizedSql}`;
              await executeProviderQuery(provider, contextInfo.connectionId, explainSql, contextInfo.databaseName);
              explainSql = 'SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())';
              return await executeProviderQuery(provider, contextInfo.connectionId, explainSql, contextInfo.databaseName);
            case 'sqlserver':
              explainSql = `SET SHOWPLAN_TEXT ON; ${normalizedSql}; SET SHOWPLAN_TEXT OFF;`;
              return await executeProviderQuery(provider, contextInfo.connectionId, explainSql, contextInfo.databaseName);
            default:
              explainSql = `EXPLAIN ${normalizedSql}`;
              return await executeProviderQuery(provider, contextInfo.connectionId, explainSql, contextInfo.databaseName);
          }
        }
      );

      const panel = ExplainPlanPanel.createOrShow(context.extensionUri);
      panel.updatePlan(normalizedSql, explainSql, activeDbType, result);
    } catch (error) {
      const panel = ExplainPlanPanel.createOrShow(context.extensionUri);
      panel.showError(normalizedSql, error instanceof Error ? error.message : String(error));
    }
  };

  const addFavoriteObjectFromHome = async (): Promise<void> => {
    const contextInfo = await requireHomeContextSelection();
    if (!contextInfo) {
      return;
    }

    const provider = connectionManager.getProvider(contextInfo.connectionId);
    if (!provider || !provider.isConnected()) {
      vscode.window.showErrorMessage(s.messages.notConnected);
      return;
    }

    const tables = await provider.getTables(contextInfo.databaseName);
    const picks: Array<vscode.QuickPickItem & { objectType: FavoriteObjectType; objectName: string }> = [
      {
        label: `$(database) ${contextInfo.databaseName}`,
        description: isChinese ? '数据库' : 'Database',
        objectType: 'database',
        objectName: contextInfo.databaseName
      }
    ];

    tables
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(table => {
        picks.push({
          label: `${table.type === 'VIEW' ? '$(eye)' : '$(table)'} ${table.name}`,
          description: table.type,
          objectType: table.type === 'VIEW' ? 'view' : 'table',
          objectName: table.name
        });
      });

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: isChinese ? '选择要收藏的对象' : 'Select object to favorite'
    });
    if (!selected) {
      return;
    }

    await objectFavoritesManager.addOrTouch({
      connectionId: contextInfo.connectionId,
      database: contextInfo.databaseName,
      objectType: selected.objectType,
      objectName: selected.objectName
    });

    vscode.window.showInformationMessage(
      isChinese ? '对象已加入收藏。' : 'Object added to favorites.'
    );
    await refreshHomePanel();
  };

  const buildFavoriteObjectItem = (
    payload: HomeActionPayload,
    requireTable: boolean
  ): DatabaseTreeItem | undefined => {
    if (!payload.connectionId || !payload.database || !payload.objectType || !payload.objectName) {
      return undefined;
    }

    if (requireTable && payload.objectType !== 'table') {
      return undefined;
    }

    const itemType = payload.objectType === 'view' ? 'view' : 'table';
    if (payload.objectType === 'database') {
      return new DatabaseTreeItem(
        payload.database,
        'database',
        payload.connectionId,
        payload.database,
        undefined,
        vscode.TreeItemCollapsibleState.None
      );
    }

    return new DatabaseTreeItem(
      payload.objectName,
      itemType,
      payload.connectionId,
      payload.database,
      payload.objectName,
      vscode.TreeItemCollapsibleState.None
    );
  };

  const getHomeSnapshot = async (): Promise<HomeSnapshot> => {
    const connections = await connectionManager.getConnections();
    const connectionSummaries = connections.map(connection => {
      const isConnected = connectionManager.isConnected(connection.id);
      if (isConnected) {
        scheduleConnectionHealthRefresh(connection);
      } else {
        homeHealthCache.delete(connection.id);
        homeHealthInFlight.delete(connection.id);
      }

      const health = homeHealthCache.get(connection.id);
      return {
        id: connection.id,
        name: connection.name,
        type: connection.type,
        host: connection.host || 'localhost',
        port: connection.port,
        environment: connection.environment,
        isConnected,
        latencyMs: health?.latencyMs,
        serverVersion: health?.serverVersion,
        healthError: health?.error,
        healthCheckedAt: health?.checkedAt
      };
    });
    const connectionById = new Map(connections.map(connection => [connection.id, connection]));
    const cardLayout = getHomeCardLayout();

    if (homeContextSelectionConnectionId && !connectionById.has(homeContextSelectionConnectionId)) {
      clearHomeContextDatabases(homeContextSelectionConnectionId);
      homeContextSelectionConnectionId = undefined;
      homeContextSelectionDatabase = undefined;
    }

    const contextSelectionConnectionId = homeContextSelectionConnectionId;
    if (
      contextSelectionConnectionId &&
      connectionManager.isConnected(contextSelectionConnectionId) &&
      !homeContextDatabasesCache.has(contextSelectionConnectionId) &&
      !homeContextDatabasesLoading.has(contextSelectionConnectionId)
    ) {
      void loadHomeContextDatabases(contextSelectionConnectionId, {
        connectIfNeeded: false,
        refreshPanel: true
      });
    }

    const contextDatabases = contextSelectionConnectionId
      ? (homeContextDatabasesCache.get(contextSelectionConnectionId) || [])
      : [];

    if (
      contextSelectionConnectionId &&
      homeContextSelectionDatabase &&
      contextDatabases.length > 0 &&
      !contextDatabases.some(item => item.name === homeContextSelectionDatabase)
    ) {
      homeContextSelectionDatabase = undefined;
    }

    const contextSelectionDatabase = contextSelectionConnectionId
      ? homeContextSelectionDatabase
      : undefined;
    const contextReady = Boolean(contextSelectionConnectionId && contextSelectionDatabase);

    const recentQueries = contextReady
      ? queryHistoryManager.getRecent(contextSelectionConnectionId, contextSelectionDatabase, 10)
      : [];
    const favoriteQueries = contextReady
      ? queryHistoryManager.getFavorites(contextSelectionConnectionId, contextSelectionDatabase, 10)
      : [];

    const favoriteObjects = (
      contextReady
        ? objectFavoritesManager
          .getRecent(50, contextSelectionConnectionId)
          .filter(entry => entry.database === contextSelectionDatabase)
          .slice(0, 20)
        : []
    ).map(entry => {
      const connection = connectionById.get(entry.connectionId);
      return {
        id: entry.id,
        connectionId: entry.connectionId,
        connectionName: connection?.name,
        database: entry.database,
        objectType: entry.objectType,
        objectName: entry.objectName,
        isConnected: connectionManager.isConnected(entry.connectionId),
        environment: connection?.environment,
        updatedAt: entry.updatedAt
      };
    });

    const cacheState =
      contextReady && contextSelectionConnectionId && contextSelectionDatabase
        ? sqlCompletionProvider.getCacheState(contextSelectionConnectionId, contextSelectionDatabase)
        : undefined;

    const metadataCacheStatus: 'empty' | 'ready' | 'stale' = cacheState
      ? (cacheState.exists ? (cacheState.stale ? 'stale' : 'ready') : 'empty')
      : 'empty';

    const metadataMatchesSelection =
      metadataRefreshState.connectionId === contextSelectionConnectionId &&
      metadataRefreshState.database === contextSelectionDatabase;

    return {
      activeConnectionId: activeQueryConnection,
      activeDatabase: activeQueryDatabase,
      contextSelectionConnectionId,
      contextSelectionDatabase,
      contextReady,
      contextDatabases,
      contextDatabasesLoading: contextSelectionConnectionId
        ? homeContextDatabasesLoading.has(contextSelectionConnectionId)
        : false,
      contextDatabasesError: contextSelectionConnectionId
        ? homeContextDatabasesError.get(contextSelectionConnectionId)
        : undefined,
      cardOrder: cardLayout.cardOrder,
      hiddenCards: cardLayout.hiddenCards,
      connections: connectionSummaries,
      favoriteObjects,
      metadata: {
        connectionId: contextSelectionConnectionId,
        database: contextSelectionDatabase,
        isRefreshing: (metadataMatchesSelection && metadataRefreshState.isRefreshing) || Boolean(cacheState?.refreshing),
        cacheStatus: metadataCacheStatus,
        lastRefreshAt: metadataMatchesSelection ? metadataRefreshState.lastRefreshAt : undefined,
        lastCacheAt: (metadataMatchesSelection ? metadataRefreshState.lastCacheAt : undefined) ?? cacheState?.lastRefresh,
        lastDurationMs: metadataMatchesSelection ? metadataRefreshState.lastDurationMs : undefined,
        lastError: metadataMatchesSelection ? metadataRefreshState.lastError : undefined
      },
      recentQueries: recentQueries.map(entry => {
        const connection = entry.connectionId ? connectionById.get(entry.connectionId) : undefined;
        return {
          sql: entry.sql,
          connectionId: entry.connectionId,
          connectionName: connection?.name,
          database: entry.database || connection?.database,
          updatedAt: entry.updatedAt,
          favorite: entry.favorite
        };
      }),
      favoriteQueries: favoriteQueries.map(entry => {
        const connection = entry.connectionId ? connectionById.get(entry.connectionId) : undefined;
        return {
          sql: entry.sql,
          connectionId: entry.connectionId,
          connectionName: connection?.name,
          database: entry.database || connection?.database,
          updatedAt: entry.updatedAt,
          favorite: entry.favorite
        };
      })
    };
  };

  const ensureHomeDatabaseContext = async (
    preferredConnectionId?: string,
    preferredDatabase?: string,
    options?: {
      forceConnectionPick?: boolean;
      forceDatabasePick?: boolean;
    }
  ): Promise<{ connectionId: string; databaseName: string } | undefined> => {
    const connections = await connectionManager.getConnections();
    if (connections.length === 0) {
      vscode.window.showErrorMessage(s.messages.noConnections);
      return undefined;
    }

    const forceConnectionPick = Boolean(options?.forceConnectionPick);
    const forceDatabasePick = Boolean(options?.forceDatabasePick);
    const shouldPromptConnection = forceConnectionPick && !preferredConnectionId && connections.length > 1;
    let connectionId = preferredConnectionId ||
      (!forceConnectionPick ? (homeContextSelectionConnectionId || activeQueryConnection) : undefined);
    if (
      !connectionId ||
      !connections.some(connection => connection.id === connectionId) ||
      shouldPromptConnection
    ) {
      if (connections.length === 1) {
        connectionId = connections[0].id;
      } else {
        const picks = connections.map(connection => ({
          label: connection.name,
          description: `${connection.type} - ${connection.host}:${connection.port}`,
          detail: homeContextSelectionConnectionId === connection.id || activeQueryConnection === connection.id
            ? (isChinese ? '当前活动连接' : 'Active connection')
            : undefined,
          id: connection.id
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: isChinese ? '选择连接' : 'Select a connection'
        });
        if (!selected) {
          return undefined;
        }
        connectionId = selected.id;
      }
    }

    return await restoreHomeConnection(connectionId, preferredDatabase, forceDatabasePick);
  };

  const pickHomeTableItem = async (
    mode: 'view' | 'edit',
    preferredConnectionId?: string
  ): Promise<DatabaseTreeItem | undefined> => {
    const contextInfo = preferredConnectionId
      ? await ensureHomeDatabaseContext(preferredConnectionId)
      : await requireHomeContextSelection();
    if (!contextInfo) {
      return undefined;
    }

    const provider = connectionManager.getProvider(contextInfo.connectionId);
    if (!provider || !provider.isConnected()) {
      vscode.window.showErrorMessage(s.messages.notConnected);
      return undefined;
    }

    const tables = await provider.getTables(contextInfo.databaseName);
    const candidates = mode === 'edit'
      ? tables.filter(table => table.type === 'TABLE')
      : tables;

    if (candidates.length === 0) {
      vscode.window.showWarningMessage(
        mode === 'edit'
          ? (isChinese ? '当前数据库没有可编辑的数据表。' : 'No editable tables found in current database.')
          : (isChinese ? '当前数据库没有可浏览的表或视图。' : 'No tables or views found in current database.')
      );
      return undefined;
    }

    const selected = await vscode.window.showQuickPick(
      candidates.map(table => ({
        label: `${table.type === 'VIEW' ? '$(eye)' : '$(table)'} ${table.name}`,
        description: table.type,
        table
      })),
      {
        placeHolder:
          mode === 'edit'
            ? (isChinese ? '选择要编辑的数据表' : 'Select table to edit')
            : (isChinese ? '选择要查看的表或视图' : 'Select table or view to open')
      }
    );

    if (!selected) {
      return undefined;
    }

    return new DatabaseTreeItem(
      selected.table.name,
      selected.table.type === 'VIEW' ? 'view' : 'table',
      contextInfo.connectionId,
      contextInfo.databaseName,
      selected.table.name,
      vscode.TreeItemCollapsibleState.None
    );
  };

  const handleHomeAction = async (
    action: HomeActionName,
    payload?: HomeActionPayload
  ): Promise<void> => {
    switch (action) {
      case 'addConnection':
        await vscode.commands.executeCommand('minidb.addConnection');
        return;
      case 'newQuery': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        const item = new DatabaseTreeItem(
          contextInfo.databaseName,
          'database',
          contextInfo.connectionId,
          contextInfo.databaseName,
          undefined,
          vscode.TreeItemCollapsibleState.None
        );
        await vscode.commands.executeCommand('minidb.newQuery', item);
        return;
      }
      case 'openSqlConsole': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        const item = new DatabaseTreeItem(
          contextInfo.databaseName,
          'database',
          contextInfo.connectionId,
          contextInfo.databaseName,
          undefined,
          vscode.TreeItemCollapsibleState.None
        );
        await vscode.commands.executeCommand('minidb.openSqlConsole', item);
        return;
      }
      case 'openTableData': {
        const tableItem = await pickHomeTableItem('view', payload?.connectionId);
        if (!tableItem) {
          return;
        }
        await vscode.commands.executeCommand('minidb.viewTableData', tableItem);
        return;
      }
      case 'openDataEditor': {
        const tableItem = await pickHomeTableItem('edit', payload?.connectionId);
        if (!tableItem) {
          return;
        }
        await vscode.commands.executeCommand('minidb.editTableData', tableItem);
        return;
      }
      case 'viewTableRelations': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        const item = new DatabaseTreeItem(
          contextInfo.databaseName,
          'database',
          contextInfo.connectionId,
          contextInfo.databaseName,
          undefined,
          vscode.TreeItemCollapsibleState.None
        );
        await vscode.commands.executeCommand('minidb.viewTableRelations', item);
        return;
      }
      case 'connectConnection':
        if (payload?.connectionId) {
          await connectHomeConnection(payload.connectionId);
        }
        return;
      case 'disconnectConnection':
        if (payload?.connectionId) {
          await disconnectHomeConnection(payload.connectionId);
        }
        return;
      case 'selectContextConnection':
        if (payload?.connectionId) {
          await selectHomeContextConnection(payload.connectionId);
        }
        return;
      case 'selectContextDatabase':
        if (payload?.connectionId && payload.database) {
          await selectHomeContextDatabase(payload.connectionId, payload.database);
        }
        return;
      case 'restoreConnection':
        if (payload?.connectionId) {
          await restoreHomeConnection(payload.connectionId, payload.database);
        } else {
          await ensureHomeDatabaseContext();
        }
        return;
      case 'viewConnectionDetails':
        if (payload?.connectionId) {
          await openHomeConnectionDetails(payload.connectionId);
        }
        return;
      case 'searchObjects': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        await vscode.commands.executeCommand('minidb.searchObjects');
        return;
      }
      case 'refreshMetadata': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        metadataRefreshState.connectionId = contextInfo.connectionId;
        metadataRefreshState.database = contextInfo.databaseName;
        await vscode.commands.executeCommand('minidb.refreshMetadata');
        return;
      }
      case 'showQueryHistory': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        await vscode.commands.executeCommand('minidb.showQueryHistory');
        return;
      }
      case 'configureCards':
        await configureHomeCards();
        return;
      case 'showFavoriteQueries': {
        const contextInfo = await requireHomeContextSelection();
        if (!contextInfo) {
          return;
        }
        await vscode.commands.executeCommand('minidb.showFavoriteQueries');
        return;
      }
      case 'addFavoriteObject':
        await addFavoriteObjectFromHome();
        return;
      case 'openFavoriteObjectData': {
        if (!payload) {
          return;
        }
        const contextInfo = await ensureHomeDatabaseContext(payload.connectionId, payload.database);
        if (!contextInfo) {
          return;
        }
        const item = buildFavoriteObjectItem(
          {
            ...payload,
            connectionId: contextInfo.connectionId,
            database: contextInfo.databaseName
          },
          false
        );
        if (!item || item.itemType === 'database') {
          return;
        }
        await vscode.commands.executeCommand('minidb.viewTableData', item);
        return;
      }
      case 'openFavoriteObjectEditor': {
        if (!payload) {
          return;
        }
        const contextInfo = await ensureHomeDatabaseContext(payload.connectionId, payload.database);
        if (!contextInfo) {
          return;
        }
        const item = buildFavoriteObjectItem(
          {
            ...payload,
            connectionId: contextInfo.connectionId,
            database: contextInfo.databaseName
          },
          true
        );
        if (!item) {
          vscode.window.showWarningMessage(
            isChinese ? '只有数据表支持编辑。' : 'Only table objects can be opened in editor.'
          );
          return;
        }
        await vscode.commands.executeCommand('minidb.editTableData', item);
        return;
      }
      case 'openFavoriteObjectSqlConsole': {
        if (!payload?.connectionId || !payload.database) {
          return;
        }
        const contextInfo = await ensureHomeDatabaseContext(payload.connectionId, payload.database);
        if (!contextInfo) {
          return;
        }
        const item = new DatabaseTreeItem(
          contextInfo.databaseName,
          'database',
          contextInfo.connectionId,
          contextInfo.databaseName,
          undefined,
          vscode.TreeItemCollapsibleState.None
        );
        await vscode.commands.executeCommand('minidb.openSqlConsole', item);
        return;
      }
      case 'removeFavoriteObject':
        if (payload?.favoriteId) {
          await objectFavoritesManager.removeById(payload.favoriteId);
          await refreshHomePanel();
          return;
        }
        if (
          payload?.connectionId &&
          payload.database &&
          payload.objectType &&
          payload.objectName
        ) {
          await objectFavoritesManager.remove({
            connectionId: payload.connectionId,
            database: payload.database,
            objectType: payload.objectType,
            objectName: payload.objectName
          });
          await refreshHomePanel();
        }
        return;
      case 'insertSql':
        if (payload?.sql?.trim()) {
          await insertSqlIntoActiveEditor(payload.sql);
        }
        return;
      case 'copySql':
        if (payload?.sql?.trim()) {
          await vscode.env.clipboard.writeText(payload.sql);
          vscode.window.setStatusBarMessage(
            isChinese ? 'SQL 已复制到剪贴板' : 'SQL copied to clipboard',
            2000
          );
        }
        return;
      case 'executeSql':
        if (payload?.sql?.trim()) {
          await executeSqlFromHome(payload.sql, payload);
        }
        return;
      case 'explainSql':
        if (payload?.sql?.trim()) {
          await explainSqlFromHome(payload.sql, payload);
        }
        return;
      default:
        return;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.openHome', async () => {
      homeContextSelectionConnectionId = undefined;
      homeContextSelectionDatabase = undefined;
      metadataRefreshState.connectionId = undefined;
      metadataRefreshState.database = undefined;
      const panel = HomePanel.createOrShow(context.extensionUri, {
        getSnapshot: getHomeSnapshot,
        handleAction: handleHomeAction
      });
      await panel.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.showQueryHistory', async () => {
      const scopedEntries = queryHistoryManager.getRecent(activeQueryConnection, activeQueryDatabase, 100);
      const entries = scopedEntries.length > 0
        ? scopedEntries
        : queryHistoryManager.getRecent(undefined, undefined, 100);

      if (entries.length === 0) {
        vscode.window.showInformationMessage(isChinese ? '\u6682\u65e0\u67e5\u8be2\u5386\u53f2\u3002' : 'No query history yet.');
        return;
      }

      const picks = entries.map(entry => {
        const firstLine = entry.sql.split(/\r?\n/)[0].slice(0, 120);
        const contextInfo = [entry.connectionId, entry.database].filter(Boolean).join(' / ');
        const timeText = new Date(entry.updatedAt).toLocaleString();
        return {
          label: `${entry.favorite ? '$(star-full) ' : ''}${firstLine}`,
          description: `${contextInfo || (isChinese ? '\u5168\u5c40' : 'Global')} | ${timeText}`,
          detail: entry.sql,
          sql: entry.sql
        };
      });

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: isChinese ? '\u9009\u62e9\u8981\u63d2\u5165\u7684\u67e5\u8be2' : 'Select a query to insert'
      });

      if (selected) {
        await insertSqlIntoActiveEditor(selected.sql);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.showFavoriteQueries', async () => {
      const scopedFavorites = queryHistoryManager.getFavorites(activeQueryConnection, activeQueryDatabase, 100);
      const favorites = scopedFavorites.length > 0
        ? scopedFavorites
        : queryHistoryManager.getFavorites(undefined, undefined, 100);

      if (favorites.length === 0) {
        vscode.window.showInformationMessage(isChinese ? '\u6682\u65e0\u6536\u85cf\u67e5\u8be2\u3002' : 'No favorite queries yet.');
        return;
      }

      const picks = favorites.map(entry => {
        const firstLine = entry.sql.split(/\r?\n/)[0].slice(0, 120);
        const contextInfo = [entry.connectionId, entry.database].filter(Boolean).join(' / ');
        const timeText = new Date(entry.updatedAt).toLocaleString();
        return {
          label: `$(star-full) ${firstLine}`,
          description: `${contextInfo || (isChinese ? '\u5168\u5c40' : 'Global')} | ${timeText}`,
          detail: entry.sql,
          sql: entry.sql
        };
      });

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: isChinese ? '\u9009\u62e9\u8981\u63d2\u5165\u7684\u6536\u85cf\u67e5\u8be2' : 'Select a favorite query to insert'
      });

      if (selected) {
        await insertSqlIntoActiveEditor(selected.sql);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.toggleFavoriteQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage(s.messages.noActiveEditor);
        return;
      }

      let sql = editor.document.getText();
      if (!editor.selection.isEmpty) {
        sql = editor.document.getText(editor.selection);
      }

      sql = sql.replace(/^--.*$/gm, '').trim();
      if (!sql) {
        vscode.window.showErrorMessage(s.messages.noQuery);
        return;
      }

      const nowFavorite = await queryHistoryManager.toggleFavorite(activeQueryConnection, activeQueryDatabase, sql);
      vscode.window.showInformationMessage(
        nowFavorite
          ? (isChinese ? '\u5df2\u6dfb\u52a0\u5230\u6536\u85cf\u67e5\u8be2\u3002' : 'Added to favorite queries.')
          : (isChinese ? '\u5df2\u4ece\u6536\u85cf\u67e5\u8be2\u79fb\u9664\u3002' : 'Removed from favorite queries.')
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.searchObjects', async () => {
      const connections = await connectionManager.getConnections();
      if (connections.length === 0) {
        vscode.window.showErrorMessage(s.messages.noConnections);
        return;
      }

      let connectionId = activeQueryConnection;
      if (!connectionId) {
        const picks = connections.map(c => ({
          label: c.name,
          description: `${c.type} - ${c.host}:${c.port}`,
          id: c.id
        }));
        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: s.messages.selectConnection
        });
        if (!selected) {
          return;
        }
        connectionId = selected.id;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      let databaseName = activeQueryDatabase;
      if (!databaseName) {
        const databases = await provider.getDatabases();
        if (databases.length === 0) {
          vscode.window.showErrorMessage(
            isChinese ? '\u8be5\u8fde\u63a5\u4e0b\u672a\u627e\u5230\u6570\u636e\u5e93\u3002' : 'No databases found for this connection.'
          );
          return;
        }
        const selectedDb = await vscode.window.showQuickPick(
          databases.map(db => ({ label: db.name })),
          { placeHolder: isChinese ? '\u9009\u62e9\u7528\u4e8e\u5bf9\u8c61\u641c\u7d22\u7684\u6570\u636e\u5e93' : 'Select a database for object search' }
        );
        if (!selectedDb) {
          return;
        }
        databaseName = selectedDb.label;
      }

      const keyword = await vscode.window.showInputBox({
        prompt: isChinese ? '\u641c\u7d22\u8868/\u89c6\u56fe/\u5217\u540d' : 'Search table/view/column name',
        placeHolder: isChinese ? '\u4f8b\u5982: user, order_id, logs' : 'e.g. user, order_id, logs',
        value: ''
      });

      if (keyword === undefined) {
        return;
      }

      const normalizedKeyword = keyword.trim().toLowerCase();

      const objects = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isChinese ? '\u6b63\u5728\u641c\u7d22\u6570\u636e\u5e93\u5bf9\u8c61...' : 'Searching database objects...',
          cancellable: false
        },
        async () => {
          const tables = await provider.getTables(databaseName!);
          const tablesWithColumns = await Promise.all(
            tables.map(async table => {
              try {
                const columns = await provider.getTableColumns(databaseName!, table.name);
                return { table, columns };
              } catch {
                return { table, columns: [] as { name: string; type: string }[] };
              }
            })
          );
          return tablesWithColumns;
        }
      );

      type SearchPick = vscode.QuickPickItem & {
        objectKind: 'table' | 'view' | 'column';
        tableName: string;
        columnName?: string;
      };

      const picks: SearchPick[] = [];
      for (const item of objects) {
        const tableName = item.table.name;
        const tableType = item.table.type === 'VIEW' ? 'view' : 'table';

        if (!normalizedKeyword || tableName.toLowerCase().includes(normalizedKeyword)) {
          picks.push({
            label: `${tableType === 'view' ? '$(eye)' : '$(table)'} ${tableName}`,
            description: `${item.table.type} in ${databaseName}`,
            objectKind: tableType,
            tableName
          });
        }

        for (const col of item.columns) {
          const fullName = `${tableName}.${col.name}`;
          if (!normalizedKeyword || fullName.toLowerCase().includes(normalizedKeyword) || col.name.toLowerCase().includes(normalizedKeyword)) {
            picks.push({
              label: `$(symbol-field) ${fullName}`,
              description: `${col.type}`,
              objectKind: 'column',
              tableName,
              columnName: col.name
            });
          }
        }
      }

      if (picks.length === 0) {
        vscode.window.showInformationMessage(isChinese ? '\u672a\u627e\u5230\u5339\u914d\u5bf9\u8c61\u3002' : 'No matching objects found.');
        return;
      }

      setActiveQueryContext(connectionId, databaseName);
      void refreshHomePanel();

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: isChinese ? `\u627e\u5230 ${picks.length} \u4e2a\u5bf9\u8c61` : `${picks.length} object(s) found`
      });
      if (!selected) {
        return;
      }

      if (selected.objectKind === 'column' && selected.columnName) {
        const conn = connections.find(c => c.id === connectionId);
        const dbType = conn?.type ?? 'mysql';
        const querySql = SqlEscape.buildSelectQuery(selected.tableName, dbType, {
          columns: [selected.columnName],
          limit: 100
        });

        const fileName = `object-search-${Date.now()}.sql`;
        const uri = vscode.Uri.parse(`untitled:${fileName}`);
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          uri,
          new vscode.Position(0, 0),
          `${isChinese ? '-- \u5bf9\u8c61\u641c\u7d22' : '-- Object Search'}: ${selected.tableName}.${selected.columnName}\n${querySql};\n`
        );
        await vscode.workspace.applyEdit(edit);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
      }

      const treeItem = new DatabaseTreeItem(
        selected.tableName,
        selected.objectKind === 'view' ? 'view' : 'table',
        connectionId,
        databaseName,
        selected.tableName,
        vscode.TreeItemCollapsibleState.None
      );
      await vscode.commands.executeCommand('minidb.viewTableData', treeItem);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.importData', async (item: DatabaseTreeItem) => {
      if (!item?.connectionId || !item.databaseName || !item.tableName) {
        vscode.window.showErrorMessage(
          isChinese ? '\u8bf7\u9009\u62e9\u4e00\u4e2a\u8868\u6765\u5bfc\u5165\u6570\u636e\u3002' : 'Please select a table to import data.'
        );
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      const connections = await connectionManager.getConnections();
      const conn = connections.find(c => c.id === item.connectionId);
      if (!conn) {
        vscode.window.showErrorMessage(s.messages.noConnection);
        return;
      }
      const dbType = conn.type;

      const pickedFiles = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: isChinese ? '\u9009\u62e9\u5bfc\u5165\u6587\u4ef6' : 'Select import file',
        filters: {
          [isChinese ? 'CSV / Excel XML / XLSX' : 'CSV / Excel XML / XLSX']: ['csv', 'xml', 'xlsx']
        }
      });

      if (!pickedFiles || pickedFiles.length === 0) {
        return;
      }

      const fileUri = pickedFiles[0];
      const extMatch = /\.[^.]+$/.exec(fileUri.fsPath);
      const extension = (extMatch?.[0] || '').toLowerCase();

      let parsed;
      try {
        const raw = await vscode.workspace.fs.readFile(fileUri);
        parsed = parseImportFile(raw, extension);
      } catch (error) {
        vscode.window.showErrorMessage(
          `${isChinese ? '\u89e3\u6790\u5bfc\u5165\u6587\u4ef6\u5931\u8d25' : 'Failed to parse import file'}: ${formatError(error)}`
        );
        return;
      }

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        vscode.window.showErrorMessage(
          isChinese ? '\u5bfc\u5165\u6587\u4ef6\u4e2d\u6ca1\u6709\u53ef\u7528\u6570\u636e\u884c\u3002' : 'Import file contains no usable rows.'
        );
        return;
      }

      const targetColumns = await provider.getTableColumns(item.databaseName, item.tableName);
      const targetColumnMap = new Map(targetColumns.map(col => [col.name.toLowerCase(), col]));
      const targetColumnNames = targetColumns.map(col => col.name);

      const mapping: Record<string, string | undefined> = {};
      for (const sourceCol of parsed.headers) {
        const matched = targetColumnMap.get(sourceCol.toLowerCase());
        mapping[sourceCol] = matched?.name;
      }

      const mappingChoice = await vscode.window.showQuickPick(
        [
          { label: isChinese ? '\u4f7f\u7528\u81ea\u52a8\u6620\u5c04\uff08\u63a8\u8350\uff09' : 'Use auto mapping (Recommended)', id: 'auto' },
          { label: isChinese ? '\u624b\u52a8\u68c0\u67e5\u6620\u5c04' : 'Review mapping manually', id: 'manual' }
        ],
        { placeHolder: isChinese ? '\u9009\u62e9\u5217\u6620\u5c04\u65b9\u5f0f' : 'Choose column mapping mode' }
      );

      if (!mappingChoice) {
        return;
      }

      if (mappingChoice.id === 'manual') {
        for (const sourceCol of parsed.headers) {
          const options = [
            { label: isChinese ? '\u8df3\u8fc7\u6b64\u5217' : 'Skip this column', value: undefined as string | undefined },
            ...targetColumnNames.map(colName => ({ label: colName, value: colName }))
          ];
          const selected = await vscode.window.showQuickPick(options, {
            placeHolder: isChinese ? `\u6620\u5c04\u6e90\u5217 "${sourceCol}"` : `Map source column "${sourceCol}"`,
          });
          if (!selected) {
            return;
          }
          mapping[sourceCol] = selected.value;
        }
      }

      const mappedPairs = Object.entries(mapping).filter(([, target]) => Boolean(target)) as Array<[string, string]>;
      if (mappedPairs.length === 0) {
        vscode.window.showErrorMessage(isChinese ? '\u672a\u9009\u62e9\u7528\u4e8e\u5bfc\u5165\u7684\u5217\u3002' : 'No columns selected for import.');
        return;
      }

      const previewRows = parsed.rows.slice(0, 5).map((row, index) => {
        const mapped = mappedPairs
          .map(([source, target]) => `${target}=${row[source] ?? ''}`)
          .join(', ');
        return `${index + 1}. ${mapped}`;
      }).join('\n');

      const previewText =
        `${isChinese ? '\u5bfc\u5165\u9884\u89c8' : 'Import Preview'}\n` +
        `${isChinese ? '\u6587\u4ef6' : 'File'}: ${fileUri.fsPath}\n` +
        `${isChinese ? '\u76ee\u6807' : 'Target'}: ${item.databaseName}.${item.tableName}\n` +
        `${isChinese ? '\u6620\u5c04\u5217' : 'Mapped Columns'}: ${mappedPairs.map(([s, t]) => `${s}->${t}`).join(', ')}\n` +
        `${isChinese ? '\u884c\u6570' : 'Rows'}: ${parsed.rows.length}\n\n` +
        `${isChinese ? '\u524d 5 \u884c' : 'First 5 rows'}:\n${previewRows}`;

      const previewUri = vscode.Uri.parse(`untitled:import-preview-${Date.now()}.txt`);
      const previewDoc = await vscode.workspace.openTextDocument(previewUri);
      const previewEdit = new vscode.WorkspaceEdit();
      previewEdit.insert(previewUri, new vscode.Position(0, 0), previewText);
      await vscode.workspace.applyEdit(previewEdit);
      await vscode.window.showTextDocument(previewDoc, { preview: true });

      const confirm = await vscode.window.showWarningMessage(
        isChinese
          ? `\u786e\u8ba4\u5bfc\u5165 ${parsed.rows.length} \u884c\u5230 ${item.tableName} \u5417\uff1f`
          : `Import ${parsed.rows.length} row(s) into ${item.tableName}?`,
        { modal: true },
        isChinese ? '\u5bfc\u5165' : 'Import',
        isChinese ? '\u53d6\u6d88' : 'Cancel'
      );
      if (confirm !== (isChinese ? '\u5bfc\u5165' : 'Import')) {
        return;
      }

      const escapedTable = SqlEscape.escapeTableName(item.tableName, dbType);
      let inserted = 0;
      let skipped = 0;
      const supportsTransaction = Boolean(
        provider.beginTransaction &&
        provider.commitTransaction &&
        provider.rollbackTransaction
      );
      let transactionStarted = false;

      try {
        if (supportsTransaction) {
          await provider.beginTransaction!(item.databaseName);
          transactionStarted = true;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: isChinese ? '\u6b63\u5728\u5bfc\u5165\u6570\u636e...' : 'Importing data...',
            cancellable: false
          },
          async progress => {
            for (let i = 0; i < parsed.rows.length; i++) {
              const row = parsed.rows[i];
              const columns: string[] = [];
              const values: string[] = [];

              for (const [sourceCol, targetCol] of mappedPairs) {
                const colMeta = targetColumnMap.get(targetCol.toLowerCase());
                columns.push(SqlEscape.escapeColumnName(targetCol, dbType));
                values.push(formatImportValue(String(row[sourceCol] ?? ''), dbType, colMeta?.type));
              }

              if (columns.length === 0) {
                skipped++;
                continue;
              }

              const sql = `INSERT INTO ${escapedTable} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
              const result = await executeProviderQuery(provider, item.connectionId!, sql, item.databaseName);
              if ((result.affectedRows ?? 1) > 0) {
                inserted++;
              } else {
                skipped++;
              }

              progress.report({
                increment: 100 / Math.max(parsed.rows.length, 1),
                message: `${i + 1}/${parsed.rows.length}`
              });
            }
          }
        );

        if (transactionStarted) {
          await provider.commitTransaction!();
        }
      } catch (error) {
        if (transactionStarted) {
          await provider.rollbackTransaction!().catch(() => undefined);
        }
        vscode.window.showErrorMessage(
          `${isChinese ? '\u5bfc\u5165\u5931\u8d25' : 'Import failed'}: ${formatError(error)}`
        );
        return;
      }

      vscode.window.showInformationMessage(
        isChinese
          ? `\u5bfc\u5165\u5b8c\u6210\u3002\u6210\u529f: ${inserted}\uff0c\u8df3\u8fc7: ${skipped}\uff0c\u603b\u8ba1: ${parsed.rows.length}`
          : `Import completed. Inserted: ${inserted}, Skipped: ${skipped}, Total: ${parsed.rows.length}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.selectConnection', async () => {
      const connections = await connectionManager.getConnections();
      
      if (connections.length === 0) {
        vscode.window.showErrorMessage(s.messages.noConnections);
        return;
      }

      const picks = connections.map(c => ({
        label: c.name,
        description: `${c.type} - ${c.host}:${c.port}`,
        id: c.id
      }));

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: s.messages.selectConnection
      });

      if (selected) {
        setActiveQueryContext(selected.id, undefined);
        void refreshHomePanel();
        vscode.window.showInformationMessage(`${s.messages.switchedTo}: ${selected.label}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.switchLanguage', async () => {
      const currentLang = i18n.language;
      const newLang: Language = currentLang === 'en' ? 'zh' : 'en';
      
      const config = vscode.workspace.getConfiguration('minidb');
      await config.update('language', newLang, vscode.ConfigurationTarget.Global);
      
      i18n.language = newLang;
      s = i18n.strings;
      isChinese = newLang === 'zh';
      await vscode.commands.executeCommand('setContext', LANGUAGE_CONTEXT_KEY, newLang);
      treeProvider.refresh();
      void refreshHomePanel();
      
      const langName = newLang === 'en' ? 'English' : '\u4e2d\u6587';
      vscode.window.showInformationMessage(
        newLang === 'zh' ? `\u8bed\u8a00\u5df2\u5207\u6362\u4e3a ${langName}` : `Language switched to ${langName}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.refreshTables', (item: DatabaseTreeItem) => {
      treeProvider.refreshItem(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.viewTableData', async (item: DatabaseTreeItem) => {
      if (!item.connectionId || !item.databaseName || !item.tableName) {
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      setActiveQueryContext(item.connectionId, item.databaseName);
      void refreshHomePanel();

      const connections = await connectionManager.getConnections();
      const conn = connections.find(c => c.id === item.connectionId);
      if (!conn) {
        vscode.window.showErrorMessage(s.messages.noConnection);
        return;
      }

      const config = vscode.workspace.getConfiguration('minidb');
      const maxResults = config.get<number>('maxResults', 1000);
      
      let sql: string;
      try {
        sql = SqlEscape.buildSelectQuery(item.tableName, conn.type, { limit: maxResults });
      } catch (escapeError) {
        vscode.window.showErrorMessage(
          `Invalid table name: ${escapeError instanceof Error ? escapeError.message : String(escapeError)}`
        );
        return;
      }

      try {
        const [result, columns] = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `${s.messages.loadingData} ${item.tableName}...`,
            cancellable: false
          },
          async () => {
            const queryResult = await executeProviderQuery(provider, item.connectionId!, sql, item.databaseName!);
            const columnMeta = await provider.getTableColumns(item.databaseName!, item.tableName!);
            return [queryResult, columnMeta] as const;
          }
        );
        
        result.columnMetadata = columns.map(col => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          isPrimaryKey: col.isPrimaryKey
        }));
        
        if (result.columns.length === 0 && columns.length > 0) {
          result.columns = columns.map(col => col.name);
        }
        
        const executeQueryCallback = async (querySql: string) => {
          return await executeProviderQuery(provider, item.connectionId!, querySql, item.databaseName);
        };
        
        const panel = QueryResultPanel.createOrShow(context.extensionUri, executeQueryCallback, conn.type);
        panel.updateResult(result, sql);
      } catch (error) {
        const panel = QueryResultPanel.createOrShow(context.extensionUri, undefined, conn.type);
        panel.showError(error instanceof Error ? error.message : String(error), sql);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.editTableData', async (item: DatabaseTreeItem) => {
      if (!item.connectionId || !item.databaseName || !item.tableName) {
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      const connections = await connectionManager.getConnections();
      const conn = connections.find(c => c.id === item.connectionId);
      if (!conn) {
        vscode.window.showErrorMessage(s.messages.noConnection);
        return;
      }

      const executeQueryCallback = async (sql: string) => {
        return await executeProviderQuery(provider, item.connectionId!, sql, item.databaseName);
      };

      const supportsEditorTransaction = Boolean(
        provider.beginTransaction &&
        provider.commitTransaction &&
        provider.rollbackTransaction
      );

      const beginTransactionCallback = supportsEditorTransaction
        ? async () => {
          await provider.beginTransaction!(item.databaseName);
        }
        : undefined;

      const commitTransactionCallback = supportsEditorTransaction
        ? async () => {
          await provider.commitTransaction!();
        }
        : undefined;

      const rollbackTransactionCallback = supportsEditorTransaction
        ? async () => {
          await provider.rollbackTransaction!();
        }
        : undefined;

      DataEditorPanel.createOrShow(
        context.extensionUri,
        item.connectionId,
        item.databaseName,
        item.tableName,
        conn.type,
        executeQueryCallback,
        beginTransactionCallback,
        commitTransactionCallback,
        rollbackTransactionCallback
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.viewTableStructure', async (item: DatabaseTreeItem) => {
      if (!item.connectionId || !item.databaseName || !item.tableName) {
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      try {
        const [columns, allForeignKeys] = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `${s.tableStructure.title}...`,
            cancellable: false
          },
          async () => {
            const columns = await provider.getTableColumns(item.databaseName!, item.tableName!);
            const allForeignKeys = await provider.getForeignKeys(item.databaseName!);
            
            return [columns, allForeignKeys];
          }
        );

        const foreignKeys = (allForeignKeys as { constraintName: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string }[])
          .filter(fk => fk.fromTable === item.tableName);
        
        const referencedBy = (allForeignKeys as { constraintName: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string }[])
          .filter(fk => fk.toTable === item.tableName);

        const panel = TableStructurePanel.createOrShow(context.extensionUri);
        panel.updateStructure(
          item.tableName,
          item.databaseName,
          columns as { name: string; type: string; nullable: boolean; defaultValue: string | null; isPrimaryKey: boolean }[],
          foreignKeys,
          referencedBy
        );
      } catch (error) {
        const panel = TableStructurePanel.createOrShow(context.extensionUri);
        panel.showError(error instanceof Error ? error.message : String(error));
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.viewTableRelations', async (item: DatabaseTreeItem) => {
      if (!item.connectionId || !item.databaseName) {
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      try {
        const [tables, foreignKeys] = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: s.relationViewer.title + '...',
            cancellable: false
          },
          async () => {
            const tables = await provider.getTables(item.databaseName!);
            const foreignKeys = await provider.getForeignKeys(item.databaseName!);
            
            const tablesWithColumns = await Promise.all(
              tables.map(async (table) => {
                const columns = await provider.getTableColumns(item.databaseName!, table.name);
                return { name: table.name, columns };
              })
            );
            
            return [tablesWithColumns, foreignKeys];
          }
        );

        TableRelationPanel.render(
          context.extensionUri,
          item.databaseName,
          tables as { name: string; columns: { name: string; type: string; nullable: boolean; isPrimaryKey: boolean; defaultValue: string | null }[] }[],
          foreignKeys as { constraintName: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string }[]
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `${isChinese ? '\u52a0\u8f7d\u8868\u5173\u7cfb\u5931\u8d25' : 'Failed to load table relations'}: ${formatError(error)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('minidb.openSqlConsole', async (item: DatabaseTreeItem) => {
      if (!item.connectionId || !item.databaseName) {
        return;
      }

      let provider;
      try {
        provider = await ensureConnectedProvider(item.connectionId);
      } catch (error) {
        vscode.window.showErrorMessage(failedToConnectMessage(error));
        return;
      }

      const connections = await connectionManager.getConnections();
      const conn = connections.find(c => c.id === item.connectionId);
      if (!conn) {
        vscode.window.showErrorMessage(s.messages.noConnection);
        return;
      }

      const executeSqlCallback = async (sql: string) => {
        try {
          const allowExecution = await confirmRiskySqlIfNeeded(sql, item.connectionId, item.databaseName);
          if (!allowExecution) {
            return {
              error: isChinese ? '已取消执行高风险 SQL。' : 'Risky SQL execution was cancelled.'
            };
          }
          const result = await executeProviderQuery(provider, item.connectionId!, sql, item.databaseName);
          return result;
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      };

      SqlConsolePanel.createOrShow(
        context.extensionUri,
        item.connectionId,
        item.databaseName,
        conn.type,
        executeSqlCallback,
        connectionManager,
        context
      );
    })
  );
}

export async function deactivate(): Promise<void> {
  await connectionManager.disconnectAll();
}


