import * as vscode from 'vscode';
import { i18n } from '../i18n';
import { ConnectionEnvironment } from '../models/types';
import { FavoriteObjectType } from '../utils/objectFavorites';

export type HomeActionName =
  | 'addConnection'
  | 'newQuery'
  | 'openSqlConsole'
  | 'openTableData'
  | 'openDataEditor'
  | 'viewTableRelations'
  | 'connectConnection'
  | 'disconnectConnection'
  | 'restoreConnection'
  | 'viewConnectionDetails'
  | 'searchObjects'
  | 'refreshMetadata'
  | 'selectContextConnection'
  | 'selectContextDatabase'
  | 'configureCards'
  | 'showQueryHistory'
  | 'showFavoriteQueries'
  | 'insertSql'
  | 'copySql'
  | 'executeSql'
  | 'explainSql'
  | 'addFavoriteObject'
  | 'openFavoriteObjectData'
  | 'openFavoriteObjectEditor'
  | 'openFavoriteObjectSqlConsole'
  | 'removeFavoriteObject';

export interface HomeActionPayload {
  sql?: string;
  connectionId?: string;
  database?: string;
  objectType?: FavoriteObjectType;
  objectName?: string;
  favoriteId?: string;
}

export interface HomeConnectionSummary {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  environment?: ConnectionEnvironment;
  isConnected: boolean;
  latencyMs?: number;
  serverVersion?: string;
  healthError?: string;
  healthCheckedAt?: number;
}

export interface HomeQuerySummary {
  sql: string;
  connectionId?: string;
  connectionName?: string;
  database?: string;
  updatedAt: number;
  favorite: boolean;
}

export interface HomeFavoriteObjectSummary {
  id: string;
  connectionId: string;
  connectionName?: string;
  database: string;
  objectType: FavoriteObjectType;
  objectName: string;
  isConnected: boolean;
  environment?: ConnectionEnvironment;
  updatedAt: number;
}

export interface HomeMetadataSummary {
  connectionId?: string;
  database?: string;
  isRefreshing: boolean;
  cacheStatus: 'empty' | 'ready' | 'stale';
  lastRefreshAt?: number;
  lastCacheAt?: number;
  lastDurationMs?: number;
  lastError?: string;
}

export interface HomeContextDatabaseSummary {
  name: string;
}

export type HomeCardId =
  | 'connections'
  | 'quickActions'
  | 'favoriteObjects'
  | 'metadata'
  | 'recentQueries'
  | 'favoriteQueries';

export interface HomeSnapshot {
  activeConnectionId?: string;
  activeDatabase?: string;
  contextSelectionConnectionId?: string;
  contextSelectionDatabase?: string;
  contextReady: boolean;
  contextDatabases: HomeContextDatabaseSummary[];
  contextDatabasesLoading: boolean;
  contextDatabasesError?: string;
  cardOrder: HomeCardId[];
  hiddenCards: HomeCardId[];
  connections: HomeConnectionSummary[];
  favoriteObjects: HomeFavoriteObjectSummary[];
  metadata: HomeMetadataSummary;
  recentQueries: HomeQuerySummary[];
  favoriteQueries: HomeQuerySummary[];
}

interface HomePanelCallbacks {
  getSnapshot: () => Promise<HomeSnapshot>;
  handleAction: (action: HomeActionName, payload?: HomeActionPayload) => Promise<void>;
}

export class HomePanel {
  public static currentPanel: HomePanel | undefined;
  public static readonly viewType = 'minidb.home';

  private readonly _panel: vscode.WebviewPanel;
  private _callbacks: HomePanelCallbacks;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    callbacks: HomePanelCallbacks
  ): HomePanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (HomePanel.currentPanel) {
      HomePanel.currentPanel._panel.reveal(column);
      HomePanel.currentPanel._callbacks = callbacks;
      return HomePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      HomePanel.viewType,
      i18n.language === 'zh' ? 'MiniDB 工作台' : 'MiniDB Home',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    HomePanel.currentPanel = new HomePanel(panel, extensionUri, callbacks);
    return HomePanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    callbacks: HomePanelCallbacks
  ) {
    this._panel = panel;
    this._callbacks = callbacks;
    this._panel.webview.html = this._getHtmlForWebview();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async message => {
        try {
          switch (message.command) {
            case 'ready':
            case 'refresh':
              await this.refresh();
              break;
            case 'action':
              await this._callbacks.handleAction(message.action, message.payload);
              await this.refresh();
              break;
          }
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          this._panel.webview.postMessage({
            command: 'error',
            message: messageText
          });
        }
      },
      null,
      this._disposables
    );
  }

  public async refresh(): Promise<void> {
    const snapshot = await this._callbacks.getSnapshot();
    this._panel.webview.postMessage({
      command: 'snapshot',
      data: snapshot
    });
  }

  private _isChineseLanguage(): boolean {
    return i18n.language === 'zh';
  }

  private _t(zh: string, en: string): string {
    return this._isChineseLanguage() ? zh : en;
  }

  private _getHtmlForWebview(): string {
    const nonce = this._getNonce();
    const labels = {
      title: this._t('MiniDB 工作台', 'MiniDB Home'),
      activeContext: this._t('当前上下文', 'Active Context'),
      noActiveContext: this._t('未完成上下文选择', 'Context is incomplete'),
      contextConnectionStep: this._t('步骤 1：选择连接', 'Step 1: Select Connection'),
      contextDatabaseStep: this._t('步骤 2：选择数据库', 'Step 2: Select Database'),
      selectConnectionFirst: this._t('请先选择连接', 'Select a connection first'),
      loadingDatabases: this._t('正在加载数据库列表...', 'Loading databases...'),
      applyingDatabaseContext: this._t('正在加载数据库上下文...', 'Applying database context...'),
      noDatabases: this._t('该连接下暂无数据库', 'No databases found for this connection'),
      databaseLoadFailed: this._t('数据库列表加载失败', 'Failed to load databases'),
      contextUnavailable: this._t('请先完成上方上下文选择（连接 + 数据库）', 'Complete context selection above (connection + database) first'),
      contextActionRequired: this._t('需先选择连接和数据库', 'Select connection and database first'),
      refresh: this._t('刷新', 'Refresh'),
      quickActions: this._t('快速开始', 'Quick Actions'),
      addConnection: this._t('新建连接', 'Add Connection'),
      newQuery: this._t('新建查询', 'New Query'),
      openSqlConsole: this._t('打开 SQL Console', 'Open SQL Console'),
      searchObjects: this._t('搜索对象', 'Search Objects'),
      refreshMetadata: this._t('刷新元数据', 'Refresh Metadata'),
      showQueryHistory: this._t('查询历史', 'Query History'),
      showFavoriteQueries: this._t('收藏查询', 'Favorite Queries'),
      configureCards: this._t('自定义卡片', 'Customize Cards'),
      openTableData: this._t('打开表数据', 'Open Table Data'),
      openDataEditor: this._t('打开数据编辑器', 'Open Data Editor'),
      viewTableRelations: this._t('查看表关系', 'View Table Relations'),
      addFavoriteObject: this._t('添加对象收藏', 'Add Favorite Object'),
      connectConnection: this._t('连接', 'Connect'),
      disconnectConnection: this._t('断开', 'Disconnect'),
      connectionDetails: this._t('详情', 'Details'),
      restoreConnection: this._t('恢复', 'Restore'),
      connections: this._t('连接概览', 'Connections'),
      noConnections: this._t('暂无连接', 'No connections'),
      connected: this._t('已连接', 'Connected'),
      disconnected: this._t('未连接', 'Disconnected'),
      favoriteObjects: this._t('对象收藏', 'Object Favorites'),
      noFavoriteObjects: this._t('暂无对象收藏', 'No favorite objects yet'),
      metadata: this._t('元数据状态', 'Metadata Status'),
      metadataRetry: this._t('重试刷新', 'Retry Refresh'),
      metadataCacheStatus: this._t('缓存状态', 'Cache Status'),
      metadataLastRefresh: this._t('上次刷新', 'Last Refresh'),
      metadataLastDuration: this._t('刷新耗时', 'Duration'),
      metadataLastError: this._t('失败原因', 'Last Error'),
      metadataCacheUpdatedAt: this._t('缓存更新时间', 'Cache Updated'),
      cacheEmpty: this._t('空', 'Empty'),
      cacheReady: this._t('可用', 'Ready'),
      cacheStale: this._t('过期', 'Stale'),
      recentQueries: this._t('最近 SQL', 'Recent SQL'),
      favoriteQueries: this._t('收藏 SQL', 'Favorite SQL'),
      noRecentQueries: this._t('暂无最近 SQL', 'No recent SQL'),
      noFavoriteQueries: this._t('暂无收藏 SQL', 'No favorite SQL'),
      insert: this._t('插入', 'Insert'),
      copy: this._t('复制', 'Copy'),
      execute: this._t('执行', 'Execute'),
      explain: this._t('执行计划', 'Explain'),
      viewData: this._t('查看数据', 'View Data'),
      editData: this._t('编辑数据', 'Edit Data'),
      openConsole: this._t('打开 Console', 'Open Console'),
      remove: this._t('移除', 'Remove'),
      connectionLabel: this._t('连接', 'Connection'),
      databaseLabel: this._t('数据库', 'Database'),
      objectType: this._t('对象类型', 'Object Type'),
      environment: this._t('环境', 'Environment'),
      envProd: this._t('生产', 'PROD'),
      envTest: this._t('测试', 'TEST'),
      envDev: this._t('开发', 'DEV'),
      typeDatabase: this._t('数据库', 'Database'),
      typeTable: this._t('表', 'Table'),
      typeView: this._t('视图', 'View'),
      unknown: this._t('未知', 'Unknown'),
      healthLabel: this._t('健康度', 'Health'),
      latencyLabel: this._t('延迟', 'Latency'),
      versionLabel: this._t('版本', 'Version'),
      healthUnavailable: this._t('健康检查失败', 'Health check failed'),
      checking: this._t('检测中...', 'Checking...'),
      msUnit: this._t('毫秒', 'ms')
    };

    const labelsJson = this._toSafeJson(labels);

    return `<!DOCTYPE html>
<html lang="${this._isChineseLanguage() ? 'zh' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${labels.title}</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .title {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
    .refresh-btn {
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .refresh-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .topbar-btn {
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
    }
    .topbar-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .active-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--vscode-editorWidget-background);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .active-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .active-value {
      font-size: 13px;
      font-weight: 500;
    }
    .context-selector {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .context-step {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-background);
      padding: 8px;
      width: 100%;
    }
    .context-step-title {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .context-card-list {
      display: grid;
      gap: 5px;
      min-height: 52px;
      width: 100%;
    }
    #contextConnectionList {
      grid-template-columns: repeat(6, minmax(0, 1fr));
    }
    #contextDatabaseList {
      grid-template-columns: repeat(8, minmax(0, 1fr));
      min-height: 38px;
    }
    #contextDatabaseList .context-option-compact {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      text-align: center;
    }
    #contextDatabaseList .context-option-title {
      justify-content: center;
      width: 100%;
      text-align: center;
    }
    .context-option {
      width: 100%;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 7px 9px;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .context-option-compact {
      padding: 3px 7px;
      gap: 0;
      border-radius: 3px;
    }
    .context-option-compact .context-option-title {
      font-size: 11px;
      line-height: 1.2;
    }
    .context-option:hover {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }
    .context-option:disabled {
      cursor: not-allowed;
      opacity: 0.72;
    }
    .context-option:disabled:hover {
      border-color: var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .context-option-selected {
      border-color: var(--vscode-focusBorder);
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }
    .context-option-title {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .context-option-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .context-option-empty {
      border-style: dashed;
      cursor: default;
      color: var(--vscode-descriptionForeground);
      grid-column: 1 / -1;
    }
    .context-option-empty-plain {
      border-style: solid;
    }
    .context-option-centered {
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 34px;
    }
    .context-option-loading {
      flex-direction: row;
      gap: 8px;
    }
    .context-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: context-spin 0.75s linear infinite;
      flex-shrink: 0;
    }
    @keyframes context-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .context-option-empty:hover {
      border-color: var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
    }
    .card-title {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .cards-host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .workspace-shell {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .workspace-shell .active-card {
      background: var(--vscode-editor-background);
    }
    .workspace-shell .card {
      background: var(--vscode-editor-background);
    }
    .actions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
      gap: 8px;
    }
    .action-btn {
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      border-radius: 4px;
      padding: 8px 10px;
      text-align: left;
      cursor: pointer;
      min-height: 36px;
    }
    .action-btn:hover {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-hoverBackground);
    }
    .action-btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .connections-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 8px;
    }
    .connection-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: var(--vscode-editor-background);
    }
    .connection-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-weight: 600;
    }
    .connection-head-main {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .connection-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status {
      font-size: 12px;
      font-weight: 500;
    }
    .status-connected {
      color: var(--vscode-testing-iconPassed);
    }
    .status-disconnected {
      color: var(--vscode-descriptionForeground);
    }
    .connection-detail {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .connection-health {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      margin-top: 2px;
      font-size: 11px;
    }
    .connection-health-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 7px;
      background: var(--vscode-editorWidget-background);
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .connection-health-error {
      color: var(--vscode-errorForeground);
      border-color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-editorWidget-background));
    }
    .connection-actions {
      margin-top: 4px;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .env-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }
    .env-prod {
      color: #f14c4c;
      border-color: #f14c4c;
      background: rgba(241, 76, 76, 0.12);
    }
    .env-test {
      color: #cca700;
      border-color: #cca700;
      background: rgba(204, 167, 0, 0.12);
    }
    .env-dev {
      color: #4ec9b0;
      border-color: #4ec9b0;
      background: rgba(78, 201, 176, 0.12);
    }
    .query-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 80px;
    }
    .query-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: inset 3px 0 0 var(--vscode-focusBorder);
    }
    .query-sql {
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      line-height: 1.5;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
      border-radius: 4px;
      padding: 6px 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1px solid var(--vscode-panel-border);
    }
    .sql-keyword {
      color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-terminal-ansiBlue));
      font-weight: 700;
    }
    .query-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11px;
    }
    .query-meta-sql {
      margin-top: 8px;
    }
    .meta-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-time {
      background: var(--vscode-editor-background);
      color: var(--vscode-descriptionForeground);
    }
    .query-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    .metadata-actions {
      justify-content: flex-end;
    }
    .metadata-retry-btn {
      padding: 6px 14px;
      font-size: 13px;
    }
    .query-btn {
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .query-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .query-btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .btn-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      flex-shrink: 0;
      animation: btn-spin 0.75s linear infinite;
    }
    @keyframes btn-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .favorite-object-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 80px;
    }
    .favorite-object-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .favorite-object-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .favorite-object-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 8px;
      margin-bottom: 8px;
    }
    .metadata-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 8px;
      background: var(--vscode-editor-background);
    }
    .metadata-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .metadata-value {
      font-size: 12px;
      font-weight: 600;
      word-break: break-word;
    }
    .metadata-error {
      color: var(--vscode-errorForeground);
      font-weight: 500;
      margin-bottom: 8px;
      font-size: 12px;
      word-break: break-word;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      padding: 10px 0;
    }
    .error {
      color: var(--vscode-errorForeground);
      min-height: 16px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <h1 class="title" id="title"></h1>
      <div class="topbar-actions">
        <button class="topbar-btn" data-action="addConnection" type="button" id="btnAddConnection"></button>
        <button class="topbar-btn" data-action="configureCards" type="button" id="btnConfigureCards"></button>
      </div>
    </div>
    <div class="card" data-card-id="connections">
      <h2 class="card-title" id="connectionsTitle"></h2>
      <div class="connections-list" id="connectionsList"></div>
    </div>
    <div class="workspace-shell">
      <div class="active-card">
        <div class="active-label" id="activeLabel"></div>
        <div class="active-value" id="activeValue"></div>
        <div class="context-selector">
          <div class="context-step">
            <div class="context-step-title" id="contextConnectionTitle"></div>
            <div class="context-card-list" id="contextConnectionList"></div>
          </div>
          <div class="context-step">
            <div class="context-step-title" id="contextDatabaseTitle"></div>
            <div class="context-card-list" id="contextDatabaseList"></div>
          </div>
        </div>
      </div>
      <div class="cards-host" id="cardsHost">
        <div class="card" data-card-id="quickActions">
          <h2 class="card-title" id="quickActionsTitle"></h2>
          <div class="actions-grid">
            <button class="action-btn" data-action="newQuery" type="button" id="btnNewQuery"></button>
            <button class="action-btn" data-action="openSqlConsole" type="button" id="btnOpenSqlConsole"></button>
            <button class="action-btn" data-action="openTableData" type="button" id="btnOpenTableData"></button>
            <button class="action-btn" data-action="openDataEditor" type="button" id="btnOpenDataEditor"></button>
            <button class="action-btn" data-action="viewTableRelations" type="button" id="btnViewTableRelations"></button>
            <button class="action-btn" data-action="searchObjects" type="button" id="btnSearchObjects"></button>
            <button class="action-btn" data-action="refreshMetadata" type="button" id="btnRefreshMetadata"></button>
            <button class="action-btn" data-action="showQueryHistory" type="button" id="btnShowQueryHistory"></button>
            <button class="action-btn" data-action="showFavoriteQueries" type="button" id="btnShowFavoriteQueries"></button>
            <button class="action-btn" data-action="addFavoriteObject" type="button" id="btnAddFavoriteObject"></button>
          </div>
        </div>
        <div class="card" data-card-id="favoriteObjects">
          <h2 class="card-title" id="favoriteObjectsTitle"></h2>
          <div class="favorite-object-list" id="favoriteObjectsList"></div>
        </div>
        <div class="card" data-card-id="metadata">
          <h2 class="card-title" id="metadataTitle"></h2>
          <div id="metadataContent"></div>
        </div>
        <div class="card" data-card-id="recentQueries">
          <h2 class="card-title" id="recentQueriesTitle"></h2>
          <div class="query-list" id="recentQueriesList"></div>
        </div>
        <div class="card" data-card-id="favoriteQueries">
          <h2 class="card-title" id="favoriteQueriesTitle"></h2>
          <div class="query-list" id="favoriteQueriesList"></div>
        </div>
      </div>
    </div>
    <div class="error" id="errorBox"></div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labelsJson};
    let snapshot = {
      activeConnectionId: undefined,
      activeDatabase: undefined,
      contextSelectionConnectionId: undefined,
      contextSelectionDatabase: undefined,
      contextReady: false,
      contextDatabases: [],
      contextDatabasesLoading: false,
      contextDatabasesError: undefined,
      cardOrder: ['connections', 'quickActions', 'metadata', 'recentQueries', 'favoriteQueries', 'favoriteObjects'],
      hiddenCards: [],
      connections: [],
      favoriteObjects: [],
      metadata: {
        isRefreshing: false,
        cacheStatus: 'empty'
      },
      recentQueries: [],
      favoriteQueries: []
    };
    let autoRefreshTimer = undefined;
    let pendingDetailConnectionId = undefined;
    let pendingConnectionActionId = undefined;
    let pendingContextConnectionSelection = undefined;
    let pendingContextDatabaseSelection = undefined;
    const HOME_CARD_IDS = ['connections', 'quickActions', 'metadata', 'recentQueries', 'favoriteQueries', 'favoriteObjects'];
    const SQL_KEYWORDS = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
      'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY',
      'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT',
      'NULL', 'IS', 'IN', 'EXISTS', 'LIKE', 'BETWEEN', 'UNION', 'ALL', 'CREATE',
      'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'EXPLAIN'
    ];
    const SQL_KEYWORD_REGEX = new RegExp('\\b(' + SQL_KEYWORDS.join('|') + ')\\b', 'gi');

    function setStaticLabels() {
      document.getElementById('title').textContent = labels.title;
      document.getElementById('activeLabel').textContent = labels.activeContext;
      document.getElementById('contextConnectionTitle').textContent = labels.contextConnectionStep;
      document.getElementById('contextDatabaseTitle').textContent = labels.contextDatabaseStep;
      document.getElementById('quickActionsTitle').textContent = labels.quickActions;
      document.getElementById('btnAddConnection').textContent = labels.addConnection;
      document.getElementById('btnNewQuery').textContent = labels.newQuery;
      document.getElementById('btnOpenSqlConsole').textContent = labels.openSqlConsole;
      document.getElementById('btnOpenTableData').textContent = labels.openTableData;
      document.getElementById('btnOpenDataEditor').textContent = labels.openDataEditor;
      document.getElementById('btnViewTableRelations').textContent = labels.viewTableRelations;
      document.getElementById('btnSearchObjects').textContent = labels.searchObjects;
      document.getElementById('btnRefreshMetadata').textContent = labels.refreshMetadata;
      document.getElementById('btnShowQueryHistory').textContent = labels.showQueryHistory;
      document.getElementById('btnShowFavoriteQueries').textContent = labels.showFavoriteQueries;
      document.getElementById('btnAddFavoriteObject').textContent = labels.addFavoriteObject;
      document.getElementById('btnConfigureCards').textContent = labels.configureCards;
      document.getElementById('connectionsTitle').textContent = labels.connections;
      document.getElementById('favoriteObjectsTitle').textContent = labels.favoriteObjects;
      document.getElementById('metadataTitle').textContent = labels.metadata;
      document.getElementById('recentQueriesTitle').textContent = labels.recentQueries;
      document.getElementById('favoriteQueriesTitle').textContent = labels.favoriteQueries;
    }

    function clearError() {
      document.getElementById('errorBox').textContent = '';
    }

    function showError(message) {
      document.getElementById('errorBox').textContent = message || '';
    }

    function postAction(action, payload) {
      clearError();
      vscode.postMessage({
        command: 'action',
        action,
        payload
      });
    }

    function formatDate(timestamp) {
      try {
        if (!timestamp) {
          return '-';
        }
        return new Date(timestamp).toLocaleString();
      } catch {
        return '-';
      }
    }

    function firstLine(sql) {
      const line = String(sql || '').split(/\\r?\\n/)[0];
      return line.slice(0, 220);
    }

    function escapeHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function highlightSql(sql) {
      const escaped = escapeHtml(sql);
      return escaped.replace(SQL_KEYWORD_REGEX, function(match) {
        return '<span class="sql-keyword">' + match.toUpperCase() + '</span>';
      });
    }

    function createMetaChip(text, extraClass) {
      const chip = document.createElement('span');
      chip.className = 'meta-chip' + (extraClass ? (' ' + extraClass) : '');
      chip.textContent = text;
      return chip;
    }

    function setButtonState(button, label, isLoading) {
      button.innerHTML = '';
      if (isLoading) {
        const spinner = document.createElement('span');
        spinner.className = 'btn-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        button.appendChild(spinner);
      }
      const text = document.createElement('span');
      text.className = 'query-btn-label';
      text.textContent = label;
      button.appendChild(text);
    }

    function hasPendingContextSelection() {
      return Boolean(pendingContextConnectionSelection || pendingContextDatabaseSelection);
    }

    function hasPendingOperation() {
      return Boolean(pendingDetailConnectionId || pendingConnectionActionId || hasPendingContextSelection());
    }

    function beginPendingConnectionAction(connectionId) {
      pendingConnectionActionId = connectionId;
      stopAutoRefresh();
      render();
    }

    function beginPendingDetails(connectionId) {
      pendingDetailConnectionId = connectionId;
      stopAutoRefresh();
      render();
    }

    function beginPendingContextConnection(connectionId) {
      pendingContextConnectionSelection = {
        connectionId
      };
      pendingContextDatabaseSelection = undefined;
      stopAutoRefresh();
      render();
    }

    function beginPendingContextDatabase(connectionId, databaseName) {
      pendingContextDatabaseSelection = {
        connectionId,
        database: databaseName
      };
      stopAutoRefresh();
      render();
    }

    function clearPendingOperations(options) {
      const force = Boolean(options && options.force);
      const latestSnapshot = options ? options.snapshot : undefined;
      let changed = false;
      if (pendingDetailConnectionId) {
        pendingDetailConnectionId = undefined;
        changed = true;
      }
      if (pendingConnectionActionId) {
        pendingConnectionActionId = undefined;
        changed = true;
      }
      if (force) {
        if (pendingContextConnectionSelection) {
          pendingContextConnectionSelection = undefined;
          changed = true;
        }
        if (pendingContextDatabaseSelection) {
          pendingContextDatabaseSelection = undefined;
          changed = true;
        }
      } else if (latestSnapshot) {
        if (pendingContextConnectionSelection) {
          const pendingConnectionId = pendingContextConnectionSelection.connectionId;
          const connectionSettled =
            latestSnapshot.contextSelectionConnectionId === pendingConnectionId &&
            !latestSnapshot.contextDatabasesLoading;
          const connectionFailed =
            latestSnapshot.contextSelectionConnectionId === pendingConnectionId &&
            Boolean(latestSnapshot.contextDatabasesError);
          const connectionRejected =
            !latestSnapshot.contextDatabasesLoading &&
            latestSnapshot.contextSelectionConnectionId !== pendingConnectionId;
          if (connectionSettled || connectionFailed || connectionRejected) {
            pendingContextConnectionSelection = undefined;
            changed = true;
          }
        }
        if (pendingContextDatabaseSelection) {
          const pendingConnectionId = pendingContextDatabaseSelection.connectionId;
          const pendingDatabaseName = pendingContextDatabaseSelection.database;
          const databaseSettled =
            latestSnapshot.contextSelectionConnectionId === pendingConnectionId &&
            latestSnapshot.contextSelectionDatabase === pendingDatabaseName &&
            Boolean(latestSnapshot.contextReady);
          const databaseResolvedWithoutSwitch =
            !latestSnapshot.contextDatabasesLoading &&
            latestSnapshot.contextSelectionConnectionId === pendingConnectionId &&
            latestSnapshot.contextSelectionDatabase !== pendingDatabaseName;
          const databaseConnectionChanged =
            latestSnapshot.contextSelectionConnectionId !== pendingConnectionId;
          if (databaseSettled || databaseResolvedWithoutSwitch || databaseConnectionChanged) {
            pendingContextDatabaseSelection = undefined;
            changed = true;
          }
        }
      }
      if (changed) {
        if (!hasPendingOperation()) {
          startAutoRefresh();
        }
      }
      return changed;
    }

    function normalizeCardOrder(order) {
      const normalized = [];
      (Array.isArray(order) ? order : []).forEach(cardId => {
        if (!HOME_CARD_IDS.includes(cardId) || normalized.includes(cardId)) {
          return;
        }
        normalized.push(cardId);
      });
      HOME_CARD_IDS.forEach(cardId => {
        if (!normalized.includes(cardId)) {
          normalized.push(cardId);
        }
      });
      return normalized;
    }

    function applyCardLayout() {
      const cardsHost = document.getElementById('cardsHost');
      if (!cardsHost) {
        return;
      }

      const hiddenCards = new Set(Array.isArray(snapshot.hiddenCards) ? snapshot.hiddenCards : []);
      const orderedCardIds = normalizeCardOrder(snapshot.cardOrder);
      orderedCardIds.forEach(cardId => {
        const card = cardsHost.querySelector('[data-card-id="' + cardId + '"]');
        if (!card) {
          return;
        }
        card.style.display = hiddenCards.has(cardId) ? 'none' : '';
        cardsHost.appendChild(card);
      });
    }

    function getSelectedConnectionId() {
      return snapshot.contextSelectionConnectionId;
    }

    function getSelectedDatabaseName() {
      return snapshot.contextSelectionDatabase;
    }

    function hasCompleteContext() {
      return Boolean(
        snapshot.contextReady &&
        getSelectedConnectionId() &&
        getSelectedDatabaseName() &&
        !hasPendingContextSelection()
      );
    }

    function appendEmptyContextOption(container, text, options) {
      const empty = document.createElement('div');
      empty.className = 'context-option context-option-empty';
      if (options && options.plain) {
        empty.classList.add('context-option-empty-plain');
      }
      if (options && options.center) {
        empty.classList.add('context-option-centered');
      }
      empty.textContent = text;
      container.appendChild(empty);
    }

    function appendLoadingContextOption(container, text) {
      const loading = document.createElement('div');
      loading.className = 'context-option context-option-empty context-option-empty-plain context-option-centered context-option-loading';
      const spinner = createInlineSpinner();
      const label = document.createElement('span');
      label.textContent = text;
      loading.appendChild(spinner);
      loading.appendChild(label);
      container.appendChild(loading);
    }

    function createInlineSpinner() {
      const spinner = document.createElement('span');
      spinner.className = 'context-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      return spinner;
    }

    function renderActiveContext() {
      const activeValue = document.getElementById('activeValue');
      const selectedConnectionId = getSelectedConnectionId();
      const selectedDatabase = getSelectedDatabaseName();
      if (!selectedConnectionId || !selectedDatabase) {
        activeValue.textContent = labels.noActiveContext;
        return;
      }

      const activeConnection = snapshot.connections.find(c => c.id === selectedConnectionId);
      const connectionLabel = activeConnection ? activeConnection.name : selectedConnectionId;
      activeValue.textContent =
        labels.connectionLabel + ': ' + connectionLabel + ' | ' + labels.databaseLabel + ': ' + selectedDatabase;
    }

    function renderContextSelector() {
      const connectionList = document.getElementById('contextConnectionList');
      const databaseList = document.getElementById('contextDatabaseList');
      connectionList.innerHTML = '';
      databaseList.innerHTML = '';

      const selectedConnectionId = getSelectedConnectionId();
      const selectedDatabase = getSelectedDatabaseName();
      const pendingConnectionId = pendingContextConnectionSelection
        ? pendingContextConnectionSelection.connectionId
        : undefined;
      const pendingDatabase = pendingContextDatabaseSelection;
      const effectiveConnectionId = pendingConnectionId || selectedConnectionId;
      const isContextSelectionLocked = hasPendingContextSelection();

      if (!snapshot.connections || snapshot.connections.length === 0) {
        appendEmptyContextOption(connectionList, labels.noConnections);
        appendEmptyContextOption(databaseList, labels.selectConnectionFirst, { plain: true, center: true });
        return;
      }

      snapshot.connections.forEach(connection => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'context-option';
        const isPendingConnection = pendingConnectionId === connection.id;
        if (connection.id === selectedConnectionId || isPendingConnection) {
          option.classList.add('context-option-selected');
        }
        const title = document.createElement('div');
        title.className = 'context-option-title';
        appendEnvironmentBadge(title, connection.environment);
        if (isPendingConnection) {
          title.appendChild(createInlineSpinner());
        }
        const name = document.createElement('span');
        name.className = 'connection-name';
        name.textContent = connection.name;
        title.appendChild(name);

        const desc = document.createElement('div');
        desc.className = 'context-option-desc';
        desc.textContent = connection.type + ' | ' + connection.host + ':' + connection.port;

        option.appendChild(title);
        option.appendChild(desc);
        option.disabled = isContextSelectionLocked;
        option.addEventListener('click', () => {
          if (hasPendingOperation()) {
            return;
          }
          beginPendingContextConnection(connection.id);
          postAction('selectContextConnection', { connectionId: connection.id });
        });
        connectionList.appendChild(option);
      });

      if (!effectiveConnectionId) {
        appendEmptyContextOption(databaseList, labels.selectConnectionFirst, { plain: true, center: true });
        return;
      }

      if (pendingConnectionId) {
        appendLoadingContextOption(databaseList, labels.loadingDatabases);
        return;
      }

      if (snapshot.contextDatabasesLoading) {
        appendLoadingContextOption(databaseList, labels.loadingDatabases);
        return;
      }

      if (snapshot.contextDatabasesError) {
        appendEmptyContextOption(
          databaseList,
          labels.databaseLoadFailed + ': ' + snapshot.contextDatabasesError,
          { plain: true, center: true }
        );
        return;
      }

      if (!snapshot.contextDatabases || snapshot.contextDatabases.length === 0) {
        appendEmptyContextOption(databaseList, labels.noDatabases, { plain: true, center: true });
        return;
      }

      snapshot.contextDatabases.forEach(entry => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'context-option context-option-compact';
        const isPendingDatabase = Boolean(
          pendingDatabase &&
          pendingDatabase.connectionId === effectiveConnectionId &&
          pendingDatabase.database === entry.name
        );
        const isSelectedDatabase =
          !pendingDatabase &&
          entry.name === selectedDatabase;
        if (isSelectedDatabase || isPendingDatabase) {
          option.classList.add('context-option-selected');
        }
        const title = document.createElement('div');
        title.className = 'context-option-title';
        if (isPendingDatabase) {
          title.appendChild(createInlineSpinner());
        }
        const name = document.createElement('span');
        name.textContent = entry.name;
        title.appendChild(name);
        option.appendChild(title);
        option.disabled = isContextSelectionLocked;
        option.addEventListener('click', () => {
          if (hasPendingOperation()) {
            return;
          }
          if (entry.name === selectedDatabase) {
            return;
          }
          beginPendingContextDatabase(effectiveConnectionId, entry.name);
          postAction('selectContextDatabase', {
            connectionId: effectiveConnectionId,
            database: entry.name
          });
        });
        databaseList.appendChild(option);
      });
    }

    function updateQuickActionAvailability() {
      const contextRequiredActions = new Set([
        'newQuery',
        'openSqlConsole',
        'openTableData',
        'openDataEditor',
        'viewTableRelations',
        'searchObjects',
        'refreshMetadata',
        'showQueryHistory',
        'showFavoriteQueries',
        'addFavoriteObject'
      ]);
      const contextReady = hasCompleteContext();

      document.querySelectorAll('[data-action]').forEach(button => {
        const action = button.getAttribute('data-action');
        if (!action) {
          return;
        }
        if (!contextRequiredActions.has(action)) {
          button.disabled = false;
          button.title = '';
          return;
        }
        button.disabled = !contextReady;
        button.title = contextReady ? '' : labels.contextActionRequired;
      });
    }

    function getEnvironmentLabel(environment) {
      switch (environment) {
        case 'prod':
          return labels.envProd;
        case 'test':
          return labels.envTest;
        case 'dev':
          return labels.envDev;
        default:
          return '';
      }
    }

    function appendEnvironmentBadge(container, environment) {
      if (!environment) {
        return;
      }
      const badge = document.createElement('span');
      badge.className = 'env-badge env-' + environment;
      badge.textContent = getEnvironmentLabel(environment);
      container.appendChild(badge);
    }

    function appendConnectionHealth(item, connection) {
      const health = document.createElement('div');
      health.className = 'connection-health';
      if (!connection.isConnected) {
        health.classList.add('connection-health-disconnected');
      }

      const latency = document.createElement('span');
      latency.className = 'connection-health-item';
      if (!connection.isConnected) {
        latency.textContent = labels.latencyLabel + ': -';
      } else if (typeof connection.latencyMs === 'number') {
        latency.textContent = labels.latencyLabel + ': ' + connection.latencyMs + ' ' + labels.msUnit;
      } else if (connection.healthError) {
        latency.textContent = labels.latencyLabel + ': -';
      } else {
        latency.textContent = labels.checking;
      }
      health.appendChild(latency);

      const version = document.createElement('span');
      version.className = 'connection-health-item';
      version.textContent = connection.serverVersion
        ? (labels.versionLabel + ': ' + connection.serverVersion)
        : (labels.versionLabel + ': -');
      health.appendChild(version);

      if (connection.isConnected && connection.healthError) {
        const error = document.createElement('span');
        error.className = 'connection-health-item connection-health-error';
        error.textContent = labels.healthUnavailable;
        health.appendChild(error);
      }

      item.appendChild(health);
    }

    function renderConnections() {
      const list = document.getElementById('connectionsList');
      list.innerHTML = '';

      if (!snapshot.connections || snapshot.connections.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.noConnections;
        list.appendChild(empty);
        return;
      }
      snapshot.connections.forEach(connection => {
        const item = document.createElement('div');
        item.className = 'connection-item';

        const head = document.createElement('div');
        head.className = 'connection-head';

        const left = document.createElement('div');
        left.className = 'connection-head-main';

        const name = document.createElement('span');
        name.className = 'connection-name';
        name.textContent = connection.name;

        appendEnvironmentBadge(left, connection.environment);
        left.appendChild(name);

        const status = document.createElement('span');
        status.className = 'status ' + (connection.isConnected ? 'status-connected' : 'status-disconnected');
        status.textContent = connection.isConnected ? labels.connected : labels.disconnected;

        head.appendChild(left);
        head.appendChild(status);

        const detail = document.createElement('div');
        detail.className = 'connection-detail';
        detail.textContent = connection.type + ' | ' + connection.host + ':' + connection.port;

        const actions = document.createElement('div');
        actions.className = 'connection-actions';

        const connectBtn = document.createElement('button');
        connectBtn.className = 'query-btn';
        connectBtn.type = 'button';
        const isConnectionActionLoading = pendingConnectionActionId === connection.id;
        const connectionAction = connection.isConnected ? 'disconnectConnection' : 'connectConnection';
        const connectionActionLabel = connection.isConnected ? labels.disconnectConnection : labels.connectConnection;
        setButtonState(connectBtn, connectionActionLabel, isConnectionActionLoading);
        connectBtn.disabled = isConnectionActionLoading;
        connectBtn.addEventListener('click', () => {
          if (hasPendingOperation()) {
            return;
          }
          beginPendingConnectionAction(connection.id);
          postAction(connectionAction, { connectionId: connection.id });
        });

        const detailsBtn = document.createElement('button');
        detailsBtn.className = 'query-btn';
        detailsBtn.type = 'button';
        const isDetailsLoading = pendingDetailConnectionId === connection.id;
        setButtonState(detailsBtn, labels.connectionDetails, isDetailsLoading);
        detailsBtn.disabled = !connection.isConnected || isDetailsLoading || isConnectionActionLoading;
        detailsBtn.addEventListener('click', () => {
          if (hasPendingOperation()) {
            return;
          }
          beginPendingDetails(connection.id);
          postAction('viewConnectionDetails', { connectionId: connection.id });
        });

        actions.appendChild(connectBtn);
        actions.appendChild(detailsBtn);

        item.appendChild(head);
        item.appendChild(detail);
        appendConnectionHealth(item, connection);
        item.appendChild(actions);
        list.appendChild(item);
      });
    }

    function getObjectTypeLabel(type) {
      if (type === 'database') {
        return labels.typeDatabase;
      }
      if (type === 'table') {
        return labels.typeTable;
      }
      if (type === 'view') {
        return labels.typeView;
      }
      return labels.unknown;
    }

    function getObjectIcon(type) {
      if (type === 'database') {
        return '$(database)';
      }
      if (type === 'table') {
        return '$(table)';
      }
      if (type === 'view') {
        return '$(eye)';
      }
      return '$(circle-outline)';
    }

    function renderFavoriteObjects() {
      const container = document.getElementById('favoriteObjectsList');
      container.innerHTML = '';

      if (!hasCompleteContext()) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.contextUnavailable;
        container.appendChild(empty);
        return;
      }

      if (!snapshot.favoriteObjects || snapshot.favoriteObjects.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.noFavoriteObjects;
        container.appendChild(empty);
        return;
      }

      snapshot.favoriteObjects.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'favorite-object-item';

        const head = document.createElement('div');
        head.className = 'favorite-object-head';

        const name = document.createElement('div');
        name.className = 'favorite-object-name';
        name.textContent = getObjectIcon(entry.objectType) + ' ' + entry.objectName;

        const envContainer = document.createElement('div');
        appendEnvironmentBadge(envContainer, entry.environment);

        head.appendChild(name);
        head.appendChild(envContainer);

        const meta = document.createElement('div');
        meta.className = 'query-meta';
        meta.appendChild(createMetaChip(labels.connectionLabel + ': ' + (entry.connectionName || entry.connectionId)));
        meta.appendChild(createMetaChip(labels.databaseLabel + ': ' + entry.database));
        meta.appendChild(createMetaChip(labels.objectType + ': ' + getObjectTypeLabel(entry.objectType)));
        meta.appendChild(createMetaChip(formatDate(entry.updatedAt), 'meta-time'));

        const actions = document.createElement('div');
        actions.className = 'query-actions';

        const viewDataBtn = document.createElement('button');
        viewDataBtn.className = 'query-btn';
        viewDataBtn.type = 'button';
        viewDataBtn.textContent = labels.viewData;
        viewDataBtn.disabled = entry.objectType === 'database';
        viewDataBtn.addEventListener('click', () => {
          postAction('openFavoriteObjectData', {
            favoriteId: entry.id,
            connectionId: entry.connectionId,
            database: entry.database,
            objectType: entry.objectType,
            objectName: entry.objectName
          });
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'query-btn';
        editBtn.type = 'button';
        editBtn.textContent = labels.editData;
        editBtn.disabled = entry.objectType !== 'table';
        editBtn.addEventListener('click', () => {
          postAction('openFavoriteObjectEditor', {
            favoriteId: entry.id,
            connectionId: entry.connectionId,
            database: entry.database,
            objectType: entry.objectType,
            objectName: entry.objectName
          });
        });

        const consoleBtn = document.createElement('button');
        consoleBtn.className = 'query-btn';
        consoleBtn.type = 'button';
        consoleBtn.textContent = labels.openConsole;
        consoleBtn.addEventListener('click', () => {
          postAction('openFavoriteObjectSqlConsole', {
            favoriteId: entry.id,
            connectionId: entry.connectionId,
            database: entry.database,
            objectType: entry.objectType,
            objectName: entry.objectName
          });
        });

        const removeBtn = document.createElement('button');
        removeBtn.className = 'query-btn';
        removeBtn.type = 'button';
        removeBtn.textContent = labels.remove;
        removeBtn.addEventListener('click', () => {
          postAction('removeFavoriteObject', {
            favoriteId: entry.id,
            connectionId: entry.connectionId,
            database: entry.database,
            objectType: entry.objectType,
            objectName: entry.objectName
          });
        });

        actions.appendChild(viewDataBtn);
        actions.appendChild(editBtn);
        actions.appendChild(consoleBtn);
        actions.appendChild(removeBtn);

        item.appendChild(head);
        item.appendChild(meta);
        item.appendChild(actions);
        container.appendChild(item);
      });
    }

    function mapCacheStatus(cacheStatus) {
      if (cacheStatus === 'ready') {
        return labels.cacheReady;
      }
      if (cacheStatus === 'stale') {
        return labels.cacheStale;
      }
      return labels.cacheEmpty;
    }

    function createMetadataItem(label, value) {
      const wrapper = document.createElement('div');
      wrapper.className = 'metadata-item';
      const labelNode = document.createElement('div');
      labelNode.className = 'metadata-label';
      labelNode.textContent = label;
      const valueNode = document.createElement('div');
      valueNode.className = 'metadata-value';
      valueNode.textContent = value;
      wrapper.appendChild(labelNode);
      wrapper.appendChild(valueNode);
      return wrapper;
    }

    function renderMetadataCard() {
      const container = document.getElementById('metadataContent');
      container.innerHTML = '';

      if (!hasCompleteContext()) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.contextUnavailable;
        container.appendChild(empty);
        return;
      }

      const metadata = snapshot.metadata || {
        isRefreshing: false,
        cacheStatus: 'empty'
      };

      const grid = document.createElement('div');
      grid.className = 'metadata-grid';
      grid.appendChild(createMetadataItem(labels.connectionLabel, metadata.connectionId || '-'));
      grid.appendChild(createMetadataItem(labels.databaseLabel, metadata.database || '-'));
      grid.appendChild(createMetadataItem(labels.metadataCacheStatus, mapCacheStatus(metadata.cacheStatus)));
      grid.appendChild(createMetadataItem(labels.metadataLastRefresh, formatDate(metadata.lastRefreshAt)));
      grid.appendChild(createMetadataItem(labels.metadataCacheUpdatedAt, formatDate(metadata.lastCacheAt)));
      grid.appendChild(createMetadataItem(
        labels.metadataLastDuration,
        typeof metadata.lastDurationMs === 'number' ? (metadata.lastDurationMs + ' ' + labels.msUnit) : '-'
      ));
      container.appendChild(grid);

      if (metadata.lastError) {
        const err = document.createElement('div');
        err.className = 'metadata-error';
        err.textContent = labels.metadataLastError + ': ' + metadata.lastError;
        container.appendChild(err);
      }

      const actions = document.createElement('div');
      actions.className = 'query-actions metadata-actions';
      const retryBtn = document.createElement('button');
      retryBtn.className = 'query-btn metadata-retry-btn';
      retryBtn.type = 'button';
      setButtonState(retryBtn, labels.metadataRetry, Boolean(metadata.isRefreshing));
      retryBtn.disabled = Boolean(metadata.isRefreshing);
      retryBtn.addEventListener('click', () => {
        if (metadata.isRefreshing) {
          return;
        }
        postAction('refreshMetadata');
      });
      actions.appendChild(retryBtn);
      container.appendChild(actions);
    }

    function renderQueryList(entries, containerId, emptyText) {
      const container = document.getElementById(containerId);
      container.innerHTML = '';

      if (!hasCompleteContext()) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = labels.contextUnavailable;
        container.appendChild(empty);
        return;
      }

      if (!entries || entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }

      entries.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'query-item';

        const sql = document.createElement('div');
        sql.className = 'query-sql';
        sql.innerHTML = highlightSql(firstLine(entry.sql));

        const meta = document.createElement('div');
        meta.className = 'query-meta query-meta-sql';
        const connectionValue = entry.connectionName || entry.connectionId || '-';
        const databaseValue = entry.database ? entry.database : '-';
        const timeValue = formatDate(entry.updatedAt);
        meta.appendChild(createMetaChip(labels.connectionLabel + ': ' + connectionValue));
        meta.appendChild(createMetaChip(labels.databaseLabel + ': ' + databaseValue));
        meta.appendChild(createMetaChip(timeValue, 'meta-time'));

        const actions = document.createElement('div');
        actions.className = 'query-actions';

        const insertBtn = document.createElement('button');
        insertBtn.className = 'query-btn';
        insertBtn.type = 'button';
        insertBtn.textContent = labels.insert;
        insertBtn.addEventListener('click', () => {
          postAction('insertSql', {
            sql: entry.sql,
            connectionId: entry.connectionId,
            database: entry.database
          });
        });

        const copyBtn = document.createElement('button');
        copyBtn.className = 'query-btn';
        copyBtn.type = 'button';
        copyBtn.textContent = labels.copy;
        copyBtn.addEventListener('click', () => {
          postAction('copySql', { sql: entry.sql });
        });

        const runBtn = document.createElement('button');
        runBtn.className = 'query-btn';
        runBtn.type = 'button';
        runBtn.textContent = labels.execute;
        runBtn.addEventListener('click', () => {
          postAction('executeSql', {
            sql: entry.sql,
            connectionId: entry.connectionId,
            database: entry.database
          });
        });

        const explainBtn = document.createElement('button');
        explainBtn.className = 'query-btn';
        explainBtn.type = 'button';
        explainBtn.textContent = labels.explain;
        explainBtn.addEventListener('click', () => {
          postAction('explainSql', {
            sql: entry.sql,
            connectionId: entry.connectionId,
            database: entry.database
          });
        });

        actions.appendChild(insertBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(runBtn);
        actions.appendChild(explainBtn);

        item.appendChild(sql);
        item.appendChild(meta);
        item.appendChild(actions);
        container.appendChild(item);
      });
    }

    function render() {
      renderActiveContext();
      renderContextSelector();
      updateQuickActionAvailability();
      applyCardLayout();
      renderConnections();
      renderFavoriteObjects();
      renderMetadataCard();
      renderQueryList(snapshot.recentQueries, 'recentQueriesList', labels.noRecentQueries);
      renderQueryList(snapshot.favoriteQueries, 'favoriteQueriesList', labels.noFavoriteQueries);
    }

    function bindActions() {
      document.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', () => {
          if (button.disabled) {
            return;
          }
          const action = button.getAttribute('data-action');
          if (!action) {
            return;
          }
          postAction(action);
        });
      });
    }

    function startAutoRefresh() {
      if (autoRefreshTimer !== undefined) {
        return;
      }
      autoRefreshTimer = setInterval(() => {
        vscode.postMessage({ command: 'refresh' });
      }, 2500);
    }

    function stopAutoRefresh() {
      if (autoRefreshTimer === undefined) {
        return;
      }
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = undefined;
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.command === 'snapshot' && message.data) {
        clearError();
        snapshot = message.data;
        clearPendingOperations({ snapshot });
        render();
      } else if (message.command === 'error') {
        showError(message.message);
        if (clearPendingOperations({ force: true })) {
          render();
        }
      }
    });

    setStaticLabels();
    bindActions();
    startAutoRefresh();
    render();
    vscode.postMessage({ command: 'ready' });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAutoRefresh();
        return;
      }
      if (!hasPendingOperation()) {
        startAutoRefresh();
      }
      vscode.postMessage({ command: 'refresh' });
    });
  </script>
</body>
</html>`;
  }

  private _toSafeJson(value: unknown): string {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  public dispose(): void {
    HomePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

