import * as vscode from 'vscode';
import { TableColumn, ForeignKeyRelation } from '../models/types';
import { i18n } from '../i18n';

export class TableStructurePanel {
  public static currentPanel: TableStructurePanel | undefined;
  public static readonly viewType = 'minidb.tableStructure';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): TableStructurePanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TableStructurePanel.currentPanel) {
      TableStructurePanel.currentPanel._panel.reveal(column);
      return TableStructurePanel.currentPanel;
    }

    const s = i18n.strings;
    const panel = vscode.window.createWebviewPanel(
      TableStructurePanel.viewType,
      s.tableStructure.title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    TableStructurePanel.currentPanel = new TableStructurePanel(panel, extensionUri);
    return TableStructurePanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public updateStructure(
    tableName: string,
    databaseName: string,
    columns: TableColumn[],
    foreignKeys: ForeignKeyRelation[],
    referencedBy: ForeignKeyRelation[]
  ): void {
    const s = i18n.strings;
    this._panel.webview.html = this._getHtmlForWebview(tableName, databaseName, columns, foreignKeys, referencedBy);
    this._panel.title = `${s.tableStructure.title}: ${tableName}`;
  }

  public showError(error: string): void {
    this._panel.webview.html = this._getErrorHtml(error);
    this._panel.title = i18n.strings.tableStructure.error;
  }

  private _getHtmlForWebview(
    tableName: string,
    databaseName: string,
    columns: TableColumn[],
    foreignKeys: ForeignKeyRelation[],
    referencedBy: ForeignKeyRelation[]
  ): string {
    const s = i18n.strings;

    const columnRows = columns.map(col => {
      const keyIcon = col.isPrimaryKey ? '[PK]' : '';
      const nullableText = col.nullable ? s.tableStructure.yes : s.tableStructure.no;
      const defaultValue = col.defaultValue !== null ? this._escapeHtml(col.defaultValue) : '<span class="null">NULL</span>';
      
      return `<tr>
        <td>${keyIcon} ${this._escapeHtml(col.name)}</td>
        <td>${this._escapeHtml(col.type)}</td>
        <td>${nullableText}</td>
        <td>${defaultValue}</td>
        <td>${col.isPrimaryKey ? `<span class="badge pk">${s.tableStructure.primaryKey}</span>` : ''}</td>
      </tr>`;
    }).join('');

    const fkRows = foreignKeys.length > 0 ? foreignKeys.map(fk => {
      return `<tr>
        <td>${this._escapeHtml(fk.fromColumn)}</td>
        <td>${this._escapeHtml(fk.toTable)}</td>
        <td>${this._escapeHtml(fk.toColumn)}</td>
        <td>${this._escapeHtml(fk.constraintName)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="no-data">${s.tableStructure.noForeignKeys}</td></tr>`;

    const refByRows = referencedBy.length > 0 ? referencedBy.map(ref => {
      return `<tr>
        <td>${this._escapeHtml(ref.fromTable)}</td>
        <td>${this._escapeHtml(ref.fromColumn)}</td>
        <td>${this._escapeHtml(ref.toColumn)}</td>
        <td>${this._escapeHtml(ref.constraintName)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="no-data">${s.tableStructure.noReferencedBy}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline';">
  <title>${s.tableStructure.title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 15px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .header {
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0 0 5px 0;
      font-size: 1.5em;
    }
    .header .database {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      font-size: 1.1em;
      font-weight: 600;
      margin-bottom: 10px;
      padding-bottom: 5px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .table-container {
      overflow-x: auto;
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
    .no-data {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .badge.pk {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .stats {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-top: 5px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${this._escapeHtml(tableName)}</h1>
    <div class="database">${s.tableStructure.database}: ${this._escapeHtml(databaseName)}</div>
  </div>

  <div class="section">
    <div class="section-title">${s.tableStructure.columns} (${columns.length})</div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>${s.tableStructure.columnName}</th>
            <th>${s.tableStructure.columnType}</th>
            <th>${s.tableStructure.nullable}</th>
            <th>${s.tableStructure.defaultValue}</th>
            <th>${s.tableStructure.key}</th>
          </tr>
        </thead>
        <tbody>
          ${columnRows}
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-title">${s.tableStructure.foreignKeys} (${foreignKeys.length})</div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>${s.tableStructure.columnName}</th>
            <th>${s.tableStructure.referencesTable}</th>
            <th>${s.tableStructure.referencesColumn}</th>
            <th>${s.tableStructure.constraintName}</th>
          </tr>
        </thead>
        <tbody>
          ${fkRows}
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-title">${s.tableStructure.referencedBy} (${referencedBy.length})</div>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>${s.tableStructure.fromTable}</th>
            <th>${s.tableStructure.fromColumn}</th>
            <th>${s.tableStructure.referencesColumn}</th>
            <th>${s.tableStructure.constraintName}</th>
          </tr>
        </thead>
        <tbody>
          ${refByRows}
        </tbody>
      </table>
    </div>
  </div>
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
  <title>${s.tableStructure.error}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 15px;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .error {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      padding: 15px;
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

  public dispose(): void {
    TableStructurePanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
