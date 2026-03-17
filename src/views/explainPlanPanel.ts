import * as vscode from 'vscode';
import { DatabaseType, QueryResult } from '../models/types';

export class ExplainPlanPanel {
  public static currentPanel: ExplainPlanPanel | undefined;
  public static readonly viewType = 'minidb.explainPlan';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): ExplainPlanPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ExplainPlanPanel.currentPanel) {
      ExplainPlanPanel.currentPanel._panel.reveal(column);
      return ExplainPlanPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ExplainPlanPanel.viewType,
      'Execution Plan',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ExplainPlanPanel.currentPanel = new ExplainPlanPanel(panel, extensionUri);
    return ExplainPlanPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public updatePlan(
    sql: string,
    explainSql: string,
    dbType: DatabaseType,
    result: QueryResult
  ): void {
    this._panel.webview.html = this._getHtmlForWebview(sql, explainSql, dbType, result);
    this._panel.title = `Execution Plan (${dbType})`;
  }

  public showError(sql: string, error: string): void {
    this._panel.webview.html = this._getErrorHtml(sql, error);
    this._panel.title = 'Execution Plan Error';
  }

  private _getHtmlForWebview(
    sql: string,
    explainSql: string,
    dbType: DatabaseType,
    result: QueryResult
  ): string {
    const nonce = this._getNonce();
    const rows = result.rows || [];
    const hasSingleTextColumn = result.columns.length === 1;
    const textPlan = hasSingleTextColumn
      ? rows.map(row => {
        const value = row[result.columns[0]];
        return value === null || value === undefined ? '' : String(value);
      }).join('\n')
      : '';

    const tableHeaders = result.columns.map(col => `<th>${this._escapeHtml(col)}</th>`).join('');
    const tableRows = rows.map(row => {
      const cells = result.columns.map(col => {
        const value = row[col];
        return `<td>${this._escapeHtml(value === null || value === undefined ? '' : String(value))}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src ${this._panel.webview.cspSource} 'nonce-${nonce}';">
  <title>Execution Plan</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 12px;
    }
    .block {
      margin-bottom: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      overflow: hidden;
    }
    .title {
      padding: 8px 10px;
      font-weight: 600;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .content {
      padding: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--vscode-editor-font-size);
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 6px 8px;
      text-align: left;
      white-space: nowrap;
    }
    th {
      background: var(--vscode-editorGroupHeader-tabsBackground);
      position: sticky;
      top: 0;
    }
    .table-wrap {
      overflow: auto;
      max-height: 50vh;
    }
  </style>
</head>
<body>
  <div class="block">
    <div class="title">Original SQL</div>
    <div class="content">${this._escapeHtml(sql)}</div>
  </div>
  <div class="block">
    <div class="title">Explain SQL (${this._escapeHtml(dbType)})</div>
    <div class="content">${this._escapeHtml(explainSql)}</div>
  </div>
  ${hasSingleTextColumn ? `
  <div class="block">
    <div class="title">Plan Text</div>
    <div class="content">${this._escapeHtml(textPlan)}</div>
  </div>` : ''}
  <div class="block">
    <div class="title">Plan Result (${rows.length} rows)</div>
    <div class="table-wrap">
      <table>
        <thead><tr>${tableHeaders}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(sql: string, error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 12px;
    }
    .box {
      margin-bottom: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .err {
      border-color: var(--vscode-inputValidation-errorBorder, #be1100);
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #ffffff);
    }
  </style>
</head>
<body>
  <div class="box"><strong>Original SQL</strong>\n${this._escapeHtml(sql)}</div>
  <div class="box err"><strong>Error</strong>\n${this._escapeHtml(error)}</div>
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
    ExplainPlanPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
