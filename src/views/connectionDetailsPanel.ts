import * as vscode from 'vscode';
import { i18n } from '../i18n';

export interface ConnectionDetailsColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface ConnectionDetailsTable {
  name: string;
  schema?: string;
  type: 'TABLE' | 'VIEW';
  rowCount?: number;
  columns: ConnectionDetailsColumn[];
}

export interface ConnectionDetailsDatabase {
  name: string;
  tableCount: number;
  viewCount: number;
  foreignKeyCount?: number;
  foreignKeyError?: string;
  tables: ConnectionDetailsTable[];
  error?: string;
}

export interface ConnectionDetailsRuntime {
  isConnected: boolean;
  serverVersion?: string;
  latencyMs?: number;
  healthError?: string;
  checkedAt: number;
  connectError?: string;
}

export interface ConnectionDetailsPayload {
  connectionName: string;
  connection: Record<string, unknown>;
  runtime: ConnectionDetailsRuntime;
  databases: ConnectionDetailsDatabase[];
  generatedAt: number;
}

export class ConnectionDetailsPanel {
  public static currentPanel: ConnectionDetailsPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _currentDetails: ConnectionDetailsPayload | undefined;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(_extensionUri: vscode.Uri): ConnectionDetailsPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ConnectionDetailsPanel.currentPanel) {
      ConnectionDetailsPanel.currentPanel._panel.reveal(column);
      return ConnectionDetailsPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'minidb.connectionDetails',
      i18n.language === 'zh' ? '\u8fde\u63a5\u8be6\u60c5' : 'Connection Details',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ConnectionDetailsPanel.currentPanel = new ConnectionDetailsPanel(panel);
    return ConnectionDetailsPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async message => {
        if (message.command === 'exportDiagnostics') {
          await this._exportDiagnostics(Boolean(message.masked), String(message.content ?? ''));
        }
      },
      null,
      this._disposables
    );
  }

  public update(details: ConnectionDetailsPayload): void {
    this._currentDetails = details;
    const titlePrefix = i18n.language === 'zh' ? '\u8fde\u63a5\u8be6\u60c5' : 'Connection Details';
    this._panel.title = `${titlePrefix} - ${details.connectionName}`;
    this._panel.webview.html = this._getHtmlForWebview(details);
  }

  private async _exportDiagnostics(masked: boolean, content: string): Promise<void> {
    if (!this._currentDetails) {
      return;
    }

    const safeConnectionName = this._currentDetails.connectionName
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const modeSuffix = masked ? 'masked' : 'full';
    const defaultName = `minidb-diagnostic-${safeConnectionName || 'connection'}-${modeSuffix}.json`;

    const saveUri = await vscode.window.showSaveDialog({
      saveLabel: i18n.language === 'zh' ? '\u5bfc\u51fa\u8bca\u65ad\u5305' : 'Export Diagnostics',
      filters: {
        JSON: ['json']
      },
      defaultUri: vscode.Uri.file(defaultName)
    });

    if (!saveUri) {
      return;
    }

    await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(content));
    vscode.window.showInformationMessage(
      i18n.language === 'zh' ? '\u8bca\u65ad\u5305\u5bfc\u51fa\u6210\u529f\u3002' : 'Diagnostic package exported.'
    );
  }

  private _getHtmlForWebview(details: ConnectionDetailsPayload): string {
    const nonce = this._getNonce();
    const labels = {
      title: i18n.language === 'zh' ? '\u8fde\u63a5\u8be6\u60c5' : 'Connection Details',
      connectionInfo: i18n.language === 'zh' ? '\u8fde\u63a5\u4fe1\u606f' : 'Connection Info',
      runtimeInfo: i18n.language === 'zh' ? '\u8fd0\u884c\u65f6\u4fe1\u606f' : 'Runtime Info',
      connected: i18n.language === 'zh' ? '\u5df2\u8fde\u63a5' : 'Connected',
      disconnected: i18n.language === 'zh' ? '\u672a\u8fde\u63a5' : 'Disconnected',
      serverVersion: i18n.language === 'zh' ? '\u670d\u52a1\u7aef\u7248\u672c' : 'Server Version',
      latency: i18n.language === 'zh' ? '\u5ef6\u8fdf' : 'Latency',
      healthError: i18n.language === 'zh' ? '\u5065\u5eb7\u68c0\u67e5\u9519\u8bef' : 'Health Error',
      connectError: i18n.language === 'zh' ? '\u8fde\u63a5\u9519\u8bef' : 'Connect Error',
      checkedAt: i18n.language === 'zh' ? '\u68c0\u67e5\u65f6\u95f4' : 'Checked At',
      databases: i18n.language === 'zh' ? '\u6570\u636e\u5e93\u8be6\u60c5' : 'Database Details',
      tableCount: i18n.language === 'zh' ? '\u8868\u6570\u91cf' : 'Tables',
      viewCount: i18n.language === 'zh' ? '\u89c6\u56fe\u6570\u91cf' : 'Views',
      foreignKeys: i18n.language === 'zh' ? '\u5916\u952e\u6570\u91cf' : 'Foreign Keys',
      loadError: i18n.language === 'zh' ? '\u52a0\u8f7d\u5931\u8d25' : 'Load Error',
      tables: i18n.language === 'zh' ? '\u8868/\u89c6\u56fe\u6e05\u5355' : 'Table/View List',
      type: i18n.language === 'zh' ? '\u7c7b\u578b' : 'Type',
      schema: i18n.language === 'zh' ? 'Schema' : 'Schema',
      rows: i18n.language === 'zh' ? '\u884c\u6570' : 'Rows',
      columns: i18n.language === 'zh' ? '\u5217\u6570' : 'Columns',
      generatedAt: i18n.language === 'zh' ? '\u751f\u6210\u65f6\u95f4' : 'Generated At',
      rawJson: i18n.language === 'zh' ? '\u5b8c\u6574 JSON \u6570\u636e' : 'Full JSON Data',
      exportMasked: i18n.language === 'zh' ? '\u5bfc\u51fa\u8131\u654f\u8bca\u65ad\u5305' : 'Export Masked Diagnostics',
      exportFull: i18n.language === 'zh' ? '\u5bfc\u51fa\u5b8c\u6574\u8bca\u65ad\u5305' : 'Export Full Diagnostics'
    };

    const labelsJson = this._toSafeJson(labels);
    const detailsJson = this._toSafeJson(details);

    return `<!DOCTYPE html>
<html lang="${i18n.language === 'zh' ? 'zh' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${labels.title}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }
    .action-btn {
      border: 1px solid var(--vscode-button-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background: var(--vscode-editorWidget-background);
    }
    .title {
      margin: 0 0 10px;
      font-size: 14px;
      font-weight: 600;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 6px 12px;
    }
    .kv-key {
      color: var(--vscode-descriptionForeground);
      word-break: break-word;
    }
    .kv-value {
      word-break: break-word;
    }
    .db-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .db-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background: var(--vscode-editor-background);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .db-head {
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .db-stats {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .error {
      color: var(--vscode-errorForeground);
    }
    .table-wrap {
      overflow: auto;
      max-height: 360px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 620px;
      font-size: 12px;
    }
    th, td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      text-align: left;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--vscode-editorWidget-background);
      font-weight: 600;
    }
    pre {
      margin: 0;
      max-height: 420px;
      overflow: auto;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.5;
    }
    details > summary {
      cursor: pointer;
      user-select: none;
      margin-bottom: 8px;
    }
    @media (max-width: 720px) {
      .kv-grid {
        grid-template-columns: 1fr;
      }
      table {
        min-width: 480px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="actions">
      <button class="action-btn" id="exportMaskedBtn" type="button"></button>
      <button class="action-btn" id="exportFullBtn" type="button"></button>
    </div>
    <div class="card">
      <h2 class="title" id="connectionTitle"></h2>
      <div class="kv-grid" id="connectionInfo"></div>
    </div>
    <div class="card">
      <h2 class="title" id="runtimeTitle"></h2>
      <div class="kv-grid" id="runtimeInfo"></div>
    </div>
    <div class="card">
      <h2 class="title" id="databaseTitle"></h2>
      <div class="db-list" id="databaseList"></div>
    </div>
    <div class="card">
      <details>
        <summary id="rawSummary"></summary>
        <pre id="rawJson"></pre>
      </details>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labelsJson};
    const payload = ${detailsJson};

    function formatValue(value) {
      if (value === undefined || value === null || value === '') {
        return '-';
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }

    function appendKv(container, key, value, isError) {
      const keyEl = document.createElement('div');
      keyEl.className = 'kv-key';
      keyEl.textContent = key;

      const valueEl = document.createElement('div');
      valueEl.className = 'kv-value' + (isError ? ' error' : '');
      valueEl.textContent = formatValue(value);

      container.appendChild(keyEl);
      container.appendChild(valueEl);
    }

    function renderConnectionInfo() {
      document.getElementById('connectionTitle').textContent = labels.connectionInfo;
      const container = document.getElementById('connectionInfo');
      container.innerHTML = '';

      const entries = Object.entries(payload.connection || {});
      entries.forEach(([key, value]) => appendKv(container, key, value, false));
      appendKv(container, labels.generatedAt, new Date(payload.generatedAt).toLocaleString(), false);
    }

    function renderRuntimeInfo() {
      document.getElementById('runtimeTitle').textContent = labels.runtimeInfo;
      const container = document.getElementById('runtimeInfo');
      container.innerHTML = '';
      const runtime = payload.runtime || {};

      appendKv(container, 'status', runtime.isConnected ? labels.connected : labels.disconnected, false);
      appendKv(container, labels.serverVersion, runtime.serverVersion, false);
      appendKv(container, labels.latency, runtime.latencyMs === undefined ? undefined : runtime.latencyMs + ' ms', false);
      appendKv(container, labels.checkedAt, runtime.checkedAt ? new Date(runtime.checkedAt).toLocaleString() : undefined, false);
      appendKv(container, labels.healthError, runtime.healthError, Boolean(runtime.healthError));
      appendKv(container, labels.connectError, runtime.connectError, Boolean(runtime.connectError));
    }

    function renderDatabases() {
      document.getElementById('databaseTitle').textContent = labels.databases;
      const container = document.getElementById('databaseList');
      container.innerHTML = '';

      const dbList = Array.isArray(payload.databases) ? payload.databases : [];
      if (dbList.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'kv-key';
        empty.textContent = '-';
        container.appendChild(empty);
        return;
      }

      dbList.forEach(db => {
        const dbCard = document.createElement('div');
        dbCard.className = 'db-card';

        const head = document.createElement('div');
        head.className = 'db-head';
        head.textContent = db.name;

        const stats = document.createElement('div');
        stats.className = 'db-stats';
        const fkText = db.foreignKeyCount === undefined ? '-' : db.foreignKeyCount;
        stats.textContent =
          labels.tableCount + ': ' + db.tableCount +
          ' | ' + labels.viewCount + ': ' + db.viewCount +
          ' | ' + labels.foreignKeys + ': ' + fkText;

        dbCard.appendChild(head);
        dbCard.appendChild(stats);

        if (db.error) {
          const dbErr = document.createElement('div');
          dbErr.className = 'error';
          dbErr.textContent = labels.loadError + ': ' + db.error;
          dbCard.appendChild(dbErr);
        }

        if (db.foreignKeyError) {
          const fkErr = document.createElement('div');
          fkErr.className = 'error';
          fkErr.textContent = labels.foreignKeys + ' ' + labels.loadError + ': ' + db.foreignKeyError;
          dbCard.appendChild(fkErr);
        }

        const tables = Array.isArray(db.tables) ? db.tables : [];
        if (tables.length > 0) {
          const wrap = document.createElement('div');
          wrap.className = 'table-wrap';

          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const headRow = document.createElement('tr');
          [labels.tables, labels.type, labels.schema, labels.rows, labels.columns].forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headRow.appendChild(th);
          });
          thead.appendChild(headRow);
          table.appendChild(thead);

          const tbody = document.createElement('tbody');
          tables.forEach(item => {
            const tr = document.createElement('tr');
            const colCount = Array.isArray(item.columns) ? item.columns.length : 0;
            [item.name, item.type, item.schema, item.rowCount, colCount].forEach(value => {
              const td = document.createElement('td');
              td.textContent = formatValue(value);
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });

          table.appendChild(tbody);
          wrap.appendChild(table);
          dbCard.appendChild(wrap);
        }

        container.appendChild(dbCard);
      });
    }

    function renderRawJson() {
      document.getElementById('rawSummary').textContent = labels.rawJson;
      document.getElementById('rawJson').textContent = JSON.stringify(payload, null, 2);
    }

    function maskScalarByKey(key, value) {
      const sensitiveKey = /(password|privatekey|passphrase|host|username|filepath|instance|service)/i;
      if (sensitiveKey.test(key)) {
        return '******';
      }
      return value;
    }

    function maskObject(source) {
      if (Array.isArray(source)) {
        return source.map(item => maskObject(item));
      }
      if (!source || typeof source !== 'object') {
        return source;
      }
      const result = {};
      Object.entries(source).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          result[key] = maskObject(value);
          return;
        }
        result[key] = maskScalarByKey(key, value);
      });
      return result;
    }

    function exportDiagnostics(masked) {
      const exportPayload = masked ? maskObject(payload) : payload;
      vscode.postMessage({
        command: 'exportDiagnostics',
        masked,
        content: JSON.stringify(exportPayload, null, 2)
      });
    }

    function bindActions() {
      const exportMaskedBtn = document.getElementById('exportMaskedBtn');
      const exportFullBtn = document.getElementById('exportFullBtn');
      exportMaskedBtn.textContent = labels.exportMasked;
      exportFullBtn.textContent = labels.exportFull;
      exportMaskedBtn.addEventListener('click', () => exportDiagnostics(true));
      exportFullBtn.addEventListener('click', () => exportDiagnostics(false));
    }

    bindActions();
    renderConnectionInfo();
    renderRuntimeInfo();
    renderDatabases();
    renderRawJson();
  </script>
</body>
</html>`;
  }

  private _toSafeJson(value: unknown): string {
    return JSON.stringify(value)
      .replace(/</g, '\u003c')
      .replace(/>/g, '\u003e')
      .replace(/&/g, '\u0026')
      .replace(/\u2028/g, '\u2028')
      .replace(/\u2029/g, '\u2029');
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
    ConnectionDetailsPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
