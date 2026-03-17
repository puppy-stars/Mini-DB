﻿﻿﻿import * as vscode from 'vscode';
import { i18n } from '../i18n';
import { SQL_KEYWORDS, SQL_FUNCTIONS, SQL_DATA_TYPES } from '../utils/sqlKeywords';
import { DatabaseType } from '../models/types';
import { SqlEscape } from '../utils/sqlEscape';
import { extractTotalRows } from '../utils/queryResultUtils';
import { QueryHistoryManager } from '../utils/queryHistory';
import { ExplainPlanPanel } from './explainPlanPanel';

interface ConsoleLine {
  type: 'input' | 'output' | 'error' | 'success' | 'info' | 'warning';
  content: string;
  timestamp?: string;
}

interface HelpPanelCommand {
  command: string;
  description: string;
}

interface HelpPanelData {
  title: string;
  commands: HelpPanelCommand[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
}

interface TableState {
  sql: string;
  currentPage: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  currentRows: Record<string, unknown>[];
  columns: string[];
  isLoading: boolean;
}

interface HistoryItem {
  type: 'line' | 'table' | 'helpPanel';
  line?: ConsoleLine;
  tableId?: string;
  helpPanel?: HelpPanelData;
}

interface TableMetadata {
  name: string;
  columns: { name: string; type: string }[];
}

interface CompletionItem {
  label: string;
  kind: 'keyword' | 'function' | 'table' | 'column' | 'dataType';
  detail: string;
}

interface ConsoleCommandSuggestion {
  label: string;
  detail: string;
}

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500];
const MAX_COMMAND_HISTORY = 500;

export class SqlConsolePanel {
  public static currentPanel: SqlConsolePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionContext: vscode.ExtensionContext;
  private readonly _extensionUri: vscode.Uri;
  private readonly _queryHistoryManager: QueryHistoryManager;
  private _disposables: vscode.Disposable[] = [];
  private _history: HistoryItem[] = [];
  private _commandHistory: string[] = [];
  private _isSqlMode: boolean = false;
  private _connectionId?: string;
  private _database?: string;
  private _executeSqlCallback?: (sql: string) => Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executionTime: number } | { error: string }>;
  private _tableStates: Map<string, TableState> = new Map();
  private _tableCounter: number = 0;
  private _metadata: TableMetadata[] = [];
  private _metadataLoaded: boolean = false;
  private _connectionManager?: any;
  private _dbType: DatabaseType = 'mysql';
  private _lastExecutedSql: string | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._extensionContext = context;
    this._queryHistoryManager = new QueryHistoryManager(context);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._loadCommandHistory();
    
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'input':
            await this._handleInput(message.text);
            break;
          case 'ready':
            this._updateWebview();
            break;
          case 'goToPage':
            await this._handleGoToPage(message.tableId, message.page);
            break;
          case 'changePageSize':
            await this._handleChangePageSize(message.tableId, message.pageSize);
            break;
          case 'getCompletions':
            await this._handleGetCompletions(message.text, message.position);
            break;
          case 'loadMetadata':
            await this._loadMetadata();
            break;
          case 'getCommandHistory':
            this._handleGetCommandHistory();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    connectionId: string,
    database: string,
    dbType: DatabaseType,
    executeSqlCallback: (sql: string) => Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; executionTime: number } | { error: string }>,
    connectionManager?: any,
    context?: vscode.ExtensionContext
  ): SqlConsolePanel {
    const s = i18n.strings;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SqlConsolePanel.currentPanel) {
      SqlConsolePanel.currentPanel._panel.reveal(column);
      SqlConsolePanel.currentPanel._connectionId = connectionId;
      SqlConsolePanel.currentPanel._database = database;
      SqlConsolePanel.currentPanel._dbType = dbType;
      SqlConsolePanel.currentPanel._executeSqlCallback = executeSqlCallback;
      SqlConsolePanel.currentPanel._connectionManager = connectionManager;
      SqlConsolePanel.currentPanel._metadataLoaded = false;
      SqlConsolePanel.currentPanel._metadata = [];
      SqlConsolePanel.currentPanel._clearHistory();
      SqlConsolePanel.currentPanel._addLine(
        'info',
        i18n.language === 'zh'
          ? `\u5df2\u8fde\u63a5\u5230\u6570\u636e\u5e93: ${database}`
          : `Connected to database: ${database}`
      );
      SqlConsolePanel.currentPanel._addLine('info', SqlConsolePanel.currentPanel._getStartupHintLine());
      return SqlConsolePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'sqlConsole',
      `${s.console.title} - ${database}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    SqlConsolePanel.currentPanel = new SqlConsolePanel(panel, extensionUri, context!);
    SqlConsolePanel.currentPanel._connectionId = connectionId;
    SqlConsolePanel.currentPanel._database = database;
    SqlConsolePanel.currentPanel._dbType = dbType;
    SqlConsolePanel.currentPanel._executeSqlCallback = executeSqlCallback;
    SqlConsolePanel.currentPanel._connectionManager = connectionManager;
    SqlConsolePanel.currentPanel._panel.webview.html = SqlConsolePanel.currentPanel._getHtmlForWebview();
    SqlConsolePanel.currentPanel._addLine(
      'info',
      i18n.language === 'zh'
        ? '\u6b22\u8fce\u4f7f\u7528 MiniDB SQL \u63a7\u5236\u53f0'
        : 'Welcome to MiniDB SQL Console'
    );
    SqlConsolePanel.currentPanel._addLine(
      'info',
      i18n.language === 'zh'
        ? `\u5df2\u8fde\u63a5\u5230\u6570\u636e\u5e93: ${database}`
        : `Connected to database: ${database}`
    );
    SqlConsolePanel.currentPanel._addLine('info', SqlConsolePanel.currentPanel._getStartupHintLine());

    return SqlConsolePanel.currentPanel;
  }

  private _addLine(type: ConsoleLine['type'], content: string) {
    const timestamp = new Date().toLocaleTimeString();
    this._history.push({ type: 'line', line: { type, content, timestamp } });
    this._updateWebview();
  }

  private async _addTable(result: QueryResult, sql: string) {
    const tableId = `table-${++this._tableCounter}`;
    
    const state: TableState = {
      sql: sql.trim(),
      currentPage: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalRows: result.rowCount,
      totalPages: Math.ceil(result.rowCount / DEFAULT_PAGE_SIZE) || 1,
      currentRows: result.rows,
      columns: result.columns,
      isLoading: false
    };
    
    this._tableStates.set(tableId, state);
    this._history.push({ type: 'table', tableId });
    this._updateWebview();
  }

  private _isChineseLanguage(): boolean {
    return i18n.language === 'zh';
  }

  private _t(zh: string, en: string): string {
    return this._isChineseLanguage() ? zh : en;
  }

  private _getConsoleCommandSuggestions(): ConsoleCommandSuggestion[] {
    return [
      { label: 'sql', detail: this._t('\u8fdb\u5165 SQL \u6a21\u5f0f', 'Enter SQL mode') },
      { label: 'clear', detail: this._t('\u6e05\u7a7a\u63a7\u5236\u53f0\u8f93\u51fa', 'Clear console output') },
      { label: 'clearcommand', detail: this._t('\u6e05\u7a7a\u547d\u4ee4\u5386\u53f2', 'Clear command history') },
      { label: 'reset', detail: this._t('\u91cd\u7f6e\u63a7\u5236\u53f0\u5230\u521d\u59cb\u72b6\u6001', 'Reset console to initial state') },
      { label: 'relation', detail: this._t('\u6253\u5f00\u6570\u636e\u5e93\u8868\u5173\u7cfb\u9762\u677f', 'Open table relation panel') },
      { label: 'help', detail: this._t('\u663e\u793a\u5e2e\u52a9', 'Show help') },
      { label: ':exit', detail: this._t('\u9000\u51fa SQL \u6a21\u5f0f\uff08SQL \u6a21\u5f0f\u4e0b\u4f7f\u7528\uff09', 'Exit SQL mode (use in SQL mode)') },
      { label: ':clear', detail: this._t('\u6e05\u7a7a\u63a7\u5236\u53f0\uff08SQL \u6a21\u5f0f\u4e0b\u4f7f\u7528\uff09', 'Clear console output (use in SQL mode)') },
      { label: ':clearcommand', detail: this._t('\u6e05\u7a7a\u547d\u4ee4\u5386\u53f2\uff08SQL \u6a21\u5f0f\u4e0b\u4f7f\u7528\uff09', 'Clear command history (use in SQL mode)') },
      { label: ':clearhistory', detail: this._t('\u6e05\u7a7a SQL \u5386\u53f2\uff08\u53ef\u9009 all\uff09', 'Clear SQL history (optional all)') },
      { label: ':reset', detail: this._t('\u91cd\u7f6e\u63a7\u5236\u53f0\u5230\u521d\u59cb\u72b6\u6001\uff08SQL \u6a21\u5f0f\u4e0b\u4f7f\u7528\uff09', 'Reset console to initial state (use in SQL mode)') },
      { label: ':help', detail: this._t('\u663e\u793a\u6269\u5c55\u547d\u4ee4\u5e2e\u52a9', 'Show extended command help') },
      { label: ':explain', detail: this._t('\u5728 console \u4e2d\u67e5\u770b\u6267\u884c\u8ba1\u5212', 'Explain last SQL in console') },
      { label: ':explain panel', detail: this._t('\u5728 Explain \u9762\u677f\u4e2d\u67e5\u770b\u6267\u884c\u8ba1\u5212', 'Explain last SQL in Explain panel') },
      { label: ':history', detail: this._t('\u4ece\u67e5\u8be2\u5386\u53f2\u63d2\u5165 SQL', 'Insert SQL from query history') },
      { label: ':history run', detail: this._t('\u4ece\u67e5\u8be2\u5386\u53f2\u9009\u62e9\u5e76\u6267\u884c SQL', 'Execute SQL selected from query history') },
      { label: ':history clear', detail: this._t('\u6e05\u7a7a\u5f53\u524d\u8fde\u63a5\u7684 SQL \u5386\u53f2', 'Clear SQL history in current scope') },
      { label: ':history clear all', detail: this._t('\u6e05\u7a7a\u6240\u6709 SQL \u5386\u53f2', 'Clear all SQL history') },
      { label: ':favorites', detail: this._t('\u4ece\u6536\u85cf\u5217\u8868\u63d2\u5165 SQL', 'Insert SQL from favorite queries') },
      { label: ':favorites run', detail: this._t('\u4ece\u6536\u85cf\u5217\u8868\u9009\u62e9\u5e76\u6267\u884c SQL', 'Execute SQL selected from favorite queries') },
      { label: ':favorite', detail: this._t('\u6536\u85cf/\u53d6\u6d88\u6536\u85cf SQL', 'Toggle favorite for SQL') },
      { label: ':search', detail: this._t('\u5bf9\u8c61\u641c\u7d22\u5e76\u63d2\u5165 SQL', 'Search objects and insert SQL') }
    ];
  }

  private _getStartupHintLine(): string {
    return this._t(
      "\u8f93\u5165 'sql' \u8fdb\u5165 SQL \u6a21\u5f0f\uff0c\u666e\u901a\u6a21\u5f0f\u4e0b\u4f7f\u7528 'clear'/'clearcommand'/'reset'/'relation'/'help'\uff0cSQL \u6a21\u5f0f\u4e0b\u4f7f\u7528 ':exit' / ':clear' / ':clearcommand' / ':clearhistory' / ':reset' / ':help'\u3002",
      "Type 'sql' to enter SQL mode. In normal mode use 'clear'/'clearcommand'/'reset'/'relation'/'help'; in SQL mode use ':exit' / ':clear' / ':clearcommand' / ':clearhistory' / ':reset' / ':help'."
    );
  }

  private _insertSqlIntoInput(sql: string): void {
    this._panel.webview.postMessage({
      command: 'setInputText',
      text: sql
    });
  }

  private _resetConsole(): void {
    this._isSqlMode = false;
    this._lastExecutedSql = undefined;
    this._clearHistory();
    this._addLine(
      'info',
      this._t(
        '\u6b22\u8fce\u4f7f\u7528 MiniDB SQL \u63a7\u5236\u53f0',
        'Welcome to MiniDB SQL Console'
      )
    );
    if (this._database) {
      this._addLine(
        'info',
        this._t(
          `\u5df2\u8fde\u63a5\u5230\u6570\u636e\u5e93: ${this._database}`,
          `Connected to database: ${this._database}`
        )
      );
    }
    this._addLine('info', this._getStartupHintLine());
  }

  private async _executeProviderSql(sql: string): Promise<QueryResult> {
    if (!this._executeSqlCallback) {
      throw new Error(this._t('\u6ca1\u6709\u6570\u636e\u5e93\u8fde\u63a5\u3002\u8bf7\u5148\u8fde\u63a5\u3002', 'No database connection. Please connect first.'));
    }

    const result = await this._executeSqlCallback(sql);
    if ('error' in result) {
      throw new Error(result.error);
    }
    return result as QueryResult;
  }

  private _getHistoryEntries(limit: number = 100): Array<{
    sql: string;
    connectionId?: string;
    database?: string;
    updatedAt: number;
    favorite: boolean;
  }> {
    const scoped = this._queryHistoryManager.getRecent(this._connectionId, this._database, limit) as Array<{
      sql: string;
      connectionId?: string;
      database?: string;
      updatedAt: number;
      favorite: boolean;
    }>;
    if (scoped.length > 0) {
      return scoped;
    }
    return this._queryHistoryManager.getRecent(undefined, undefined, limit) as Array<{
      sql: string;
      connectionId?: string;
      database?: string;
      updatedAt: number;
      favorite: boolean;
    }>;
  }

  private _getFavoriteEntries(limit: number = 100): Array<{
    sql: string;
    connectionId?: string;
    database?: string;
    updatedAt: number;
    favorite: boolean;
  }> {
    const scoped = this._queryHistoryManager.getFavorites(this._connectionId, this._database, limit) as Array<{
      sql: string;
      connectionId?: string;
      database?: string;
      updatedAt: number;
      favorite: boolean;
    }>;
    if (scoped.length > 0) {
      return scoped;
    }
    return this._queryHistoryManager.getFavorites(undefined, undefined, limit) as Array<{
      sql: string;
      connectionId?: string;
      database?: string;
      updatedAt: number;
      favorite: boolean;
    }>;
  }

  private _filterEntriesByKeyword<T extends { sql: string }>(entries: T[], keyword: string): T[] {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }
    return entries.filter(entry => entry.sql.toLowerCase().includes(normalized));
  }

  private async _pickSqlEntry(
    entries: Array<{
      sql: string;
      connectionId?: string;
      database?: string;
      updatedAt: number;
      favorite: boolean;
    }>,
    placeholder: string
  ): Promise<string | undefined> {
    const picks = entries.map(entry => {
      const firstLine = entry.sql.split(/\r?\n/)[0].slice(0, 120);
      const contextInfo = [entry.connectionId, entry.database].filter(Boolean).join(' / ');
      const timeText = new Date(entry.updatedAt).toLocaleString();
      return {
        label: `${entry.favorite ? '$(star-full) ' : ''}${firstLine}`,
        description: `${contextInfo || this._t('\u5168\u5c40', 'Global')} | ${timeText}`,
        detail: entry.sql,
        sql: entry.sql
      };
    });

    const selected = await vscode.window.showQuickPick(picks, { placeHolder: placeholder });
    return selected?.sql;
  }

  private async _runExplainCommand(sqlText: string, showPanel: boolean): Promise<void> {
    const targetSql = sqlText.trim() || this._lastExecutedSql || '';
    if (!targetSql) {
      this._addLine(
        'warning',
        this._t(
          '\u6ca1\u6709\u53ef\u89e3\u91ca\u7684 SQL\uff0c\u8bf7\u5148\u6267\u884c\u6216\u63d0\u4f9b SQL\u3002',
          'No SQL available for explain. Execute or provide SQL first.'
        )
      );
      return;
    }

    try {
      let explainSql = '';
      let result: QueryResult;

      switch (this._dbType) {
        case 'oracle':
          explainSql = `EXPLAIN PLAN FOR ${targetSql}`;
          await this._executeProviderSql(explainSql);
          explainSql = 'SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())';
          result = await this._executeProviderSql(explainSql);
          break;
        case 'sqlserver':
          explainSql = `SET SHOWPLAN_TEXT ON; ${targetSql}; SET SHOWPLAN_TEXT OFF;`;
          result = await this._executeProviderSql(explainSql);
          break;
        default:
          explainSql = `EXPLAIN ${targetSql}`;
          result = await this._executeProviderSql(explainSql);
          break;
      }

      if (showPanel) {
        const panel = ExplainPlanPanel.createOrShow(this._extensionUri);
        panel.updatePlan(targetSql, explainSql, this._dbType, result);
        this._addLine('success', this._t('\u6267\u884c\u8ba1\u5212\u5df2\u5728\u9762\u677f\u4e2d\u6253\u5f00\u3002', 'Execution plan opened in panel.'));
      } else {
        this._addLine(
          'success',
          this._t(
            `\u6267\u884c\u8ba1\u5212\u5b8c\u6210 (${result.rowCount} \u884c, ${result.executionTime}ms)`,
            `Explain completed (${result.rowCount} rows, ${result.executionTime}ms)`
          )
        );
        await this._addTable(result, explainSql);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._addLine('error', `${this._t('\u9519\u8bef', 'Error')}: ${message}`);
      if (showPanel) {
        const panel = ExplainPlanPanel.createOrShow(this._extensionUri);
        panel.showError(targetSql, message);
      }
    }
  }

  private async _openRelationPanel(): Promise<void> {
    if (!this._connectionId || !this._database) {
      this._addLine(
        'warning',
        this._t(
          '\u7f3a\u5c11\u5f53\u524d\u8fde\u63a5\u6216\u6570\u636e\u5e93\u4e0a\u4e0b\u6587\uff0c\u65e0\u6cd5\u6253\u5f00\u5173\u7cfb\u9762\u677f\u3002',
          'Missing active connection/database context. Unable to open relation panel.'
        )
      );
      return;
    }

    try {
      await vscode.commands.executeCommand('minidb.viewTableRelations', {
        connectionId: this._connectionId,
        databaseName: this._database
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._addLine(
        'error',
        `${this._t('\u6253\u5f00\u5173\u7cfb\u9762\u677f\u5931\u8d25', 'Failed to open relation panel')}: ${message}`
      );
    }
  }

  private async _handleHistoryCommand(args: string[]): Promise<void> {
    const action = (args[0] || '').toLowerCase();
    const isClearCommand =
      action === 'clear' &&
      (args.length === 1 || (args.length === 2 && (args[1] || '').toLowerCase() === 'all'));
    if (isClearCommand) {
      const clearAll = (args[1] || '').toLowerCase() === 'all';
      const removed = await this._queryHistoryManager.clearHistory(
        clearAll ? undefined : this._connectionId,
        clearAll ? undefined : this._database,
        true
      );

      if (removed > 0) {
        this._addLine(
          'success',
          this._t(
            clearAll
              ? `\u5df2\u6e05\u7a7a SQL \u5386\u53f2\uff0c\u5171 ${removed} \u6761\u3002`
              : `\u5df2\u6e05\u7a7a\u5f53\u524d\u8fde\u63a5\u7684 SQL \u5386\u53f2\uff0c\u5171 ${removed} \u6761\u3002`,
            clearAll
              ? `Cleared SQL history. Removed ${removed} entries.`
              : `Cleared SQL history in current scope. Removed ${removed} entries.`
          )
        );
      } else {
        this._addLine(
          'info',
          this._t(
            clearAll
              ? '\u6ca1\u6709\u53ef\u6e05\u7a7a\u7684 SQL \u5386\u53f2\u3002'
              : '\u5f53\u524d\u8fde\u63a5\u6ca1\u6709\u53ef\u6e05\u7a7a\u7684 SQL \u5386\u53f2\u3002',
            clearAll
              ? 'No SQL history to clear.'
              : 'No SQL history to clear in current scope.'
          )
        );
      }
      return;
    }

    const runMode = (args[0] || '').toLowerCase() === 'run';
    const keyword = (runMode ? args.slice(1) : args).join(' ').trim();
    const entries = this._filterEntriesByKeyword(this._getHistoryEntries(), keyword);

    if (entries.length === 0) {
      this._addLine('info', this._t('\u6ca1\u6709\u5339\u914d\u7684\u67e5\u8be2\u5386\u53f2\u3002', 'No matching query history.'));
      return;
    }

    const selectedSql = await this._pickSqlEntry(
      entries,
      this._t('\u9009\u62e9\u4e00\u6761\u5386\u53f2 SQL', 'Select a query from history')
    );
    if (!selectedSql) {
      return;
    }

    if (runMode) {
      await this._executeSql(selectedSql);
      return;
    }

    this._insertSqlIntoInput(selectedSql);
    this._addLine('info', this._t('\u5df2\u63d2\u5165\u5386\u53f2 SQL \u5230\u8f93\u5165\u6846\u3002', 'Inserted history SQL into input.'));
  }

  private async _handleFavoritesCommand(args: string[]): Promise<void> {
    const runMode = (args[0] || '').toLowerCase() === 'run';
    const keyword = (runMode ? args.slice(1) : args).join(' ').trim();
    const entries = this._filterEntriesByKeyword(this._getFavoriteEntries(), keyword);

    if (entries.length === 0) {
      this._addLine('info', this._t('\u6ca1\u6709\u5339\u914d\u7684\u6536\u85cf SQL\u3002', 'No matching favorite queries.'));
      return;
    }

    const selectedSql = await this._pickSqlEntry(
      entries,
      this._t('\u9009\u62e9\u4e00\u6761\u6536\u85cf SQL', 'Select a favorite query')
    );
    if (!selectedSql) {
      return;
    }

    if (runMode) {
      await this._executeSql(selectedSql);
      return;
    }

    this._insertSqlIntoInput(selectedSql);
    this._addLine('info', this._t('\u5df2\u63d2\u5165\u6536\u85cf SQL \u5230\u8f93\u5165\u6846\u3002', 'Inserted favorite SQL into input.'));
  }

  private async _handleFavoriteCommand(args: string[]): Promise<void> {
    const sql = args.join(' ').trim() || this._lastExecutedSql || '';
    if (!sql) {
      this._addLine(
        'warning',
        this._t(
          '\u6ca1\u6709\u53ef\u6536\u85cf\u7684 SQL\uff0c\u8bf7\u5148\u6267\u884c\u6216\u63d0\u4f9b SQL\u3002',
          'No SQL available to favorite. Execute or provide SQL first.'
        )
      );
      return;
    }

    const nowFavorite = await this._queryHistoryManager.toggleFavorite(this._connectionId, this._database, sql);
    this._addLine(
      'success',
      nowFavorite
        ? this._t('\u5df2\u6dfb\u52a0\u5230\u6536\u85cf\u67e5\u8be2\u3002', 'Added to favorite queries.')
        : this._t('\u5df2\u4ece\u6536\u85cf\u67e5\u8be2\u79fb\u9664\u3002', 'Removed from favorite queries.')
    );
  }

  private async _handleSearchCommand(args: string[]): Promise<void> {
    let keyword = args.join(' ').trim();
    if (!keyword) {
      const input = await vscode.window.showInputBox({
        prompt: this._t('\u641c\u7d22\u8868/\u89c6\u56fe/\u5217\u540d', 'Search table/view/column name'),
        placeHolder: this._t('\u4f8b\u5982: user, order_id, logs', 'e.g. user, order_id, logs')
      });
      if (input === undefined) {
        return;
      }
      keyword = input.trim();
    }

    await this._loadMetadata();
    if (this._metadata.length === 0) {
      this._addLine('warning', this._t('\u5f53\u524d\u8fde\u63a5\u6ca1\u6709\u53ef\u641c\u7d22\u7684\u5bf9\u8c61\u3002', 'No searchable objects in current connection.'));
      return;
    }

    const normalized = keyword.toLowerCase();
    type SearchPick = vscode.QuickPickItem & {
      objectKind: 'table' | 'column';
      tableName: string;
      columnName?: string;
    };
    const picks: SearchPick[] = [];

    for (const table of this._metadata) {
      if (!normalized || table.name.toLowerCase().includes(normalized)) {
        picks.push({
          label: `$(table) ${table.name}`,
          description: this._t('\u8868', 'Table'),
          objectKind: 'table',
          tableName: table.name
        });
      }

      for (const column of table.columns) {
        const fullName = `${table.name}.${column.name}`;
        if (
          !normalized ||
          table.name.toLowerCase().includes(normalized) ||
          column.name.toLowerCase().includes(normalized) ||
          fullName.toLowerCase().includes(normalized)
        ) {
          picks.push({
            label: `$(symbol-field) ${fullName}`,
            description: column.type,
            objectKind: 'column',
            tableName: table.name,
            columnName: column.name
          });
        }
      }
    }

    if (picks.length === 0) {
      this._addLine('info', this._t('\u672a\u627e\u5230\u5339\u914d\u5bf9\u8c61\u3002', 'No matching objects found.'));
      return;
    }

    const selected = await vscode.window.showQuickPick(picks, {
      placeHolder: this._t('\u9009\u62e9\u5bf9\u8c61\u4ee5\u751f\u6210 SQL', 'Select object to build SQL')
    });

    if (!selected) {
      return;
    }

    let sql: string;
    if (selected.objectKind === 'column' && selected.columnName) {
      sql = `${SqlEscape.buildSelectQuery(selected.tableName, this._dbType, {
        columns: [selected.columnName],
        limit: 100
      })};`;
    } else {
      sql = `${SqlEscape.buildSelectQuery(selected.tableName, this._dbType, { limit: 100 })};`;
    }

    this._insertSqlIntoInput(sql);
    this._addLine('info', this._t('\u5df2\u63d2\u5165\u5bf9\u8c61\u67e5\u8be2 SQL \u5230\u8f93\u5165\u6846\u3002', 'Inserted object search SQL into input.'));
  }
  private async _handleColonCommand(text: string): Promise<boolean> {
    const raw = text.slice(1).trim();
    if (!raw) {
      this._addLine('warning', this._t('\u8bf7\u8f93\u5165\u547d\u4ee4\uff0c\u4f8b\u5982 :help\u3002', 'Please provide a command, e.g. :help.'));
      return true;
    }

    const parts = raw.split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);

    if (name === 'help') {
      this._showHelp();
      return true;
    }

    if (name === 'clear') {
      this._clearHistory();
      this._addLine('info', this._t('\u63a7\u5236\u53f0\u5df2\u6e05\u7a7a\u3002', 'Console cleared.'));
      return true;
    }

    if (name === 'clearcommand') {
      this._clearCommandHistory();
      this._addLine('info', this._t('\u547d\u4ee4\u5386\u53f2\u5df2\u6e05\u7a7a\u3002', 'Command history cleared.'));
      return true;
    }

    if (name === 'reset') {
      this._resetConsole();
      return true;
    }

    if (name === 'clearhistory') {
      const arg = (args[0] || '').toLowerCase();
      if (args.length > 1 || (args.length === 1 && arg !== 'all')) {
        this._addLine('warning', this._t('\u7528\u6cd5: :clearhistory [all]', 'Usage: :clearhistory [all]'));
        return true;
      }
      await this._handleHistoryCommand(arg === 'all' ? ['clear', 'all'] : ['clear']);
      return true;
    }

    if (name === 'exit') {
      if (!this._isSqlMode) {
        this._addLine('info', this._t('\u5f53\u524d\u4e0d\u5728 SQL \u6a21\u5f0f\u3002', 'Not in SQL mode.'));
        return true;
      }
      this._isSqlMode = false;
      this._addLine('info', this._t('\u5df2\u9000\u51fa SQL \u6a21\u5f0f\u3002', 'Exited SQL mode.'));
      return true;
    }

    if (name === 'explain') {
      const showPanel = (args[0] || '').toLowerCase() === 'panel';
      const sqlText = (showPanel ? args.slice(1) : args).join(' ').trim();
      await this._runExplainCommand(sqlText, showPanel);
      return true;
    }

    if (name === 'history') {
      await this._handleHistoryCommand(args);
      return true;
    }

    if (name === 'favorites') {
      await this._handleFavoritesCommand(args);
      return true;
    }

    if (name === 'favorite') {
      await this._handleFavoriteCommand(args);
      return true;
    }

    if (name === 'search') {
      await this._handleSearchCommand(args);
      return true;
    }

    this._addLine('error', this._t(`\u672a\u77e5\u547d\u4ee4: :${name}`, `Unknown command: :${name}`));
    return true;
  }
  private _loadCommandHistory(): void {
    const historyKey = 'sqlConsole.commandHistory';
    const savedHistory = this._extensionContext.globalState.get<string[]>(historyKey);
    if (savedHistory && Array.isArray(savedHistory)) {
      this._commandHistory = savedHistory;
    }
  }

  private _saveCommandHistory(): void {
    const historyKey = 'sqlConsole.commandHistory';
    this._extensionContext.globalState.update(historyKey, this._commandHistory);
  }

  private _addToCommandHistory(command: string): void {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }
    const existingIndex = this._commandHistory.indexOf(trimmedCommand);
    if (existingIndex !== -1) {
      this._commandHistory.splice(existingIndex, 1);
    }
    this._commandHistory.unshift(trimmedCommand);
    if (this._commandHistory.length > MAX_COMMAND_HISTORY) {
      this._commandHistory = this._commandHistory.slice(0, MAX_COMMAND_HISTORY);
    }
    this._saveCommandHistory();
    this._panel.webview.postMessage({
      command: 'commandHistory',
      history: this._getCommandHistory()
    });
  }

  private _getCommandHistory(): string[] {
    return [...this._commandHistory];
  }

  private async _handleGoToPage(tableId: string, page: number): Promise<void> {
    const state = this._tableStates.get(tableId);
    if (!state || !this._executeSqlCallback) {
      return;
    }

    const newPage = parseInt(String(page));
    if (newPage < 1 || newPage > state.totalPages) {
      return;
    }

    state.currentPage = newPage;
    state.isLoading = true;
    this._updateWebview();

    const offset = (state.currentPage - 1) * state.pageSize;
    const paginatedSql = SqlEscape.buildPaginatedQuery(state.sql, this._dbType, state.pageSize, offset);

    try {
      const result = await this._executeSqlCallback(paginatedSql);
      
      if ('error' in result) {
        this._addLine('error', `Pagination error: ${result.error}`);
      } else {
        state.currentRows = result.rows;
        state.columns = result.columns;
      }
    } catch (error) {
      this._addLine('error', `Pagination error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.isLoading = false;
      this._updateWebview();
    }
  }

  private async _handleChangePageSize(tableId: string, pageSize: number): Promise<void> {
    const state = this._tableStates.get(tableId);
    if (!state || !this._executeSqlCallback) {
      return;
    }

    state.pageSize = parseInt(String(pageSize));
    state.currentPage = 1;
    state.totalPages = Math.ceil(state.totalRows / state.pageSize) || 1;
    state.isLoading = true;
    this._updateWebview();

    const offset = 0;
    const paginatedSql = SqlEscape.buildPaginatedQuery(state.sql, this._dbType, state.pageSize, offset);

    try {
      const result = await this._executeSqlCallback(paginatedSql);
      
      if ('error' in result) {
        this._addLine('error', `Pagination error: ${result.error}`);
      } else {
        state.currentRows = result.rows;
        state.columns = result.columns;
      }
    } catch (error) {
      this._addLine('error', `Pagination error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      state.isLoading = false;
      this._updateWebview();
    }
  }

  private async _handleInput(text: string) {
    const trimmedText = text.trim();
    
    if (!trimmedText) {
      return;
    }

    this._addToCommandHistory(trimmedText);
    this._addLine('input', `${this._isSqlMode ? 'sql> ' : '> '}${trimmedText}`);

    if (trimmedText.startsWith(':')) {
      await this._handleColonCommand(trimmedText);
      this._updateWebview();
      return;
    }

    if (!this._isSqlMode) {
      if (trimmedText.toLowerCase() === 'sql') {
        this._isSqlMode = true;
        this._addLine(
          'info',
          this._t(
            '\u5df2\u8fdb\u5165 SQL \u6a21\u5f0f\u3002\u8f93\u5165 SQL \u8bed\u53e5\u540e\u6309 Enter \u6267\u884c\u3002',
            'Entered SQL mode. Type SQL statements and press Enter to execute.'
          )
        );
        this._addLine(
          'info',
          this._t(
            '\u5728 SQL \u6a21\u5f0f\u4e0b\uff0c\u8bf7\u4f7f\u7528 :exit / :clear / :clearcommand / :clearhistory / :reset / :help \u7b49\u547d\u4ee4\u3002',
            'In SQL mode, use commands like :exit / :clear / :clearcommand / :clearhistory / :reset / :help.'
          )
        );
      } else if (trimmedText.toLowerCase() === 'clear') {
        this._clearHistory();
        this._addLine('info', this._t('\u63a7\u5236\u53f0\u5df2\u6e05\u7a7a\u3002', 'Console cleared.'));
      } else if (trimmedText.toLowerCase() === 'clearcommand') {
        this._clearCommandHistory();
        this._addLine('info', this._t('\u547d\u4ee4\u5386\u53f2\u5df2\u6e05\u7a7a\u3002', 'Command history cleared.'));
      } else if (trimmedText.toLowerCase() === 'reset') {
        this._resetConsole();
      } else if (trimmedText.toLowerCase() === 'relation') {
        await this._openRelationPanel();
      } else if (trimmedText.toLowerCase() === 'help') {
        this._showHelp();
      } else {
        this._addLine(
          'error',
          this._t(
            '\u672a\u77e5\u547d\u4ee4\u3002\u8f93\u5165 \"help\" \u67e5\u770b\u53ef\u7528\u547d\u4ee4\u3002',
            'Unknown command. Type \"help\" for available commands.'
          )
        );
      }
    } else {
      const lower = trimmedText.toLowerCase();
      if (lower === 'exit' || lower === 'clear' || lower === 'clearcommand' || lower === 'clearhistory' || lower === 'reset' || lower === 'help') {
        this._addLine(
          'warning',
          this._t(
            `SQL \u6a21\u5f0f\u4e0b\u8bf7\u4f7f\u7528 :${lower} \u547d\u4ee4\u3002`,
            `In SQL mode, use :${lower}.`
          )
        );
      } else if (lower === 'relation') {
        this._addLine(
          'warning',
          this._t(
            'relation \u547d\u4ee4\u4ec5\u5728\u666e\u901a\u6a21\u5f0f\u4e0b\u53ef\u7528\uff0c\u8bf7\u5148\u8f93\u5165 :exit\u3002',
            'The relation command is only available in normal mode. Use :exit first.'
          )
        );
      } else if (lower === 'sql') {
        this._addLine('info', this._t('\u5f53\u524d\u5df2\u5728 SQL \u6a21\u5f0f\u3002', 'Already in SQL mode.'));
      } else {
        await this._executeSql(trimmedText);
      }
    }

    this._updateWebview();
  }

  private _handleGetCommandHistory(): void {
    this._panel.webview.postMessage({
      command: 'commandHistory',
      history: this._getCommandHistory()
    });
  }

  private async _executeSql(sql: string) {
    if (!this._executeSqlCallback) {
      this._addLine(
        'error',
        this._t(
          '\u6ca1\u6709\u6570\u636e\u5e93\u8fde\u63a5\u3002\u8bf7\u5148\u8fde\u63a5\u3002',
          'No database connection. Please connect first.'
        )
      );
      return;
    }

    const normalizedSql = sql.trim();
    if (!normalizedSql) {
      return;
    }

    this._lastExecutedSql = normalizedSql;
    await this._queryHistoryManager
      .addQuery(this._connectionId, this._database, normalizedSql)
      .catch(() => undefined);

    this._addLine('info', this._t('\u6b63\u5728\u6267\u884c...', 'Executing...'));

    const isSelectQuery = /^\s*SELECT\s/i.test(normalizedSql);
    
    try {
      let result;
      
      if (isSelectQuery) {
        const countSql = SqlEscape.buildCountQuery(normalizedSql, this._dbType);
        const countResult = await this._executeSqlCallback(countSql);
        
        let totalRows: number | undefined;
        if (!('error' in countResult)) {
          totalRows = extractTotalRows(countResult);
        }
        
        const paginatedSql = SqlEscape.buildPaginatedQuery(normalizedSql, this._dbType, DEFAULT_PAGE_SIZE, 0);
        result = await this._executeSqlCallback(paginatedSql);
        
        if (!('error' in result)) {
          result.rowCount = totalRows ?? result.rowCount;
        }
      } else {
        result = await this._executeSqlCallback(normalizedSql);
      }
      
      if ('error' in result) {
        this._addLine('error', `${this._t('\u9519\u8bef', 'Error')}: ${result.error}`);
      } else {
        if (isSelectQuery) {
          if (result.rowCount === 0) {
            this._addLine(
              'warning',
              this._t(`\u67e5\u8be2\u6210\u529f - \u65e0\u6570\u636e (${result.executionTime}ms)`, `Query OK - No data (${result.executionTime}ms)`)
            );
          } else {
            this._addLine(
              'success',
              this._t(
                `\u67e5\u8be2\u6210\u529f (${result.rowCount} \u884c\u8fd4\u56de, ${result.executionTime}ms)`,
                `Query OK (${result.rowCount} rows returned, ${result.executionTime}ms)`
              )
            );
            await this._addTable(result as QueryResult, normalizedSql);
          }
        } else {
          this._addLine('success', this._t(`\u67e5\u8be2\u6210\u529f (${result.executionTime}ms)`, `Query OK (${result.executionTime}ms)`));
        }
      }
    } catch (error) {
      this._addLine('error', `${this._t('\u9519\u8bef', 'Error')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private _showHelp() {
    const helpPanel: HelpPanelData = {
      title: this._t('MiniDB \u63a7\u5236\u53f0\u547d\u4ee4', 'MiniDB Console Commands'),
      commands: [
        { command: 'sql', description: this._t('\u8fdb\u5165 SQL \u6a21\u5f0f\u6267\u884c SQL \u8bed\u53e5', 'Enter SQL mode to execute SQL statements') },
        { command: 'clear', description: this._t('\u6e05\u7a7a\u63a7\u5236\u53f0', 'Clear the console') },
        { command: 'clearcommand', description: this._t('\u6e05\u7a7a\u547d\u4ee4\u5386\u53f2\uff08\u6301\u4e45\u5316\uff09', 'Clear command history (persisted)') },
        { command: 'reset', description: this._t('\u91cd\u7f6e\u63a7\u5236\u53f0\u5230\u521d\u59cb\u72b6\u6001', 'Reset console to initial state') },
        { command: 'relation', description: this._t('\u6253\u5f00\u6570\u636e\u5e93\u8868\u5173\u7cfb\u9762\u677f', 'Open table relation panel') },
        { command: 'help', description: this._t('\u663e\u793a\u8fd9\u6761\u5e2e\u52a9\u4fe1\u606f', 'Show this help message') },
        { command: ':exit', description: this._t('\u9000\u51fa SQL \u6a21\u5f0f\uff08SQL \u6a21\u5f0f\u4e0b\uff09', 'Exit SQL mode (in SQL mode)') },
        { command: ':clear', description: this._t('\u6e05\u7a7a\u63a7\u5236\u53f0\uff08SQL \u6a21\u5f0f\u4e0b\uff09', 'Clear console (in SQL mode)') },
        { command: ':clearcommand', description: this._t('\u6e05\u7a7a\u547d\u4ee4\u5386\u53f2\uff08SQL \u6a21\u5f0f\u4e0b\uff09', 'Clear command history (in SQL mode)') },
        { command: ':clearhistory [all]', description: this._t('\u6e05\u7a7a SQL \u5386\u53f2\uff08\u5f53\u524d\u8fde\u63a5/all\uff09', 'Clear SQL history (current scope/all)') },
        { command: ':reset', description: this._t('\u91cd\u7f6e\u63a7\u5236\u53f0\u5230\u521d\u59cb\u72b6\u6001', 'Reset console to initial state') },
        { command: ':help', description: this._t('\u663e\u793a\u6269\u5c55\u547d\u4ee4\u5e2e\u52a9', 'Show extended command help') },
        { command: ':explain [panel] [sql]', description: this._t('\u67e5\u770b\u6267\u884c\u8ba1\u5212\uff08console/panel\uff09', 'Explain SQL in console or panel') },
        { command: ':history [run] [keyword]', description: this._t('\u67e5\u8be2\u5386\u53f2\uff08\u9ed8\u8ba4\u63d2\u5165\uff0crun \u6267\u884c\uff09', 'Query history (insert by default, run to execute)') },
        { command: ':history clear [all]', description: this._t('\u6e05\u7a7a SQL \u5386\u53f2\uff08\u517c\u5bb9\u522b\u540d\uff09', 'Clear SQL history (compat alias)') },
        { command: ':favorites [run] [keyword]', description: this._t('\u6536\u85cf\u5217\u8868\uff08\u9ed8\u8ba4\u63d2\u5165\uff0crun \u6267\u884c\uff09', 'Favorites (insert by default, run to execute)') },
        { command: ':favorite [sql]', description: this._t('\u6536\u85cf/\u53d6\u6d88\u6536\u85cf SQL', 'Toggle favorite for SQL') },
        { command: ':search [keyword]', description: this._t('\u5bf9\u8c61\u641c\u7d22\u5e76\u63d2\u5165 SQL', 'Search objects and insert SQL') }
      ]
    };
    this._history.push({ type: 'helpPanel', helpPanel });
    this._updateWebview();
  }

  private _clearHistory(): void {
    this._history = [];
    this._tableStates.clear();
    this._tableCounter = 0;
    this._updateWebview();
  }

  private _clearCommandHistory(): void {
    this._commandHistory = [];
    this._saveCommandHistory();
    this._panel.webview.postMessage({
      command: 'commandHistory',
      history: []
    });
  }

  private async _loadMetadata(): Promise<void> {
    if (this._metadataLoaded || !this._connectionId || !this._database || !this._connectionManager) {
      return;
    }

    try {
      const provider = this._connectionManager.getProvider(this._connectionId);
      
      if (!provider || !provider.isConnected()) {
        return;
      }

      const tables = await provider.getTables(this._database);
      this._metadata = [];

      for (const table of tables) {
        const columns = await provider.getTableColumns(this._database, table.name);
        this._metadata.push({
          name: table.name,
          columns: columns.map((c: { name: string; type: string }) => ({ name: c.name, type: c.type }))
        });
      }

      this._metadataLoaded = true;
      this._panel.webview.postMessage({
        command: 'metadata',
        tables: this._metadata
      });
    } catch (error) {
      console.error('Failed to load metadata:', error);
    }
  }

  private async _handleGetCompletions(text: string, position: number): Promise<void> {
    const completions = this._getCompletions(text, position);
    this._panel.webview.postMessage({
      command: 'completions',
      items: completions
    });
  }

  private _getCompletions(text: string, position: number): CompletionItem[] {
    const items: CompletionItem[] = [];
    const textBeforeCursor = text.substring(0, position);
    const trimmedBeforeCursor = textBeforeCursor.trimStart();
    const explainPrefixMatch = textBeforeCursor.match(/^\s*:explain(?:\s+panel)?\s+/i);
    const isExplainSqlContext = Boolean(explainPrefixMatch);
    const completionText = isExplainSqlContext && explainPrefixMatch
      ? textBeforeCursor.slice(explainPrefixMatch[0].length)
      : textBeforeCursor;
    const words = completionText.split(/\s+/);
    const currentWord = words[words.length - 1] || '';
    const isExtendedCommandContext = trimmedBeforeCursor.startsWith(':');

    if ((!this._isSqlMode && !isExplainSqlContext) || (isExtendedCommandContext && !isExplainSqlContext)) {
      const filter = currentWord.toLowerCase();
      const source = this._getConsoleCommandSuggestions().filter(cmd =>
        !isExtendedCommandContext || cmd.label.startsWith(':')
      );

      source.forEach(cmd => {
        const labelLower = cmd.label.toLowerCase();
        const matched = filter.length === 0
          || labelLower.startsWith(filter)
          || (isExtendedCommandContext && labelLower.startsWith(`:${filter}`));

        if (matched) {
          items.push({
            label: cmd.label,
            kind: 'keyword',
            detail: cmd.detail
          });
        }
      });
      return items;
    }

    const upperText = completionText.toUpperCase();
    const afterFrom = /\bFROM\s*$/i.test(upperText) || /\bFROM\s+\w*$/i.test(upperText);
    const afterJoin = /\bJOIN\s*$/i.test(upperText) || /\bJOIN\s+\w*$/i.test(upperText);
    const afterSelect = /\bSELECT\s*$/i.test(upperText) || /\bSELECT\s+[\w\s,]*$/i.test(upperText);
    const afterWhere = /\bWHERE\s*$/i.test(upperText) || /\bWHERE\s+\w*$/i.test(upperText);
    const afterOrderBy = /\bORDER\s+BY\s*$/i.test(upperText) || /\bORDER\s+BY\s+\w*$/i.test(upperText);
    const afterInsert = /\bINSERT\s+INTO\s*$/i.test(upperText) || /\bINSERT\s+INTO\s+\w*$/i.test(upperText);
    const afterUpdate = /\bUPDATE\s*$/i.test(upperText) || /\bUPDATE\s+\w*$/i.test(upperText);
    const afterSet = /\bSET\s*$/i.test(upperText) || /\bSET\s+\w*$/i.test(upperText);

    const expectingTable = afterFrom || afterJoin || afterUpdate || afterInsert;
    const expectingColumn = afterSelect || afterWhere || afterOrderBy || afterSet;

    if (expectingTable && this._metadata.length > 0) {
      this._metadata.forEach(table => {
        items.push({
          label: table.name,
          kind: 'table',
          detail: `Table (${table.columns.length} columns)`
        });
      });
    }

    if (expectingColumn && this._metadata.length > 0) {
      const tableMatch = completionText.match(/(?:FROM|JOIN|UPDATE)\s+(\w+)/i);
      if (tableMatch) {
        const tableName = tableMatch[1];
        const table = this._metadata.find(t => t.name.toLowerCase() === tableName.toLowerCase());
        if (table) {
          table.columns.forEach(col => {
            items.push({
              label: col.name,
              kind: 'column',
              detail: `Column (${col.type})`
            });
          });
        }
      } else {
        this._metadata.forEach(table => {
          table.columns.forEach(col => {
            items.push({
              label: `${table.name}.${col.name}`,
              kind: 'column',
              detail: `Column (${col.type})`
            });
          });
        });
      }
    }

    if (currentWord.includes('.') && this._metadata.length > 0) {
      const parts = currentWord.split('.');
      const tableName = parts[0];
      const table = this._metadata.find(t => t.name.toLowerCase() === tableName.toLowerCase());
      if (table) {
        table.columns.forEach(col => {
          items.push({
            label: col.name,
            kind: 'column',
            detail: `Column (${col.type})`
          });
        });
      }
    }

    if (items.length === 0) {
      SQL_KEYWORDS.forEach(keyword => {
        items.push({
          label: keyword,
          kind: 'keyword',
          detail: 'SQL Keyword'
        });
      });

      SQL_FUNCTIONS.forEach(func => {
        items.push({
          label: func,
          kind: 'function',
          detail: 'SQL Function'
        });
      });

      SQL_DATA_TYPES.forEach(type => {
        items.push({
          label: type,
          kind: 'dataType',
          detail: 'SQL Data Type'
        });
      });

      if (this._metadata.length > 0) {
        this._metadata.forEach(table => {
          items.push({
            label: table.name,
            kind: 'table',
            detail: `Table (${table.columns.length} columns)`
          });
        });
      }
    }

    const filter = currentWord.toLowerCase();
    return items.filter(item => 
      item.label.toLowerCase().startsWith(filter) || filter.length === 0
    ).slice(0, 50);
  }

  private _updateWebview() {
    const tableStatesJson: Record<string, TableState> = {};
    this._tableStates.forEach((state, id) => {
      tableStatesJson[id] = {
        ...state,
        currentRows: state.currentRows.map(row => {
          const safeRow: Record<string, unknown> = {};
          state.columns.forEach(col => {
            const val = row[col];
            if (val === null) {
              safeRow[col] = null;
            } else if (val === undefined) {
              safeRow[col] = null;
            } else if (typeof val === 'object') {
              try {
                safeRow[col] = JSON.stringify(val);
              } catch {
                safeRow[col] = '[Object]';
              }
            } else {
              safeRow[col] = val;
            }
          });
          return safeRow;
        })
      };
    });

    const historyData = this._history.map(item => ({
      type: item.type,
      line: item.line,
      tableId: item.tableId,
      helpPanel: item.helpPanel
    }));

    this._panel.webview.postMessage({
      command: 'update',
      history: historyData,
      tableStates: tableStatesJson,
      isSqlMode: this._isSqlMode
    });
  }

  private _getHtmlForWebview(): string {
    const s = i18n.strings;
    const p = s.pagination;
    const isSqlMode = this._isSqlMode;
    const nonce = this._getNonce();
    
    const tableStatesJson: Record<string, TableState> = {};
    this._tableStates.forEach((state, id) => {
      tableStatesJson[id] = {
        ...state,
        currentRows: state.currentRows.map(row => {
          const safeRow: Record<string, unknown> = {};
          state.columns.forEach(col => {
            const val = row[col];
            if (val === null) {
              safeRow[col] = null;
            } else if (val === undefined) {
              safeRow[col] = null;
            } else if (typeof val === 'object') {
              try {
                safeRow[col] = JSON.stringify(val);
              } catch {
                safeRow[col] = '[Object]';
              }
            } else {
              safeRow[col] = val;
            }
          });
          return safeRow;
        })
      };
    });

    const historyData = this._history.map(item => ({
      type: item.type,
      line: item.line,
      tableId: item.tableId
    }));

    const historyJson = JSON.stringify(historyData).replace(/</g, '\\x3c').replace(/>/g, '\\x3e');
    const tableStatesJsonStr = JSON.stringify(tableStatesJson).replace(/</g, '\\x3c').replace(/>/g, '\\x3e');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this._panel.webview.cspSource} data:; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src ${this._panel.webview.cspSource} 'nonce-${nonce}' 'unsafe-inline';">
  <title>${s.console.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      background-color: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #cccccc);
      height: 100vh;
      display: flex;
      flex-direction: column;
      font-size: 13px;
    }
    
    .console-container {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      min-height: 100px;
    }
    
    .line {
      padding: 2px 0;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    
    .line.input { color: #4ec9b0; }
    .line.output { color: #dcdcaa; }
    .line.error { color: #f14c4c; }
    .line.success { color: #4fc1ff; }
    .line.warning { color: #cca700; }
    .line.info { color: #608b4e; }

    .help-panel {
      margin: 8px 0 16px 0;
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px;
      overflow: hidden;
      background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
    }

    .help-panel-header {
      padding: 8px 12px;
      font-weight: 600;
      color: #4ec9b0;
      border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
    }

    .help-panel-body {
      padding: 4px 0;
    }

    .help-row {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 4px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, #3a3a3a);
    }

    .help-row:last-child {
      border-bottom: none;
    }

    .help-command {
      min-width: 220px;
      color: #dcdcaa;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      white-space: nowrap;
    }

    .help-desc {
      color: var(--vscode-editor-foreground, #cccccc);
      word-break: break-word;
    }
    
    .timestamp {
      color: #6a9955;
      margin-right: 8px;
      font-size: 11px;
    }
    
    .table-container {
      margin: 8px 0 16px 0;
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px;
    }
    
    .result-table {
      width: 100%;
      border-collapse: collapse;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
    }
    
    .result-table th {
      background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      color: #4ec9b0;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
      white-space: nowrap;
    }
    
    .result-table td {
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
      white-space: pre;
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .result-table tr:last-child td {
      border-bottom: none;
    }
    
    .result-table tr:hover td {
      background: var(--vscode-list-hoverBackground, #2a2d2e);
    }
    
    .result-table .null-value {
      color: var(--vscode-debugConsoleInputPlaceholderForeground, #858585);
      font-style: italic;
    }
    
    .result-table .number-value {
      color: #b5cea8;
    }
    
    .result-table .string-value {
      color: #ce9178;
    }
    
    .pagination-container {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-editorWidget-border, #454545);
      flex-wrap: wrap;
    }
    
    .pagination-btn {
      background-color: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      padding: 5px 12px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 12px;
      min-width: 60px;
    }
    
    .pagination-btn:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground, #1177bb);
    }
    
    .pagination-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    
    .page-info {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #858585);
    }
    
    .page-input {
      background-color: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      padding: 4px 8px;
      border-radius: 2px;
      width: 45px;
      text-align: center;
      font-size: 12px;
    }
    
    .page-input::-webkit-outer-spin-button,
    .page-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    
    .page-input[type=number] {
      -moz-appearance: textfield;
    }
    
    .page-size-select {
      background-color: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      padding: 4px 8px;
      border-radius: 2px;
      font-size: 12px;
    }
    
    .rows-info {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #858585);
    }
    
    .loading-overlay {
      position: relative;
      opacity: 0.6;
      pointer-events: none;
    }
    
    .loading-text {
      color: #4fc1ff;
      font-style: italic;
      padding: 8px;
      text-align: center;
    }
    
    .mode-indicator {
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      z-index: 100;
    }
    
    .mode-indicator.sql-mode {
      background: #264f36;
      color: #4ec9b0;
    }
    
    .mode-indicator.normal-mode {
      background: #3c3c3c;
      color: #cccccc;
    }
    
    .input-container {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      border-top: 1px solid var(--vscode-editorWidget-border, #454545);
      flex-shrink: 0;
      min-height: 36px;
    }
    
    .input-wrapper {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }
    
    .prompt {
      color: #4ec9b0;
      margin-right: 8px;
      font-weight: bold;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    }
    
    #inputField {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--vscode-input-foreground, #cccccc);
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      outline: none;
      caret-color: var(--vscode-cursor-foreground, #cccccc);
    }
    
    #inputField::placeholder {
      color: var(--vscode-input-placeholderForeground, #858585);
    }
    
    .autocomplete-list {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--vscode-editorSuggestWidget-background, #252526);
      border: 1px solid var(--vscode-editorSuggestWidget-border, #454545);
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
      display: none;
      z-index: 1000;
      margin-bottom: 4px;
    }
    
    .autocomplete-list.show {
      display: block;
    }
    
    .autocomplete-item {
      padding: 4px 12px;
      cursor: pointer;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .autocomplete-item:hover,
    .autocomplete-item.selected {
      background: var(--vscode-editorSuggestWidget-selectedBackground, #062f4a);
    }
    
    .autocomplete-item .kind-icon {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 2px;
      font-size: 10px;
      font-weight: bold;
    }
    
    .autocomplete-item .kind-icon.keyword { background: #569cd6; color: white; }
    .autocomplete-item .kind-icon.function { background: #dcdcaa; color: black; }
    .autocomplete-item .kind-icon.table { background: #4ec9b0; color: black; }
    .autocomplete-item .kind-icon.column { background: #4fc1ff; color: black; }
    .autocomplete-item .kind-icon.dataType { background: #ce9178; color: black; }
    
    .autocomplete-item .label {
      color: var(--vscode-editorSuggestWidget-foreground, #cccccc);
    }
    
    .autocomplete-item .detail {
      color: var(--vscode-descriptionForeground, #858585);
      font-size: 11px;
      margin-left: auto;
    }
  </style>
</head>
<body>
  <div class="mode-indicator ${isSqlMode ? 'sql-mode' : 'normal-mode'}" id="modeIndicator">
    ${isSqlMode ? 'SQL MODE' : 'NORMAL MODE'}
  </div>
  
  <div class="console-container" id="consoleContainer"></div>
  
  <div class="input-container">
    <span class="prompt" id="prompt">${isSqlMode ? 'sql>' : '>'}</span>
    <div class="input-wrapper">
      <input type="text" id="inputField" placeholder="${s.console.inputPlaceholder}" autocomplete="off" />
      <div class="autocomplete-list" id="autocompleteList"></div>
    </div>
  </div>
  
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      let isSqlMode = ${isSqlMode ? 'true' : 'false'};
      const pageSizeOptions = ${JSON.stringify(PAGE_SIZE_OPTIONS)};
      const paginationTexts = {
        page: '${p.page}',
        of: '${p.of}',
        rowsPerPage: '${p.rowsPerPage}',
        first: '${p.first}',
        previous: '${p.previous}',
        next: '${p.next}',
        last: '${p.last}',
        showingRows: '${p.showingRows}',
        totalRows: '${p.totalRows}',
        goTo: '${p.goTo}',
        pageUnit: '${p.pageUnit}'
      };
      
      let history = [];
      let tableStates = {};
      let tableMetadata = [];
      let isInsertingCompletion = false;
      let commandHistory = [];
      let historyIndex = -1;
      let currentInputBeforeHistory = '';
      
      try {
        history = JSON.parse(${JSON.stringify(historyJson)});
        tableStates = JSON.parse(${JSON.stringify(tableStatesJsonStr)});
      } catch(e) {
        console.error('Failed to parse data:', e);
      }
      
      const container = document.getElementById('consoleContainer');
      const inputField = document.getElementById('inputField');
      const prompt = document.getElementById('prompt');
      const modeIndicator = document.getElementById('modeIndicator');
      
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
      
      function renderHistory() {
        container.innerHTML = '';
        
        history.forEach((item, index) => {
          if (item.type === 'line' && item.line) {
            const div = document.createElement('div');
            div.className = 'line ' + item.line.type;
            
            if (item.line.timestamp) {
              const ts = document.createElement('span');
              ts.className = 'timestamp';
              ts.textContent = '[' + item.line.timestamp + ']';
              div.appendChild(ts);
            }
            
            const content = document.createElement('span');
            content.textContent = item.line.content;
            div.appendChild(content);
            
            container.appendChild(div);
          } else if (item.type === 'helpPanel' && item.helpPanel) {
            const helpPanel = document.createElement('div');
            helpPanel.className = 'help-panel';

            let html = '<div class="help-panel-header">' + escapeHtml(item.helpPanel.title || '') + '</div>';
            html += '<div class="help-panel-body">';
            (item.helpPanel.commands || []).forEach(entry => {
              const command = entry && entry.command ? String(entry.command) : '';
              const description = entry && entry.description ? String(entry.description) : '';
              html += '<div class="help-row">';
              html += '<span class="help-command">' + escapeHtml(command) + '</span>';
              html += '<span class="help-desc">' + escapeHtml(description) + '</span>';
              html += '</div>';
            });
            html += '</div>';

            helpPanel.innerHTML = html;
            container.appendChild(helpPanel);
          } else if (item.type === 'table' && item.tableId) {
            const state = tableStates[item.tableId];
            if (!state) return;
            const tableContainer = document.createElement('div');
            tableContainer.className = 'table-container' + (state.isLoading ? ' loading-overlay' : '');
            tableContainer.id = item.tableId;
            
            let html = '';
            
            if (state.isLoading) {
              html += '<div class="loading-text">Loading...</div>';
            }
            
            html += '<table class="result-table"><thead><tr>';
            state.columns.forEach(col => {
              html += '<th>' + escapeHtml(col) + '</th>';
            });
            html += '</tr></thead><tbody>';
            
            state.currentRows.forEach(row => {
              html += '<tr>';
              state.columns.forEach(col => {
                const val = row[col];
                let displayVal;
                let cellClass = '';
                
                if (val === null || val === undefined) {
                  displayVal = 'NULL';
                  cellClass = 'null-value';
                } else if (typeof val === 'number') {
                  displayVal = val;
                  cellClass = 'number-value';
                } else if (typeof val === 'string') {
                  displayVal = val;
                  cellClass = 'string-value';
                } else if (typeof val === 'object') {
                  displayVal = JSON.stringify(val);
                } else {
                  displayVal = String(val);
                }
                
                html += '<td class="' + cellClass + '" title="' + escapeHtml(String(displayVal)) + '">' + escapeHtml(String(displayVal)) + '</td>';
              });
              html += '</tr>';
            });
            
            html += '</tbody></table>';
            
            const startIdx = (state.currentPage - 1) * state.pageSize + 1;
            const endIdx = Math.min(state.currentPage * state.pageSize, state.totalRows);
            
            html += '<div class="pagination-container">';
            html += '<span class="rows-info">' + paginationTexts.showingRows + ' ' + startIdx + '-' + endIdx + ' ' + paginationTexts.totalRows + ': ' + state.totalRows + '</span>';
            html += '<select class="page-size-select" data-action="page-size">';
            pageSizeOptions.forEach(size => {
              html += '<option value="' + size + '"' + (size === state.pageSize ? ' selected' : '') + '>' + size + '</option>';
            });
            html += '</select>';
            html += '<button class="pagination-btn" data-action="first" ' + (state.currentPage === 1 ? 'disabled' : '') + '>' + paginationTexts.first + '</button>';
            html += '<button class="pagination-btn" data-action="prev" ' + (state.currentPage === 1 ? 'disabled' : '') + '>' + paginationTexts.previous + '</button>';
            html += '<span class="page-info">' + paginationTexts.goTo + ' <input type="number" class="page-input" data-action="page-input" value="' + state.currentPage + '" min="1" max="' + state.totalPages + '">/' + state.totalPages + paginationTexts.pageUnit + '</span>';
            html += '<button class="pagination-btn" data-action="next" ' + (state.currentPage === state.totalPages ? 'disabled' : '') + '>' + paginationTexts.next + '</button>';
            html += '<button class="pagination-btn" data-action="last" ' + (state.currentPage === state.totalPages ? 'disabled' : '') + '>' + paginationTexts.last + '</button>';
            html += '</div>';
            
            tableContainer.innerHTML = html;
            container.appendChild(tableContainer);
          }
        });
        
        container.scrollTop = container.scrollHeight;
      }
      
      function goToPage(tableId, page) {
        vscode.postMessage({
          command: 'goToPage',
          tableId: tableId,
          page: parseInt(page)
        });
      }
      
      function goToFirst(tableId) {
        goToPage(tableId, 1);
      }
      
      function goToPrev(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const pageInput = table.querySelector('.page-input');
        if (pageInput) {
          const currentPage = parseInt(pageInput.value);
          if (currentPage > 1) {
            goToPage(tableId, currentPage - 1);
          }
        }
      }
      
      function goToNext(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const pageInput = table.querySelector('.page-input');
        if (pageInput) {
          const currentPage = parseInt(pageInput.value);
          const totalPages = parseInt(pageInput.max);
          if (currentPage < totalPages) {
            goToPage(tableId, currentPage + 1);
          }
        }
      }
      
      function goToLast(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const pageInput = table.querySelector('.page-input');
        if (pageInput) {
          goToPage(tableId, parseInt(pageInput.max));
        }
      }
      
      function changePageSize(tableId, newSize) {
        vscode.postMessage({
          command: 'changePageSize',
          tableId: tableId,
          pageSize: parseInt(newSize)
        });
      }

      container.addEventListener('click', (event) => {
        const target = event.target;
        const button = target && target.closest
          ? target.closest('button.pagination-btn[data-action]')
          : null;
        if (!button) {
          return;
        }

        const table = button.closest('.table-container');
        if (!table || !table.id) {
          return;
        }

        const tableId = table.id;
        const action = button.getAttribute('data-action');
        if (action === 'first') {
          goToFirst(tableId);
        } else if (action === 'prev') {
          goToPrev(tableId);
        } else if (action === 'next') {
          goToNext(tableId);
        } else if (action === 'last') {
          goToLast(tableId);
        }
      });

      container.addEventListener('change', (event) => {
        const target = event.target;
        if (!target || !target.matches) {
          return;
        }

        const table = target.closest('.table-container');
        if (!table || !table.id) {
          return;
        }

        if (target.matches('select.page-size-select[data-action=\"page-size\"]')) {
          changePageSize(table.id, target.value);
          return;
        }

        if (target.matches('input.page-input[data-action=\"page-input\"]')) {
          goToPage(table.id, target.value);
        }
      });
      
      function updateMode(sqlMode) {
        isSqlMode = sqlMode;
        prompt.textContent = sqlMode ? 'sql>' : '>';
        modeIndicator.className = 'mode-indicator ' + (sqlMode ? 'sql-mode' : 'normal-mode');
        modeIndicator.textContent = sqlMode ? 'SQL MODE' : 'NORMAL MODE';
      }
      
      inputField.addEventListener('keydown', (e) => {
        const list = document.getElementById('autocompleteList');
        const isAutocompleteVisible = list.classList.contains('show');
        
        if (e.key === 'Enter') {
          if (isAutocompleteVisible) {
            const selected = list.querySelector('.autocomplete-item.selected');
            if (selected) {
              e.preventDefault();
              const label = selected.getAttribute('data-label');
              insertCompletion(label);
            } else {
              hideAutocomplete();
            }
          } else {
            const text = inputField.value;
            if (text.trim()) {
              vscode.postMessage({ command: 'input', text: text });
              inputField.value = '';
              historyIndex = -1;
              currentInputBeforeHistory = '';
            }
          }
        } else if (e.key === 'Tab' || e.key === 'ArrowDown') {
          if (isAutocompleteVisible) {
            const items = list.querySelectorAll('.autocomplete-item');
            const selected = list.querySelector('.autocomplete-item.selected');
            if (items.length > 0) {
              e.preventDefault();
              let nextIndex = 0;
              if (selected) {
                selected.classList.remove('selected');
                const currentIndex = Array.from(items).indexOf(selected);
                nextIndex = (currentIndex + 1) % items.length;
              }
              items[nextIndex].classList.add('selected');
              items[nextIndex].scrollIntoView({ block: 'nearest' });
            }
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            navigateHistory(-1);
          }
        } else if (e.key === 'ArrowUp') {
          if (isAutocompleteVisible) {
            const items = list.querySelectorAll('.autocomplete-item');
            const selected = list.querySelector('.autocomplete-item.selected');
            if (items.length > 0) {
              e.preventDefault();
              let prevIndex = items.length - 1;
              if (selected) {
                selected.classList.remove('selected');
                const currentIndex = Array.from(items).indexOf(selected);
                prevIndex = (currentIndex - 1 + items.length) % items.length;
              }
              items[prevIndex].classList.add('selected');
              items[prevIndex].scrollIntoView({ block: 'nearest' });
            }
          } else {
            e.preventDefault();
            navigateHistory(1);
          }
        } else if (e.key === 'Escape') {
          hideAutocomplete();
        }
      });
      
      function navigateHistory(direction) {
        if (commandHistory.length === 0) {
          return;
        }
        
        if (historyIndex === -1) {
          currentInputBeforeHistory = inputField.value;
        }
        
        let newIndex = historyIndex + direction;
        
        if (newIndex >= commandHistory.length) {
          newIndex = commandHistory.length - 1;
        }
        
        if (newIndex < -1) {
          newIndex = -1;
        }
        
        historyIndex = newIndex;
        
        isInsertingCompletion = true;
        
        if (historyIndex === -1) {
          inputField.value = currentInputBeforeHistory;
        } else {
          inputField.value = commandHistory[historyIndex];
        }
        
        inputField.setSelectionRange(inputField.value.length, inputField.value.length);
        hideAutocomplete();
        
        setTimeout(() => {
          isInsertingCompletion = false;
        }, 50);
      }
      
      inputField.addEventListener('input', () => {
        if (isInsertingCompletion) {
          return;
        }
        historyIndex = -1;
        const text = inputField.value;
        const pos = inputField.selectionStart;
        if (text) {
          vscode.postMessage({ 
            command: 'getCompletions', 
            text: text, 
            position: pos 
          });
        } else {
          hideAutocomplete();
        }
      });
      
      inputField.addEventListener('blur', () => {
        setTimeout(hideAutocomplete, 200);
      });
      
      function showAutocomplete(items) {
        const list = document.getElementById('autocompleteList');
        if (!items || items.length === 0) {
          hideAutocomplete();
          return;
        }
        
        let html = '';
        items.forEach((item, index) => {
          const iconChar = item.kind.charAt(0).toUpperCase();
          html += '<div class="autocomplete-item' + (index === 0 ? ' selected' : '') + '" data-label="' + escapeHtml(item.label) + '">';
          html += '<span class="kind-icon ' + item.kind + '">' + iconChar + '</span>';
          html += '<span class="label">' + escapeHtml(item.label) + '</span>';
          html += '<span class="detail">' + escapeHtml(item.detail) + '</span>';
          html += '</div>';
        });
        
        list.innerHTML = html;
        list.classList.add('show');
        
        list.querySelectorAll('.autocomplete-item').forEach(el => {
          el.addEventListener('click', () => {
            const label = el.getAttribute('data-label');
            insertCompletion(label);
          });
        });
      }
      
      function hideAutocomplete() {
        const list = document.getElementById('autocompleteList');
        list.classList.remove('show');
        list.innerHTML = '';
      }
      
      function insertCompletion(label) {
        isInsertingCompletion = true;

        const currentText = inputField.value;
        const selectionStart = inputField.selectionStart !== null ? inputField.selectionStart : currentText.length;
        const selectionEnd = inputField.selectionEnd !== null ? inputField.selectionEnd : selectionStart;
        const isWordChar = ch => /[A-Za-z0-9_$.]/.test(ch);

        let wordStart = selectionStart;
        while (wordStart > 0 && isWordChar(currentText.charAt(wordStart - 1))) {
          wordStart--;
        }

        let wordEnd = selectionEnd;
        while (wordEnd < currentText.length && isWordChar(currentText.charAt(wordEnd))) {
          wordEnd++;
        }

        // In command context, include a leading ":" in replace range to avoid "::help".
        if (label && label.startsWith(':') && wordStart > 0 && currentText.charAt(wordStart - 1) === ':') {
          wordStart--;
        }

        const newValue = currentText.substring(0, wordStart) + label + currentText.substring(wordEnd);
        const cursorPos = wordStart + label.length;
        inputField.value = newValue;
        inputField.setSelectionRange(cursorPos, cursorPos);

        inputField.focus();
        hideAutocomplete();

        setTimeout(() => {
          isInsertingCompletion = false;
        }, 50);
      }
      
      window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'update') {
          if (message.history) {
            history = message.history;
          }
          if (message.tableStates) {
            tableStates = message.tableStates;
          }
          renderHistory();
          updateMode(message.isSqlMode);
        } else if (message.command === 'completions') {
          showAutocomplete(message.items);
        } else if (message.command === 'metadata') {
          tableMetadata = message.tables;
        } else if (message.command === 'commandHistory') {
          commandHistory = message.history || [];
          historyIndex = -1;
        } else if (message.command === 'setInputText') {
          inputField.value = message.text || '';
          inputField.focus();
          inputField.setSelectionRange(inputField.value.length, inputField.value.length);
          historyIndex = -1;
          currentInputBeforeHistory = '';
          hideAutocomplete();
        }
      });
      
      vscode.postMessage({ command: 'ready' });
      vscode.postMessage({ command: 'loadMetadata' });
      vscode.postMessage({ command: 'getCommandHistory' });
      renderHistory();
      updateMode(isSqlMode);
      inputField.focus();
    })();
  </script>
</body>
</html>`;
  }

  private _getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  public dispose() {
    SqlConsolePanel.currentPanel = undefined;
    this._clearHistory();
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
