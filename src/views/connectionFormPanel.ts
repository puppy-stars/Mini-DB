import * as vscode from 'vscode';
import { ConnectionConfig } from '../models/types';
import { ConnectionManager } from '../managers/connectionManager';
import { i18n } from '../i18n';

export class ConnectionFormPanel {
  public static currentPanel: ConnectionFormPanel | undefined;
  public static readonly viewType = 'minidb.connectionForm';

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _onSave: ((config: ConnectionConfig) => void) | undefined;
  private _existingConfig?: ConnectionConfig;

  public static createOrShow(
    extensionUri: vscode.Uri,
    connectionManager: ConnectionManager,
    existingConfig?: ConnectionConfig
  ): ConnectionFormPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ConnectionFormPanel.currentPanel) {
      ConnectionFormPanel.currentPanel._panel.dispose();
    }

    const s = i18n.strings;
    const panel = vscode.window.createWebviewPanel(
      ConnectionFormPanel.viewType,
      existingConfig ? s.connectionForm.editTitle : s.connectionForm.addTitle,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    ConnectionFormPanel.currentPanel = new ConnectionFormPanel(
      panel,
      extensionUri,
      connectionManager,
      existingConfig
    );

    return ConnectionFormPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private connectionManager: ConnectionManager,
    existingConfig?: ConnectionConfig
  ) {
    this._panel = panel;
    this._existingConfig = existingConfig;
    this._panel.webview.html = this._getHtmlForWebview(panel.webview, existingConfig);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'save':
            await this._handleSave(message.config);
            break;
          case 'test':
            await this._handleTest(message.config);
            break;
          case 'cancel':
            this._panel.dispose();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  public onSave(callback: (config: ConnectionConfig) => void): void {
    this._onSave = callback;
  }

  private async _handleSave(configData: Partial<ConnectionConfig>): Promise<void> {
    const s = i18n.strings;
    try {
      const config: ConnectionConfig = {
        id: this._existingConfig?.id || this.connectionManager.generateId(),
        name: configData.name || '',
        type: configData.type || 'mysql',
        environment: configData.environment || 'dev',
        host: configData.host || 'localhost',
        port: configData.port || 3306,
        username: configData.username || '',
        password: configData.password || '',
        database: configData.database,
        ssl: configData.ssl || false,
        connectTimeout: configData.connectTimeout,
        retry: configData.retry,
        ssh: configData.ssh,
        pool: configData.pool,
        filePath: configData.filePath,
        instanceName: configData.instanceName,
        serviceName: configData.serviceName
      };

      await this.connectionManager.saveConnection(config);
      
      this._panel.webview.postMessage({
        command: 'saveResult',
        success: true,
        message: s.connectionForm.savedSuccessfully
      });

      if (this._onSave) {
        this._onSave(config);
      }

      setTimeout(() => {
        this._panel.dispose();
      }, 1000);
    } catch (error) {
      this._panel.webview.postMessage({
        command: 'saveResult',
        success: false,
        message: `${s.connectionForm.saveFailed}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private async _handleTest(configData: Partial<ConnectionConfig>): Promise<void> {
    const s = i18n.strings;
    try {
      const config: ConnectionConfig = {
        id: this._existingConfig?.id || 'test_connection',
        name: configData.name || 'Test',
        type: configData.type || 'mysql',
        environment: configData.environment || 'dev',
        host: configData.host || 'localhost',
        port: configData.port || 3306,
        username: configData.username || '',
        password: configData.password || '',
        database: configData.database,
        ssl: configData.ssl || false,
        connectTimeout: configData.connectTimeout,
        retry: configData.retry,
        ssh: configData.ssh,
        pool: configData.pool,
        filePath: configData.filePath,
        instanceName: configData.instanceName,
        serviceName: configData.serviceName
      };

      await this.connectionManager.testConnection(config);

      this._panel.webview.postMessage({
        command: 'testResult',
        success: true,
        message: s.connectionForm.connectionSuccessful
      });
    } catch (error) {
      this._panel.webview.postMessage({
        command: 'testResult',
        success: false,
        message: `${s.connectionForm.connectionFailed}: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, existingConfig?: ConnectionConfig): string {
    const s = i18n.strings;
    const nonce = this._getNonce();
    const esc = (value: unknown) => this._escapeHtml(String(value ?? ''));
    const jsEsc = (value: string) => this._escapeJsString(value);
    const getPortByType = (type?: string): number => {
      switch (type) {
        case 'postgresql': return 5432;
        case 'sqlserver': return 1433;
        case 'oracle': return 1521;
        case 'sqlite': return 0;
        default: return 3306;
      }
    };
    const defaultPort = getPortByType(existingConfig?.type);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline';">
  <title>${existingConfig ? s.connectionForm.editTitle : s.connectionForm.addTitle}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    html, body {
      height: 100%;
      width: 100%;
      overflow: auto;
    }
    
    body {
      font-family: var(--vscode-font-family);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 20px 0;
    }
    
    .container {
      width: 100%;
      max-width: 650px;
      padding: 20px;
      margin: auto;
    }
    
    h1 {
      font-size: 1.5em;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    h2 {
      font-size: 1em;
      font-weight: 600;
      margin-top: 20px;
      margin-bottom: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: var(--vscode-foreground);
    }
    
    .hint {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    
    input[type="text"],
    input[type="number"],
    input[type="password"],
    select {
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      outline: none;
    }
    
    input[type="text"]:focus,
    input[type="number"]:focus,
    input[type="password"]:focus,
    select:focus {
      border-color: var(--vscode-focusBorder);
    }
    
    select {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23ccc' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 36px;
    }
    
    select option {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .checkbox-group input[type="checkbox"] {
      cursor: pointer;
    }
    
    .row {
      display: flex;
      gap: 16px;
    }
    
    .row .form-group {
      flex: 1;
    }
    
    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    
    button {
      padding: 8px 20px;
      font-size: 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground);
    }
    
    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .btn-secondary:hover:not(:disabled) {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    
    .btn-test {
      background-color: #0e639c;
      color: white;
    }
    
    .btn-test:hover:not(:disabled) {
      background-color: #1177bb;
    }
    
    .message {
      padding: 10px 14px;
      border-radius: 4px;
      margin-top: 16px;
      display: none;
    }
    
    .message.show {
      display: block;
    }
    
    .message.success {
      background-color: rgba(0, 128, 0, 0.2);
      border: 1px solid rgba(0, 128, 0, 0.5);
      color: #4ec94e;
    }
    
    .message.error {
      background-color: rgba(255, 0, 0, 0.2);
      border: 1px solid rgba(255, 0, 0, 0.5);
      color: #ff6b6b;
    }
    
    .loading {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 1s linear infinite;
      margin-right: 6px;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .required::after {
      content: ' *';
      color: #ff6b6b;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${existingConfig ? s.connectionForm.editTitle : s.connectionForm.addTitle}</h1>
    
    <form id="connectionForm">
      <div class="form-group">
        <label for="dbType" class="required">${s.connectionForm.dbType}</label>
        <select id="dbType" name="type">
          <option value="mysql" ${!existingConfig || existingConfig.type === 'mysql' ? 'selected' : ''}>MySQL</option>
          <option value="postgresql" ${existingConfig?.type === 'postgresql' ? 'selected' : ''}>PostgreSQL</option>
          <option value="sqlite" ${existingConfig?.type === 'sqlite' ? 'selected' : ''}>SQLite</option>
          <option value="sqlserver" ${existingConfig?.type === 'sqlserver' ? 'selected' : ''}>SQL Server</option>
          <option value="oracle" ${existingConfig?.type === 'oracle' ? 'selected' : ''}>Oracle</option>
        </select>
      </div>
      
      <div class="form-group">
        <label for="name" class="required">${s.connectionForm.connectionName}</label>
        <input type="text" id="name" name="name" placeholder="My Database" 
          value="${esc(existingConfig?.name)}" required>
        <div class="hint">${s.connectionForm.connectionNameHint}</div>
      </div>

      <div class="form-group">
        <label for="environment">${i18n.language === 'zh' ? '环境标签' : 'Environment'}</label>
        <select id="environment" name="environment">
          <option value="dev" ${!existingConfig?.environment || existingConfig.environment === 'dev' ? 'selected' : ''}>DEV</option>
          <option value="test" ${existingConfig?.environment === 'test' ? 'selected' : ''}>TEST</option>
          <option value="prod" ${existingConfig?.environment === 'prod' ? 'selected' : ''}>PROD</option>
        </select>
        <div class="hint">${i18n.language === 'zh' ? '用于首页颜色提示和高风险 SQL 保护' : 'Used for home color cues and risky SQL protection'}</div>
      </div>
      
      <div id="sqlite-file-field" class="form-group" style="display: ${existingConfig?.type === 'sqlite' ? 'block' : 'none'}">
        <label for="filePath" class="required">Database File Path</label>
        <input type="text" id="filePath" name="filePath" placeholder="/path/to/database.db"
          value="${esc(existingConfig?.filePath)}">
        <div class="hint">Path to SQLite database file (will be created if not exists)</div>
      </div>
      
      <div id="network-fields" style="display: ${existingConfig?.type === 'sqlite' ? 'none' : 'block'}">
        <div class="row">
          <div class="form-group">
            <label for="host" class="required">${s.connectionForm.host}</label>
            <input type="text" id="host" name="host" placeholder="localhost" 
              value="${esc(existingConfig?.host || 'localhost')}" required>
          </div>
          <div class="form-group" style="flex: 0 0 120px;">
            <label for="port" class="required">${s.connectionForm.port}</label>
            <input type="number" id="port" name="port" placeholder="3306" 
              value="${existingConfig?.port || defaultPort}" required>
          </div>
        </div>
      </div>
      
      <div id="sqlserver-instance-field" class="form-group" style="display: ${existingConfig?.type === 'sqlserver' ? 'block' : 'none'}">
        <label for="instanceName">Instance Name (Optional)</label>
        <input type="text" id="instanceName" name="instanceName" placeholder="SQLEXPRESS"
          value="${esc(existingConfig?.instanceName)}">
        <div class="hint">SQL Server instance name (leave empty for default instance)</div>
      </div>
      
      <div id="oracle-service-field" class="form-group" style="display: ${existingConfig?.type === 'oracle' ? 'block' : 'none'}">
        <label for="serviceName">Service Name</label>
        <input type="text" id="serviceName" name="serviceName" placeholder="ORCL"
          value="${esc(existingConfig?.serviceName)}">
        <div class="hint">Oracle service name (SID or Service Name)</div>
      </div>
      
      <div id="auth-fields" style="display: ${existingConfig?.type === 'sqlite' ? 'none' : 'block'}">
        <div class="form-group">
          <label for="username" class="required">${s.connectionForm.username}</label>
          <input type="text" id="username" name="username" placeholder="root" 
            value="${esc(existingConfig?.username || 'root')}" required>
        </div>
        
        <div class="form-group">
          <label for="password">${s.connectionForm.password}</label>
          <input type="password" id="password" name="password" placeholder="Enter password"
            value="${esc(existingConfig?.password)}">
        </div>
        
        <div class="form-group">
          <label for="database">${s.connectionForm.database}</label>
          <input type="text" id="database" name="database" placeholder="Leave empty to list all databases"
            value="${esc(existingConfig?.database)}">
          <div class="hint">${s.connectionForm.databaseHint}</div>
        </div>
        
        <div class="form-group">
          <div class="checkbox-group">
            <input type="checkbox" id="ssl" name="ssl" ${existingConfig?.ssl ? 'checked' : ''}>
            <label for="ssl">${s.connectionForm.useSsl}</label>
          </div>
        </div>
      </div>
      
      <h2>${s.connectionForm.advancedSettings}</h2>
      
      <div class="form-group">
        <label for="connectTimeout">${s.connectionForm.connectTimeout}</label>
        <input type="number" id="connectTimeout" name="connectTimeout" placeholder="30000"
          value="${esc(existingConfig?.connectTimeout)}">
        <div class="hint">${s.connectionForm.connectTimeoutHint}</div>
      </div>
      
      <h2>${s.connectionForm.retrySettings}</h2>
      
      <div class="row">
        <div class="form-group">
          <label for="maxRetries">${s.connectionForm.maxRetries}</label>
          <input type="number" id="maxRetries" name="maxRetries" placeholder="3"
            value="${esc(existingConfig?.retry?.maxRetries)}" min="0" max="10">
        </div>
        <div class="form-group">
          <label for="retryDelay">${s.connectionForm.retryDelay}</label>
          <input type="number" id="retryDelay" name="retryDelay" placeholder="1000"
            value="${esc(existingConfig?.retry?.retryDelayMs)}" min="0">
        </div>
      </div>
      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="exponentialBackoff" name="exponentialBackoff" 
            ${existingConfig?.retry?.exponentialBackoff !== false ? 'checked' : ''}>
          <label for="exponentialBackoff">${s.connectionForm.exponentialBackoff}</label>
        </div>
      </div>
      
      <h2>${s.connectionForm.sshSettings}</h2>
      
      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="useSsh" name="useSsh" 
            ${existingConfig?.ssh ? 'checked' : ''}>
          <label for="useSsh">${s.connectionForm.useSshTunnel}</label>
        </div>
      </div>
      <div id="ssh-fields" style="display: ${existingConfig?.ssh ? 'block' : 'none'}">
        <div class="row">
          <div class="form-group">
            <label for="sshHost">${s.connectionForm.sshHost}</label>
            <input type="text" id="sshHost" name="sshHost" placeholder="ssh.example.com"
              value="${esc(existingConfig?.ssh?.host)}">
          </div>
          <div class="form-group" style="flex: 0 0 120px;">
            <label for="sshPort">${s.connectionForm.sshPort}</label>
            <input type="number" id="sshPort" name="sshPort" placeholder="22"
              value="${esc(existingConfig?.ssh?.port || 22)}">
          </div>
        </div>
        <div class="form-group">
          <label for="sshUsername">${s.connectionForm.sshUsername}</label>
          <input type="text" id="sshUsername" name="sshUsername" placeholder="sshuser"
            value="${esc(existingConfig?.ssh?.username)}">
        </div>
        <div class="form-group">
          <label for="sshPassword">${s.connectionForm.sshPassword}</label>
          <input type="password" id="sshPassword" name="sshPassword" placeholder="SSH password"
            value="${esc(existingConfig?.ssh?.password)}">
        </div>
        <div class="form-group">
          <label for="sshPrivateKey">${s.connectionForm.sshPrivateKey}</label>
          <input type="text" id="sshPrivateKey" name="sshPrivateKey" placeholder="/path/to/private/key"
            value="${esc(existingConfig?.ssh?.privateKey)}">
        </div>
        <div class="form-group">
          <label for="sshPassphrase">${s.connectionForm.sshPassphrase}</label>
          <input type="password" id="sshPassphrase" name="sshPassphrase" placeholder="Key passphrase"
            value="${esc(existingConfig?.ssh?.passphrase)}">
        </div>
      </div>
      
      <h2>${s.connectionForm.poolSettings}</h2>
      
      <div class="row">
        <div class="form-group">
          <label for="poolMax">${s.connectionForm.poolMax}</label>
          <input type="number" id="poolMax" name="poolMax" placeholder="10"
            value="${esc(existingConfig?.pool?.max)}" min="1" max="100">
        </div>
        <div class="form-group">
          <label for="poolMin">${s.connectionForm.poolMin}</label>
          <input type="number" id="poolMin" name="poolMin" placeholder="2"
            value="${esc(existingConfig?.pool?.min)}" min="0" max="50">
        </div>
      </div>
      <div class="row">
        <div class="form-group">
          <label for="poolIdleTimeout">${s.connectionForm.poolIdleTimeout}</label>
          <input type="number" id="poolIdleTimeout" name="poolIdleTimeout" placeholder="30000"
            value="${esc(existingConfig?.pool?.idleTimeoutMillis)}" min="0">
        </div>
        <div class="form-group">
          <label for="poolAcquireTimeout">${s.connectionForm.poolAcquireTimeout}</label>
          <input type="number" id="poolAcquireTimeout" name="poolAcquireTimeout" placeholder="30000"
            value="${esc(existingConfig?.pool?.acquireTimeoutMillis)}" min="0">
        </div>
      </div>
      
      <div class="message" id="message"></div>
      
      <div class="buttons">
        <button type="button" class="btn-test" id="testBtn">${s.connectionForm.testConnection}</button>
        <button type="submit" class="btn-primary" id="saveBtn">${s.connectionForm.saveConnection}</button>
        <button type="button" class="btn-secondary" id="cancelBtn">${s.connectionForm.cancel}</button>
      </div>
    </form>
  </div>
  
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const i18n = {
      fillRequired: "${jsEsc(s.connectionForm.fillRequired)}"
    };
    
    const form = document.getElementById('connectionForm');
    const testBtn = document.getElementById('testBtn');
    const saveBtn = document.getElementById('saveBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const messageDiv = document.getElementById('message');
    const dbTypeSelect = document.getElementById('dbType');
    const useSshCheckbox = document.getElementById('useSsh');
    const portInput = document.getElementById('port');
    
    let isTestLoading = false;
    let isSaveLoading = false;
    
    function toggleSshFields() {
      const useSsh = document.getElementById('useSsh').checked;
      const sshFields = document.getElementById('ssh-fields');
      sshFields.style.display = useSsh ? 'block' : 'none';
    }
    
    function toggleDbTypeFields() {
      const selectedType = dbTypeSelect.value;
      const sqliteFileField = document.getElementById('sqlite-file-field');
      const networkFields = document.getElementById('network-fields');
      const authFields = document.getElementById('auth-fields');
      const sqlserverInstanceField = document.getElementById('sqlserver-instance-field');
      const oracleServiceField = document.getElementById('oracle-service-field');
      
      const isSqlite = selectedType === 'sqlite';
      const isSqlServer = selectedType === 'sqlserver';
      const isOracle = selectedType === 'oracle';
      
      sqliteFileField.style.display = isSqlite ? 'block' : 'none';
      networkFields.style.display = isSqlite ? 'none' : 'block';
      authFields.style.display = isSqlite ? 'none' : 'block';
      sqlserverInstanceField.style.display = isSqlServer ? 'block' : 'none';
      oracleServiceField.style.display = isOracle ? 'block' : 'none';
      
      const ports = {
        'mysql': 3306,
        'postgresql': 5432,
        'sqlserver': 1433,
        'oracle': 1521,
        'sqlite': 0
      };
      portInput.value = ports[selectedType] || 3306;
    }
    
    function getFormData() {
      const dbType = dbTypeSelect.value;
      const config = {
        type: dbType,
        name: document.getElementById('name').value.trim(),
        environment: document.getElementById('environment').value
      };
      
      if (dbType === 'sqlite') {
        config.filePath = document.getElementById('filePath').value.trim();
        config.host = 'localhost';
        config.port = 0;
        config.username = '';
      } else {
        config.host = document.getElementById('host').value.trim();
        config.port = parseInt(document.getElementById('port').value, 10);
        config.username = document.getElementById('username').value.trim();
        config.password = document.getElementById('password').value;
        config.database = document.getElementById('database').value.trim() || undefined;
        config.ssl = document.getElementById('ssl').checked;
        
        if (dbType === 'sqlserver') {
          config.instanceName = document.getElementById('instanceName').value.trim() || undefined;
        }
        
        if (dbType === 'oracle') {
          config.serviceName = document.getElementById('serviceName').value.trim() || undefined;
        }
      }
      
      const connectTimeout = document.getElementById('connectTimeout').value;
      if (connectTimeout) {
        config.connectTimeout = parseInt(connectTimeout, 10);
      }
      
      const maxRetries = document.getElementById('maxRetries').value;
      const retryDelay = document.getElementById('retryDelay').value;
      if (maxRetries || retryDelay) {
        config.retry = {
          maxRetries: maxRetries ? parseInt(maxRetries, 10) : 3,
          retryDelayMs: retryDelay ? parseInt(retryDelay, 10) : 1000,
          exponentialBackoff: document.getElementById('exponentialBackoff').checked
        };
      }
      
      const useSsh = document.getElementById('useSsh').checked;
      if (useSsh) {
        const sshHost = document.getElementById('sshHost').value.trim();
        const sshPort = document.getElementById('sshPort').value;
        const sshUsername = document.getElementById('sshUsername').value.trim();
        
        if (sshHost && sshUsername) {
          config.ssh = {
            host: sshHost,
            port: sshPort ? parseInt(sshPort, 10) : 22,
            username: sshUsername,
            password: document.getElementById('sshPassword').value || undefined,
            privateKey: document.getElementById('sshPrivateKey').value.trim() || undefined,
            passphrase: document.getElementById('sshPassphrase').value || undefined
          };
        }
      }
      
      const poolMax = document.getElementById('poolMax').value;
      const poolMin = document.getElementById('poolMin').value;
      const poolIdleTimeout = document.getElementById('poolIdleTimeout').value;
      const poolAcquireTimeout = document.getElementById('poolAcquireTimeout').value;
      
      if (poolMax || poolMin || poolIdleTimeout || poolAcquireTimeout) {
        config.pool = {
          max: poolMax ? parseInt(poolMax, 10) : 10,
          min: poolMin ? parseInt(poolMin, 10) : 2,
          idleTimeoutMillis: poolIdleTimeout ? parseInt(poolIdleTimeout, 10) : 30000,
          acquireTimeoutMillis: poolAcquireTimeout ? parseInt(poolAcquireTimeout, 10) : 30000
        };
      }
      
      return config;
    }
    
    function showMessage(text, isSuccess) {
      messageDiv.textContent = text;
      messageDiv.className = 'message show ' + (isSuccess ? 'success' : 'error');
    }
    
    function hideMessage() {
      messageDiv.className = 'message';
    }
    
    function setLoading(loading, button) {
      const existingSpinner = button.querySelector('.loading');
      if (existingSpinner) {
        existingSpinner.remove();
      }
      
      if (loading) {
        button.disabled = true;
        const spinner = document.createElement('span');
        spinner.className = 'loading';
        button.insertBefore(spinner, button.firstChild);
      } else {
        button.disabled = false;
      }
    }
    
    dbTypeSelect.addEventListener('change', toggleDbTypeFields);
    useSshCheckbox.addEventListener('change', toggleSshFields);
    toggleDbTypeFields();
    toggleSshFields();
    
    testBtn.addEventListener('click', () => {
      hideMessage();
      const config = getFormData();
      
      if (!config.name) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (config.type !== 'sqlite' && (!config.host || !config.port || !config.username)) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (config.type === 'sqlite' && !config.filePath) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (isTestLoading) return;
      isTestLoading = true;
      setLoading(true, testBtn);
      
      vscode.postMessage({
        command: 'test',
        config: config
      });
    });
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      hideMessage();
      
      const config = getFormData();
      
      if (!config.name) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (config.type !== 'sqlite' && (!config.host || !config.port || !config.username)) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (config.type === 'sqlite' && !config.filePath) {
        showMessage(i18n.fillRequired, false);
        return;
      }
      
      if (isSaveLoading) return;
      isSaveLoading = true;
      setLoading(true, saveBtn);
      
      vscode.postMessage({
        command: 'save',
        config: config
      });
    });
    
    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({
        command: 'cancel'
      });
    });
    
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.command) {
        case 'testResult':
          isTestLoading = false;
          setLoading(false, testBtn);
          showMessage(message.message, message.success);
          break;
        case 'saveResult':
          isSaveLoading = false;
          setLoading(false, saveBtn);
          showMessage(message.message, message.success);
          break;
      }
    });
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

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private _escapeJsString(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  public dispose(): void {
    ConnectionFormPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
