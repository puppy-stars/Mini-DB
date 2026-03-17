﻿﻿﻿﻿﻿import * as vscode from 'vscode';
import { DatabaseType, QueryResult } from '../models/types';
import { DataExporter, ExportFormat } from '../utils/dataExporter';
import { i18n } from '../i18n';
import { SqlEscape } from '../utils/sqlEscape';

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500];

export class QueryResultPanel {
  public static currentPanel: QueryResultPanel | undefined;
  public static readonly viewType = 'minidb.queryResult';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  
  private _currentResult: QueryResult | null = null;
  private _currentSql: string = '';
  private _executeQuery: ((sql: string) => Promise<QueryResult>) | null = null;
  
  private _currentPage: number = 1;
  private _pageSize: number = DEFAULT_PAGE_SIZE;
  private _totalRows: number = 0;
  private _totalPages: number = 1;
  private _isSelectQuery: boolean = false;
  private _isLoading: boolean = false;
  private _dbType: DatabaseType = 'mysql';

  public static createOrShow(
    extensionUri: vscode.Uri,
    executeQuery?: (sql: string) => Promise<QueryResult>,
    dbType: DatabaseType = 'mysql'
  ): QueryResultPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (QueryResultPanel.currentPanel) {
      QueryResultPanel.currentPanel._panel.reveal(column);
      if (executeQuery) {
        QueryResultPanel.currentPanel._executeQuery = executeQuery;
      }
      QueryResultPanel.currentPanel._dbType = dbType;
      return QueryResultPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      QueryResultPanel.viewType,
      'Query Results',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    QueryResultPanel.currentPanel = new QueryResultPanel(panel, extensionUri, executeQuery, dbType);
    return QueryResultPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    executeQuery?: (sql: string) => Promise<QueryResult>,
    dbType: DatabaseType = 'mysql'
  ) {
    this._panel = panel;
    this._executeQuery = executeQuery || null;
    this._dbType = dbType;
    
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'export':
            await this.handleExport(message.format as ExportFormat);
            break;
          case 'goToPage':
            await this._handleGoToPage(message.page);
            break;
          case 'changePageSize':
            await this._handleChangePageSize(message.pageSize);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public setExecuteQuery(executeQuery: (sql: string) => Promise<QueryResult>): void {
    this._executeQuery = executeQuery;
  }

  private async _handleGoToPage(page: number): Promise<void> {
    if (!this._executeQuery || !this._isSelectQuery) {
      return;
    }

    const newPage = parseInt(String(page));
    if (newPage < 1 || newPage > this._totalPages) {
      return;
    }

    this._currentPage = newPage;
    await this._loadPage();
  }

  private async _handleChangePageSize(pageSize: number): Promise<void> {
    if (!this._executeQuery || !this._isSelectQuery) {
      return;
    }

    this._pageSize = parseInt(String(pageSize));
    this._currentPage = 1;
    await this._loadPage();
  }

  private async _loadPage(): Promise<void> {
    if (!this._executeQuery || !this._currentSql) {
      return;
    }

    this._isLoading = true;
    this._showLoading();

    const offset = (this._currentPage - 1) * this._pageSize;
    const paginatedSql = SqlEscape.buildPaginatedQuery(this._currentSql, this._dbType, this._pageSize, offset);

    try {
      const result = await this._executeQuery(paginatedSql);
      this._currentResult = result;
      this._isLoading = false;
      this._updateWebview();
    } catch (error) {
      this._isLoading = false;
      this._hideLoading();
      vscode.window.showErrorMessage(
        `Failed to load page: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private _showLoading(): void {
    this._panel.webview.postMessage({ command: 'showLoading' });
  }

  private _hideLoading(): void {
    this._panel.webview.postMessage({ command: 'hideLoading' });
  }

  private async handleExport(format: ExportFormat): Promise<void> {
    if (!this._currentResult) {
      vscode.window.showErrorMessage(i18n.strings.export.noData);
      return;
    }

    let resultToExport: QueryResult = this._currentResult;
    if (this._isSelectQuery && this._executeQuery && this._currentSql) {
      const isChinese = i18n.language === 'zh';
      const scopePick = await vscode.window.showQuickPick(
        [
          {
            label: isChinese ? '当前页' : 'Current Page',
            description: isChinese ? '仅导出当前分页结果' : 'Export current page only',
            id: 'current'
          },
          {
            label: isChinese ? '全部结果' : 'All Rows',
            description: isChinese ? '基于原始 SQL 重新查询并导出全部结果' : 'Re-run original SQL and export all rows',
            id: 'all'
          }
        ],
        {
          placeHolder: isChinese ? '选择导出范围' : 'Select export scope'
        }
      );

      if (!scopePick) {
        return;
      }

      if (scopePick.id === 'all') {
        this._showLoading();
        try {
          resultToExport = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: isChinese ? '正在查询全部结果用于导出...' : 'Loading all rows for export...',
              cancellable: false
            },
            async () => await this._executeQuery!(this._currentSql)
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `${i18n.strings.export.failed}: ${error instanceof Error ? error.message : String(error)}`
          );
          return;
        } finally {
          this._hideLoading();
        }
      }
    }

    const filters: Record<string, string[]> = {};
    
    switch (format) {
      case 'csv':
        filters['CSV Files'] = ['csv'];
        break;
      case 'json':
        filters['JSON Files'] = ['json'];
        break;
      case 'excel':
        filters['Excel XML Files'] = ['xml'];
        break;
      case 'xlsx':
        filters['Excel Files'] = ['xlsx'];
        break;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`query_results${DataExporter.getFileExtension(format)}`),
      filters
    });

    if (!uri) {
      return;
    }

    try {
      const content = DataExporter.export(resultToExport, {
        format,
        includeHeaders: true
      });

      if (typeof content === 'string') {
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
      } else {
        await vscode.workspace.fs.writeFile(uri, content);
      }

      vscode.window.showInformationMessage(
        `${i18n.strings.export.success}: ${uri.fsPath}`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `${i18n.strings.export.failed}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  public updateResult(result: QueryResult, sql: string): void {
    this._currentSql = sql.trim();
    this._currentResult = result;
    
    this._isSelectQuery = /^\s*SELECT\s/i.test(this._currentSql);
    
    if (this._isSelectQuery && result.affectedRows === undefined) {
      this._totalRows = result.rowCount;
      this._totalPages = Math.ceil(this._totalRows / this._pageSize) || 1;
      if (this._currentPage > this._totalPages) {
        this._currentPage = this._totalPages;
      }
    } else {
      this._totalRows = result.rowCount;
      this._totalPages = 1;
    }

    this._updateWebview();
  }

  public showError(error: string, sql: string): void {
    this._currentResult = null;
    this._currentSql = sql;
    this._isSelectQuery = false;
    this._panel.webview.html = this._getErrorHtml(error, sql);
    this._panel.title = 'Query Error';
  }

  private _updateWebview(): void {
    if (!this._currentResult) {
      return;
    }
    this._panel.webview.html = this._getHtmlForWebview(this._currentResult, this._currentSql);
    this._panel.title = `Query Results (${this._totalRows} rows, ${this._currentResult.executionTime}ms)`;
  }

  private _getHtmlForWebview(result: QueryResult, sql: string): string {
    const s = i18n.strings;
    const p = s.pagination;
    const hasData = result.rows.length > 0;
    const showPagination = this._isSelectQuery;
    const nonce = this._getNonce();

    const tableRows = result.rows.map(row => {
      const cells = result.columns.map(col => {
        const value = row[col];
        const displayValue = value === null ? '<span class="null">NULL</span>' : 
                             value === undefined ? '' : 
                             this._escapeHtml(String(value));
        return `<td>${displayValue}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const headerCells = result.columns.map((col, index) => {
      const meta = result.columnMetadata?.[index];
      const pkIcon = meta?.isPrimaryKey ? '<i class="codicon codicon-key" style="font-size:12px;margin-right:4px;"></i>' : '';
      const nullableIcon = meta?.nullable === false ? '<span style="color:var(--vscode-errorForeground);">*</span>' : '';
      const title = meta?.type ? `${col} (${meta.type}${meta.nullable === false ? ', NOT NULL' : ''})` : col;
      return `<th title="${this._escapeHtml(title)}">${pkIcon}${this._escapeHtml(col)}${nullableIcon}</th>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this._panel.webview.cspSource} data:; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src ${this._panel.webview.cspSource} 'nonce-${nonce}' 'unsafe-inline';">
  <title>Query Results</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
    }
    body {
      font-family: var(--vscode-font-family);
      padding: 10px;
      padding-bottom: 60px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .export-btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
    }
    .export-btn:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground);
    }
    .export-btn:disabled {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: not-allowed;
      opacity: 0.4;
    }
    .sql-preview {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-all;
      flex-shrink: 0;
    }
    .stats {
      margin-bottom: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      flex-shrink: 0;
    }
    .table-container {
      flex: 1;
      overflow-x: auto;
      overflow-y: auto;
      min-height: 200px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--vscode-editor-font-size);
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 8px 12px;
      text-align: left;
      white-space: nowrap;
    }
    th {
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 1;
      border-top: none;
    }
    th:first-child {
      border-left: none;
    }
    th:last-child {
      border-right: none;
    }
    tr:nth-child(even) {
      background-color: var(--vscode-list-evenRowsBackground, transparent);
    }
    tr:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    .null {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .no-results {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }
    .pagination-container {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 10px 16px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-wrap: wrap;
    }
    .pagination-btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
      min-width: 70px;
    }
    .pagination-btn:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground);
    }
    .pagination-btn:disabled {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: not-allowed;
      opacity: 0.4;
    }
    .page-info {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      margin: 0 4px;
    }
    .page-size-select {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 10px;
      border-radius: 2px;
      font-size: 13px;
    }
    .page-input {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 6px 10px;
      border-radius: 2px;
      width: 55px;
      text-align: center;
      font-size: 13px;
    }
    .page-input::-webkit-outer-spin-button,
    .page-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .page-input[type=number] {
      -moz-appearance: textfield;
    }
    .rows-info {
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
      margin-left: 10px;
    }
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 9999;
    }
    .loading-overlay.show {
      display: flex;
    }
    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .loading-spinner .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--vscode-progressBar-background, #0e70c0);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .loading-spinner .text {
      color: var(--vscode-foreground);
      font-size: 14px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loading-overlay" id="loadingOverlay">
    <div class="loading-spinner">
      <div class="spinner"></div>
      <div class="text">${i18n.strings.loading.loadingData}</div>
    </div>
  </div>
  <div class="toolbar">
    <button class="export-btn" id="exportCsvBtn" type="button" ${!hasData ? 'disabled' : ''}>${s.export.csv}</button>
    <button class="export-btn" id="exportJsonBtn" type="button" ${!hasData ? 'disabled' : ''}>${s.export.json}</button>
    <button class="export-btn" id="exportExcelBtn" type="button" ${!hasData ? 'disabled' : ''}>${s.export.excel}</button>
    <button class="export-btn" id="exportXlsxBtn" type="button" ${!hasData ? 'disabled' : ''}>${s.export.xlsx}</button>
  </div>
  <div class="sql-preview">${this._escapeHtml(sql)}</div>
  <div class="stats">
    ${this._totalRows} row(s) returned in ${result.executionTime}ms
    ${result.affectedRows !== undefined ? ` | ${result.affectedRows} row(s) affected` : ''}
  </div>
  <div class="table-container">
    <table>
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>
  <div class="pagination-container" id="paginationContainer" style="display: ${showPagination ? 'flex' : 'none'};">
    <span class="rows-info" id="rowsInfo">${p.showingRows} ${((this._currentPage - 1) * this._pageSize + 1)}-${Math.min(this._currentPage * this._pageSize, this._totalRows)} ${p.totalRows}: ${this._totalRows}</span>
    <select class="page-size-select" id="pageSizeSelect">
      ${PAGE_SIZE_OPTIONS.map(size => `<option value="${size}" ${size === this._pageSize ? 'selected' : ''}>${size} ${p.rowsPerPage}</option>`).join('')}
    </select>
    <button class="pagination-btn" id="firstBtn" type="button" ${this._currentPage === 1 ? 'disabled' : ''}>${p.first}</button>
    <button class="pagination-btn" id="prevBtn" type="button" ${this._currentPage === 1 ? 'disabled' : ''}>${p.previous}</button>
    <span class="page-info">${p.goTo} <input type="number" class="page-input" id="pageInput" value="${this._currentPage}" min="1" max="${this._totalPages}">/${this._totalPages}${p.pageUnit}</span>
    <button class="pagination-btn" id="nextBtn" type="button" ${this._currentPage === this._totalPages ? 'disabled' : ''}>${p.next}</button>
    <button class="pagination-btn" id="lastBtn" type="button" ${this._currentPage === this._totalPages ? 'disabled' : ''}>${p.last}</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const currentPage = ${this._currentPage};
    const totalPages = ${this._totalPages};

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'showLoading':
          document.getElementById('loadingOverlay').classList.add('show');
          break;
        case 'hideLoading':
          document.getElementById('loadingOverlay').classList.remove('show');
          break;
      }
    });

    function exportData(format) {
      vscode.postMessage({
        command: 'export',
        format: format
      });
    }

    function goToPage(page) {
      vscode.postMessage({
        command: 'goToPage',
        page: parseInt(page)
      });
    }

    function goToFirst() {
      goToPage(1);
    }

    function goToPrev() {
      goToPage(currentPage - 1);
    }

    function goToNext() {
      goToPage(currentPage + 1);
    }

    function goToLast() {
      goToPage(totalPages);
    }

    function changePageSize(size) {
      vscode.postMessage({
        command: 'changePageSize',
        pageSize: parseInt(size)
      });
    }

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    const exportXlsxBtn = document.getElementById('exportXlsxBtn');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const firstBtn = document.getElementById('firstBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const lastBtn = document.getElementById('lastBtn');
    const pageInput = document.getElementById('pageInput');

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => exportData('csv'));
    }
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => exportData('json'));
    }
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', () => exportData('excel'));
    }
    if (exportXlsxBtn) {
      exportXlsxBtn.addEventListener('click', () => exportData('xlsx'));
    }

    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', function() {
        changePageSize(this.value);
      });
    }
    if (firstBtn) {
      firstBtn.addEventListener('click', goToFirst);
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', goToPrev);
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', goToNext);
    }
    if (lastBtn) {
      lastBtn.addEventListener('click', goToLast);
    }
    if (pageInput) {
      pageInput.addEventListener('change', function() {
        goToPage(this.value);
      });
    }
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(error: string, sql: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline';">
  <title>Query Error</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 10px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .sql-preview {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      margin-bottom: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-all;
    }
    .error {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      padding: 10px;
      border-radius: 4px;
      color: var(--vscode-inputValidation-errorForeground, #ffffff);
    }
    .error-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
  </style>
</head>
<body>
  <div class="sql-preview">${this._escapeHtml(sql)}</div>
  <div class="error">
    <div class="error-title">Error:</div>
    <div>${this._escapeHtml(error)}</div>
  </div>
</body>
</html>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    QueryResultPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
