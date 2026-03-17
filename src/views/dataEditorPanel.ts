import * as vscode from 'vscode';
import { QueryResult, TableColumn, DatabaseType } from '../models/types';
import { SqlEscape } from '../utils/sqlEscape';
import { i18n } from '../i18n';

interface CellChange {
  rowIndex: number;
  column: string;
  oldValue: unknown;
  newValue: unknown;
}

interface RowChange {
  type: 'insert' | 'update' | 'delete';
  rowIndex: number;
  originalRow?: Record<string, unknown>;
  changes?: CellChange[];
}

interface EditorState {
  data: Record<string, unknown>[];
  columns: TableColumn[];
  changes: RowChange[];
  deletedRows: Set<number>;
  newRows: Map<number, Record<string, unknown>>;
}

const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500];

export class DataEditorPanel {
  public static currentPanel: DataEditorPanel | undefined;
  public static readonly viewType = 'minidb.dataEditor';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  
  private _connectionId: string = '';
  private _databaseName: string = '';
  private _tableName: string = '';
  private _dbType: DatabaseType = 'mysql';
  private _executeQuery: ((sql: string) => Promise<QueryResult>) | null = null;
  private _beginTransaction: (() => Promise<void>) | null = null;
  private _commitTransaction: (() => Promise<void>) | null = null;
  private _rollbackTransaction: (() => Promise<void>) | null = null;
  
  private _state: EditorState = {
    data: [],
    columns: [],
    changes: [],
    deletedRows: new Set(),
    newRows: new Map()
  };

  private _currentPage: number = 1;
  private _pageSize: number = DEFAULT_PAGE_SIZE;
  private _totalRows: number = 0;
  private _totalPages: number = 0;
  private _isLoading: boolean = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    connectionId: string,
    databaseName: string,
    tableName: string,
    dbType: DatabaseType,
    executeQuery: (sql: string) => Promise<QueryResult>,
    beginTransaction?: () => Promise<void>,
    commitTransaction?: () => Promise<void>,
    rollbackTransaction?: () => Promise<void>
  ): DataEditorPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DataEditorPanel.currentPanel) {
      DataEditorPanel.currentPanel._panel.reveal(column);
      DataEditorPanel.currentPanel._initialize(
        connectionId,
        databaseName,
        tableName,
        dbType,
        executeQuery,
        beginTransaction,
        commitTransaction,
        rollbackTransaction
      );
      return DataEditorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DataEditorPanel.viewType,
      `${i18n.strings.dataEditor.title}: ${tableName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    DataEditorPanel.currentPanel = new DataEditorPanel(panel, extensionUri);
    DataEditorPanel.currentPanel._initialize(
      connectionId,
      databaseName,
      tableName,
      dbType,
      executeQuery,
      beginTransaction,
      commitTransaction,
      rollbackTransaction
    );
    return DataEditorPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'cellEdit':
            await this._handleCellEdit(message.rowIndex, message.column, message.oldValue, message.newValue);
            break;
          case 'addRow':
            await this._handleAddRow();
            break;
          case 'deleteRow':
            await this._handleDeleteRow(message.rowIndex);
            break;
          case 'saveChanges':
            await this._handleSaveChanges();
            break;
          case 'refresh':
            await this._loadData();
            break;
          case 'undoChanges':
            this._handleUndoChanges();
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

  private async _initialize(
    connectionId: string,
    databaseName: string,
    tableName: string,
    dbType: DatabaseType,
    executeQuery: (sql: string) => Promise<QueryResult>,
    beginTransaction?: () => Promise<void>,
    commitTransaction?: () => Promise<void>,
    rollbackTransaction?: () => Promise<void>
  ): Promise<void> {
    this._connectionId = connectionId;
    this._databaseName = databaseName;
    this._tableName = tableName;
    this._dbType = dbType;
    this._executeQuery = executeQuery;
    this._beginTransaction = beginTransaction || null;
    this._commitTransaction = commitTransaction || null;
    this._rollbackTransaction = rollbackTransaction || null;
    this._currentPage = 1;
    this._pageSize = DEFAULT_PAGE_SIZE;
    
    this._panel.title = `${i18n.strings.dataEditor.title}: ${tableName}`;
    
    await this._loadData();
  }

  private async _loadData(): Promise<void> {
    if (!this._executeQuery) {
      return;
    }

    this._isLoading = true;
    this._showLoading();

    try {
      const escapedTable = SqlEscape.escapeTableName(this._tableName, this._dbType);
      
      const countSql = `SELECT COUNT(*) as total FROM ${escapedTable}`;
      const countResult = await this._executeQuery(countSql);
      this._totalRows = countResult.rows.length > 0 ? Number(countResult.rows[0].total) || 0 : 0;
      this._totalPages = Math.ceil(this._totalRows / this._pageSize) || 1;
      
      if (this._currentPage > this._totalPages) {
        this._currentPage = this._totalPages;
      }
      
      const offset = (this._currentPage - 1) * this._pageSize;
      const dataSql = SqlEscape.buildSelectQuery(this._tableName, this._dbType, {
        limit: this._pageSize,
        offset: offset
      });
      const result = await this._executeQuery(dataSql);
      const columnsSql = this._buildColumnsQuery();
      const columnsResult = await this._executeQuery(columnsSql);
      
      this._state = {
        data: result.rows,
        columns: columnsResult.rows.map(row => ({
          name: String(row.name ?? ''),
          type: String(row.type ?? ''),
          nullable: String(row.nullable ?? '').toUpperCase() === 'YES',
          isPrimaryKey: String(row.column_key ?? '').toUpperCase() === 'PRI',
          defaultValue: row.default_value !== undefined ? (row.default_value as string | null) : null
        })),
        changes: [],
        deletedRows: new Set(),
        newRows: new Map()
      };

      this._isLoading = false;
      this._updateWebview();
      // Ensure overlay is cleared even if a delayed showLoading message arrives.
      this._hideLoading();
    } catch (error) {
      this._isLoading = false;
      this._hideLoading();
      this._showError(error instanceof Error ? error.message : String(error));
    }
  }

  private _buildColumnsQuery(): string {
    switch (this._dbType) {
      case 'mysql':
        return `SELECT 
            COLUMN_NAME as name,
            COLUMN_TYPE as type,
            IS_NULLABLE as nullable,
            COLUMN_KEY as column_key,
            COLUMN_DEFAULT as default_value
           FROM information_schema.COLUMNS 
           WHERE TABLE_SCHEMA = ${SqlEscape.safeStringLiteral(this._databaseName, this._dbType)}
             AND TABLE_NAME = ${SqlEscape.safeStringLiteral(this._tableName, this._dbType)}
           ORDER BY ORDINAL_POSITION`;
      case 'postgresql':
        return `SELECT 
            a.attname as name,
            pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
            CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END as nullable,
            CASE WHEN pk.contype = 'p' THEN 'PRI' ELSE '' END as column_key,
            pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
           LEFT JOIN pg_constraint pk ON pk.conrelid = a.attrelid 
             AND a.attnum = ANY(pk.conkey) AND pk.contype = 'p'
           WHERE a.attrelid = (${SqlEscape.safeStringLiteral(this._tableName, this._dbType)})::regclass
             AND a.attnum > 0
             AND NOT a.attisdropped
           ORDER BY a.attnum`;
      case 'sqlserver':
        return `SELECT 
            c.COLUMN_NAME as name,
            c.DATA_TYPE +
              CASE
                WHEN c.DATA_TYPE IN ('char', 'varchar', 'nchar', 'nvarchar', 'binary', 'varbinary')
                  THEN '(' + CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'MAX' ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR(10)) END + ')'
                WHEN c.DATA_TYPE IN ('decimal', 'numeric')
                  THEN '(' + CAST(c.NUMERIC_PRECISION AS VARCHAR(10)) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR(10)) + ')'
                ELSE ''
              END as type,
            c.IS_NULLABLE as nullable,
            CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI' ELSE '' END as column_key,
            c.COLUMN_DEFAULT as default_value
           FROM INFORMATION_SCHEMA.COLUMNS c
           LEFT JOIN (
             SELECT ku.TABLE_NAME, ku.COLUMN_NAME
             FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
             JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
               ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
              AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
             WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
               AND tc.TABLE_CATALOG = ${SqlEscape.safeStringLiteral(this._databaseName, this._dbType)}
           ) pk ON c.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
           WHERE c.TABLE_CATALOG = ${SqlEscape.safeStringLiteral(this._databaseName, this._dbType)}
             AND c.TABLE_NAME = ${SqlEscape.safeStringLiteral(this._tableName, this._dbType)}
           ORDER BY c.ORDINAL_POSITION`;
      case 'oracle':
        return `SELECT 
            c.COLUMN_NAME as name,
            c.DATA_TYPE ||
              CASE
                WHEN c.DATA_TYPE IN ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR')
                  THEN '(' || c.DATA_LENGTH || ')'
                WHEN c.DATA_TYPE = 'NUMBER' AND c.DATA_PRECISION IS NOT NULL
                  THEN '(' || c.DATA_PRECISION || CASE WHEN c.DATA_SCALE > 0 THEN ',' || c.DATA_SCALE ELSE '' END || ')'
                ELSE ''
              END as type,
            CASE WHEN c.NULLABLE = 'Y' THEN 'YES' ELSE 'NO' END as nullable,
            CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI' ELSE '' END as column_key,
            c.DATA_DEFAULT as default_value
           FROM ALL_TAB_COLUMNS c
           LEFT JOIN (
             SELECT cols.COLUMN_NAME, cols.TABLE_NAME, cols.OWNER
             FROM ALL_CONSTRAINTS cons
             JOIN ALL_CONS_COLUMNS cols
               ON cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
              AND cons.OWNER = cols.OWNER
             WHERE cons.CONSTRAINT_TYPE = 'P'
           ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME AND c.TABLE_NAME = pk.TABLE_NAME AND c.OWNER = pk.OWNER
           WHERE c.OWNER = ${SqlEscape.safeStringLiteral(this._databaseName.toUpperCase(), this._dbType)}
             AND c.TABLE_NAME = ${SqlEscape.safeStringLiteral(this._tableName.toUpperCase(), this._dbType)}
           ORDER BY c.COLUMN_ID`;
      case 'sqlite':
        return `SELECT 
            name as name,
            type as type,
            CASE WHEN "notnull" = 1 THEN 'NO' ELSE 'YES' END as nullable,
            CASE WHEN pk > 0 THEN 'PRI' ELSE '' END as column_key,
            dflt_value as default_value
           FROM pragma_table_info(${SqlEscape.safeStringLiteral(this._tableName, this._dbType)})
           ORDER BY cid`;
      default:
        throw new Error(`Unsupported database type for editor columns: ${this._dbType}`);
    }
  }

  private _showLoading(): void {
    this._panel.webview.postMessage({ command: 'showLoading' });
  }

  private _hideLoading(): void {
    this._panel.webview.postMessage({ command: 'hideLoading' });
  }

  private async _handleGoToPage(page: number): Promise<void> {
    const newPage = parseInt(String(page));
    if (newPage >= 1 && newPage <= this._totalPages) {
      this._currentPage = newPage;
      await this._loadData();
    }
  }

  private async _handleChangePageSize(pageSize: number): Promise<void> {
    this._pageSize = parseInt(String(pageSize));
    this._currentPage = 1;
    await this._loadData();
  }

  private async _handleCellEdit(rowIndex: number, column: string, oldValue: unknown, newValue: unknown): Promise<void> {
    const currentRow = this._state.data[rowIndex];
    if (!currentRow) {
      return;
    }

    const existingChange = this._state.changes.find(
      c => c.type === 'update' && c.rowIndex === rowIndex
    );

    if (existingChange && existingChange.changes) {
      const existingCellChange = existingChange.changes.find(c => c.column === column);
      if (existingCellChange) {
        existingCellChange.newValue = newValue;
        if (existingCellChange.oldValue === newValue) {
          existingChange.changes = existingChange.changes.filter(c => c.column !== column);
        }
      } else {
        existingChange.changes.push({ rowIndex, column, oldValue, newValue });
      }
      if (existingChange.changes.length === 0) {
        this._state.changes = this._state.changes.filter(c => c !== existingChange);
      }
    } else {
      this._state.changes.push({
        type: 'update',
        rowIndex,
        originalRow: { ...currentRow },
        changes: [{ rowIndex, column, oldValue, newValue }]
      });
    }

    currentRow[column] = newValue;
    this._updateWebview();
  }

  private async _handleAddRow(): Promise<void> {
    const newRow: Record<string, unknown> = {};
    for (const col of this._state.columns) {
      newRow[col.name] = col.defaultValue ?? (col.nullable ? null : '');
    }

    const newIndex = this._state.data.length;
    this._state.data.push(newRow);
    this._state.newRows.set(newIndex, newRow);
    this._state.changes.push({
      type: 'insert',
      rowIndex: newIndex,
      originalRow: { ...newRow }
    });

    this._updateWebview();
  }

  private async _handleDeleteRow(rowIndex: number): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      i18n.strings.dataEditor.confirmDelete,
      i18n.strings.messages.delete,
      i18n.strings.messages.cancel
    );

    if (confirm !== i18n.strings.messages.delete) {
      return;
    }

    if (this._state.newRows.has(rowIndex)) {
      this._state.newRows.delete(rowIndex);
      this._state.changes = this._state.changes.filter(
        c => !(c.type === 'insert' && c.rowIndex === rowIndex)
      );
    } else {
      const existingUpdate = this._state.changes.find(
        c => c.type === 'update' && c.rowIndex === rowIndex
      );
      const deleteSource = existingUpdate?.originalRow
        ? { ...existingUpdate.originalRow }
        : { ...this._state.data[rowIndex] };

      this._state.changes = this._state.changes.filter(
        c => !(c.type === 'update' && c.rowIndex === rowIndex)
      );
      this._state.deletedRows.add(rowIndex);
      this._state.changes.push({
        type: 'delete',
        rowIndex,
        originalRow: deleteSource
      });
    }

    this._state.data.splice(rowIndex, 1);
    
    this._state.changes = this._state.changes.map(c => {
      if (c.rowIndex > rowIndex) {
        return { ...c, rowIndex: c.rowIndex - 1 };
      }
      return c;
    });

    const newNewRows = new Map<number, Record<string, unknown>>();
    this._state.newRows.forEach((row, idx) => {
      if (idx > rowIndex) {
        newNewRows.set(idx - 1, row);
      } else if (idx < rowIndex) {
        newNewRows.set(idx, row);
      }
    });
    this._state.newRows = newNewRows;

    this._updateWebview();
  }

  private async _handleSaveChanges(): Promise<void> {
    if (this._state.changes.length === 0) {
      vscode.window.showInformationMessage(i18n.strings.dataEditor.noChanges);
      return;
    }

    if (!this._executeQuery) {
      return;
    }

    const pkColumns = this._state.columns.filter(c => c.isPrimaryKey).map(c => c.name);
    
    if (pkColumns.length === 0) {
      vscode.window.showErrorMessage(i18n.strings.dataEditor.noPrimaryKey);
      return;
    }

    const supportsTransaction = Boolean(
      this._beginTransaction &&
      this._commitTransaction &&
      this._rollbackTransaction
    );
    let transactionStarted = false;

    try {
      if (supportsTransaction) {
        await this._beginTransaction!();
        transactionStarted = true;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: i18n.strings.dataEditor.saving,
          cancellable: false
        },
        async () => {
          for (const change of this._state.changes) {
            switch (change.type) {
              case 'insert':
                await this._executeInsert(change.rowIndex);
                break;
              case 'update':
                await this._executeUpdate(change);
                break;
              case 'delete':
                await this._executeDelete(change.originalRow!);
                break;
            }
          }
        }
      );

      if (transactionStarted) {
        await this._commitTransaction!();
      }

      vscode.window.showInformationMessage(i18n.strings.dataEditor.saveSuccess);
      await this._loadData();
    } catch (error) {
      if (transactionStarted) {
        await this._rollbackTransaction!().catch(() => undefined);
      }
      vscode.window.showErrorMessage(
        `${i18n.strings.dataEditor.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async _executeInsert(rowIndex: number): Promise<void> {
    if (!this._executeQuery) {
      return;
    }

    const row = this._state.data[rowIndex];
    const columns: string[] = [];
    const values: string[] = [];

    for (const col of this._state.columns) {
      const value = row[col.name];
      if (value !== null && value !== undefined && value !== '') {
        columns.push(SqlEscape.escapeColumnName(col.name, this._dbType));
        values.push(this._formatValue(value));
      }
    }

    if (columns.length === 0) {
      return;
    }

    const escapedTable = SqlEscape.escapeTableName(this._tableName, this._dbType);
    const sql = `INSERT INTO ${escapedTable} (${columns.join(', ')}) VALUES (${values.join(', ')})`;
    
    await this._executeQuery(sql);
  }

  private async _executeUpdate(change: RowChange): Promise<void> {
    if (!this._executeQuery || !change.changes || change.changes.length === 0) {
      return;
    }

    const row = this._state.data[change.rowIndex];
    const whereSource = change.originalRow || row;
    const pkColumns = this._state.columns.filter(c => c.isPrimaryKey).map(c => c.name);

    const setClauses = change.changes.map(c => {
      const escapedColumn = SqlEscape.escapeColumnName(c.column, this._dbType);
      return `${escapedColumn} = ${this._formatValue(c.newValue)}`;
    });

    const whereClauses = pkColumns.map(col => {
      const escapedColumn = SqlEscape.escapeColumnName(col, this._dbType);
      const value = whereSource[col];
      return `${escapedColumn} = ${this._formatValue(value)}`;
    });

    const escapedTable = SqlEscape.escapeTableName(this._tableName, this._dbType);
    const sql = `UPDATE ${escapedTable} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
    
    await this._executeQuery(sql);
  }

  private async _executeDelete(row: Record<string, unknown>): Promise<void> {
    if (!this._executeQuery) {
      return;
    }

    const pkColumns = this._state.columns.filter(c => c.isPrimaryKey).map(c => c.name);

    const whereClauses = pkColumns.map(col => {
      const escapedColumn = SqlEscape.escapeColumnName(col, this._dbType);
      const value = row[col];
      return `${escapedColumn} = ${this._formatValue(value)}`;
    });

    const escapedTable = SqlEscape.escapeTableName(this._tableName, this._dbType);
    const sql = `DELETE FROM ${escapedTable} WHERE ${whereClauses.join(' AND ')}`;
    
    await this._executeQuery(sql);
  }

  private _formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    
    if (typeof value === 'number') {
      return String(value);
    }
    
    if (typeof value === 'boolean') {
      if (this._dbType === 'postgresql') {
        return value ? 'TRUE' : 'FALSE';
      }
      return value ? '1' : '0';
    }
    
    return SqlEscape.safeStringLiteral(String(value), this._dbType);
  }

  private _handleUndoChanges(): void {
    this._state.changes = [];
    this._state.deletedRows.clear();
    this._state.newRows.clear();
    this._loadData();
  }

  private _updateWebview(): void {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _showError(error: string): void {
    this._panel.webview.html = this._getErrorHtml(error);
  }

  private _getHtmlForWebview(): string {
    const s = i18n.strings;
    const p = s.pagination;
    const hasChanges = this._state.changes.length > 0;
    const hasPrimaryKey = this._state.columns.some(c => c.isPrimaryKey);
    const nonce = this._getNonce();
    const safeDataJson = this._toSafeJson(this._state.data);
    const safeColumnsJson = this._toSafeJson(this._state.columns);
    const safeTableName = this._escapeHtml(this._tableName);
    const safeDatabaseName = this._escapeHtml(this._databaseName);

    const headerCells = this._state.columns.map(col => {
      const pkIcon = col.isPrimaryKey ? '<i class="codicon codicon-key" style="font-size:12px;margin-right:2px;"></i>' : '';
      const nullableIcon = col.nullable ? '' : '*';
      return `<th title="${col.type}${col.nullable ? '' : ' NOT NULL'}">${pkIcon}${this._escapeHtml(col.name)}${nullableIcon}</th>`;
    }).join('');

    const tableRows = this._state.data.map((row, rowIndex) => {
      const cells = this._state.columns.map(col => {
        const value = row[col.name];
        const displayValue = value === null 
          ? '<span class="null">NULL</span>' 
          : value === undefined 
            ? '' 
            : this._escapeHtml(String(value));
        
        const isNewRow = this._state.newRows.has(rowIndex);
        const rowClass = isNewRow ? 'new-row' : '';
        
        return `<td class="${rowClass}" 
                    data-row="${rowIndex}" 
                    data-column="${col.name}"
                    data-type="${col.type}"
                    data-nullable="${col.nullable}"
                    contenteditable="true">${displayValue}</td>`;
      }).join('');
      
      return `<tr data-row="${rowIndex}">${cells}<td class="action-cell"><button class="delete-btn" type="button" data-row="${rowIndex}"><i class="codicon codicon-trash"></i></button></td></tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this._panel.webview.cspSource} data:; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src ${this._panel.webview.cspSource} 'nonce-${nonce}' 'unsafe-inline';">
  <title>${s.dataEditor.title}</title>
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
      align-items: center;
      flex-shrink: 0;
    }
    .toolbar-btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
    }
    .toolbar-btn:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground);
    }
    .toolbar-btn:disabled {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: not-allowed;
      opacity: 0.4;
    }
    .toolbar-btn:disabled .codicon {
      opacity: 0.5;
    }
    .toolbar-btn.danger {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    }
    .toolbar-btn.danger:hover:not(:disabled) {
      background-color: var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .toolbar-btn .codicon {
      font-size: 14px;
      margin-right: 4px;
      vertical-align: middle;
    }
    .status-bar {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .status-item .codicon {
      font-size: 14px;
      vertical-align: middle;
    }
    .status-item.warning {
      color: var(--vscode-inputValidation-warningForeground, #cca700);
    }
    .legend {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }
    .legend-color.modified {
      background-color: rgba(55, 148, 255, 0.4);
    }
    .legend-color.new-row {
      background-color: rgba(137, 209, 133, 0.6);
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
      min-width: 80px;
    }
    th {
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
      font-weight: 600;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    td {
      cursor: text;
    }
    td:focus {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
      background-color: var(--vscode-editor-selectionBackground);
    }
    td.modified {
      background-color: rgba(55, 148, 255, 0.2);
      color: #ffffff;
    }
    td.new-row {
      background-color: rgba(137, 209, 133, 0.5);
      color: #ffffff;
    }
    .action-cell {
      text-align: center;
      width: 40px;
    }
    .delete-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 14px;
      opacity: 0.5;
      color: var(--vscode-foreground);
      padding: 2px 4px;
      border-radius: 3px;
    }
    .delete-btn:hover {
      opacity: 1;
      color: var(--vscode-errorForeground, #f48771);
    }
    .null {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .no-data {
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
    <button class="toolbar-btn" id="addRowBtn" type="button"><i class="codicon codicon-add"></i> ${s.dataEditor.addRow}</button>
    <button class="toolbar-btn" id="saveBtn" type="button" ${!hasChanges || !hasPrimaryKey ? 'disabled' : ''}><i class="codicon codicon-check"></i> ${s.dataEditor.save}</button>
    <button class="toolbar-btn" id="undoBtn" type="button" ${!hasChanges ? 'disabled' : ''}><i class="codicon codicon-discard"></i> ${s.dataEditor.undo}</button>
    <button class="toolbar-btn" id="refreshBtn" type="button"><i class="codicon codicon-refresh"></i> ${s.dataEditor.refresh}</button>
  </div>
  
  <div class="status-bar">
    <div class="status-item"><i class="codicon codicon-database"></i> ${s.dataEditor.table}: ${safeTableName}</div>
    <div class="status-item"><i class="codicon codicon-folder"></i> ${s.dataEditor.database}: ${safeDatabaseName}</div>
    ${hasChanges ? `<div class="status-item warning"><i class="codicon codicon-warning"></i> ${s.dataEditor.pendingChanges}: ${this._state.changes.length}</div>` : ''}
    ${!hasPrimaryKey ? `<div class="status-item warning"><i class="codicon codicon-warning"></i> ${s.dataEditor.noPrimaryKey}</div>` : ''}
  </div>

  <div class="legend">
    <div class="legend-item">
      <div class="legend-color modified"></div>
      <span>${s.dataEditor.modified}</span>
    </div>
    <div class="legend-item">
      <div class="legend-color new-row"></div>
      <span>${s.dataEditor.newRow}</span>
    </div>
    <div class="legend-item">
      <span><i class="codicon codicon-key" style="font-size:12px;"></i> = ${s.tableStructure.primaryKey}</span>
    </div>
    <div class="legend-item">
      <span>* = NOT NULL</span>
    </div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>${headerCells}<th></th></tr>
      </thead>
      <tbody id="tableBody">
        ${tableRows}
      </tbody>
    </table>
  </div>

  <div class="pagination-container">
    <span class="rows-info" id="rowsInfo">${p.showingRows} 1-${this._state.data.length} ${p.totalRows}: ${this._totalRows}</span>
    <select class="page-size-select" id="pageSizeSelect">
      ${PAGE_SIZE_OPTIONS.map(size => `<option value="${size}" ${size === this._pageSize ? 'selected' : ''}>${size} ${p.rowsPerPage}</option>`).join('')}
    </select>
    <button class="pagination-btn" id="firstBtn" type="button">${p.first}</button>
    <button class="pagination-btn" id="prevBtn" type="button">${p.previous}</button>
    <span class="page-info">${p.goTo} <input type="number" class="page-input" id="pageInput" value="${this._currentPage}" min="1" max="${this._totalPages}">/${this._totalPages}${p.pageUnit}</span>
    <button class="pagination-btn" id="nextBtn" type="button">${p.next}</button>
    <button class="pagination-btn" id="lastBtn" type="button">${p.last}</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let originalData = ${safeDataJson};
    let columns = ${safeColumnsJson};
    let currentPage = ${this._currentPage};
    let totalPages = ${this._totalPages};
    let totalRows = ${this._totalRows};
    let pageSize = ${this._pageSize};

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

    function updatePaginationButtons() {
      document.getElementById('firstBtn').disabled = currentPage === 1;
      document.getElementById('prevBtn').disabled = currentPage === 1;
      document.getElementById('nextBtn').disabled = currentPage === totalPages;
      document.getElementById('lastBtn').disabled = currentPage === totalPages;
      
      const startIdx = (currentPage - 1) * pageSize + 1;
      const endIdx = Math.min(currentPage * pageSize, totalRows);
      document.getElementById('rowsInfo').textContent = '${p.showingRows} ' + startIdx + '-' + endIdx + ' ${p.totalRows}: ' + totalRows;
    }

    updatePaginationButtons();

    document.getElementById('addRowBtn').addEventListener('click', addRow);
    document.getElementById('saveBtn').addEventListener('click', saveChanges);
    document.getElementById('undoBtn').addEventListener('click', undoChanges);
    document.getElementById('refreshBtn').addEventListener('click', refresh);
    document.getElementById('firstBtn').addEventListener('click', goToFirst);
    document.getElementById('prevBtn').addEventListener('click', goToPrev);
    document.getElementById('nextBtn').addEventListener('click', goToNext);
    document.getElementById('lastBtn').addEventListener('click', goToLast);
    document.getElementById('pageInput').addEventListener('change', function() {
      goToPage(this.value);
    });
    document.getElementById('pageSizeSelect').addEventListener('change', function() {
      changePageSize(this.value);
    });
    document.getElementById('tableBody').addEventListener('click', function(event) {
      const target = event.target;
      const button = target && target.closest ? target.closest('.delete-btn') : null;
      if (!button) {
        return;
      }
      const rowIndex = parseInt(button.dataset.row, 10);
      if (Number.isNaN(rowIndex)) {
        return;
      }
      deleteRow(rowIndex);
    });

    document.querySelectorAll('td[contenteditable="true"]').forEach(cell => {
      cell.addEventListener('blur', function() {
        const rowIndex = parseInt(this.dataset.row);
        const column = this.dataset.column;
        const oldValue = originalData[rowIndex]?.[column];
        let newValue = this.textContent.trim();
        
        if (newValue === 'NULL') {
          newValue = null;
        }
        
        if (newValue !== 'NULL' && newValue !== null) {
          const nullSpan = this.querySelector('span.null');
          if (nullSpan) {
            this.textContent = newValue;
          }
        }
        
        if (oldValue !== newValue) {
          this.classList.add('modified');
          vscode.postMessage({
            command: 'cellEdit',
            rowIndex: rowIndex,
            column: column,
            oldValue: oldValue,
            newValue: newValue
          });
        }
      });

      cell.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.blur();
        }
        if (e.key === 'Escape') {
          const rowIndex = parseInt(this.dataset.row);
          const column = this.dataset.column;
          this.textContent = originalData[rowIndex]?.[column] ?? '';
          this.blur();
        }
      });
      
      cell.addEventListener('focus', function() {
        const nullSpan = this.querySelector('span.null');
        if (nullSpan) {
          const range = document.createRange();
          range.selectNodeContents(nullSpan);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    });

    function addRow() {
      vscode.postMessage({ command: 'addRow' });
    }

    function deleteRow(rowIndex) {
      vscode.postMessage({ 
        command: 'deleteRow',
        rowIndex: rowIndex 
      });
    }

    function saveChanges() {
      vscode.postMessage({ command: 'saveChanges' });
    }

    function undoChanges() {
      vscode.postMessage({ command: 'undoChanges' });
    }

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function goToPage(page) {
      const newPage = parseInt(page);
      if (newPage >= 1 && newPage <= totalPages) {
        vscode.postMessage({ command: 'goToPage', page: newPage });
      } else {
        document.getElementById('pageInput').value = currentPage;
      }
    }

    function goToFirst() {
      goToPage(1);
    }

    function goToPrev() {
      if (currentPage > 1) {
        goToPage(currentPage - 1);
      }
    }

    function goToNext() {
      if (currentPage < totalPages) {
        goToPage(currentPage + 1);
      }
    }

    function goToLast() {
      goToPage(totalPages);
    }

    function changePageSize(newSize) {
      vscode.postMessage({ command: 'changePageSize', pageSize: parseInt(newSize) });
    }
  </script>
</body>
</html>`;
  }

  private _getErrorHtml(error: string): string {
    const s = i18n.strings;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline';">
  <title>${s.dataEditor.title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .error {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      padding: 16px;
      border-radius: 4px;
      color: var(--vscode-inputValidation-errorForeground, #ffffff);
    }
    .error-title {
      font-weight: bold;
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="error">
    <div class="error-title">${s.tableStructure.error}:</div>
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
    DataEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
