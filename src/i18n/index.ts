export type Language = 'en' | 'zh';

export interface I18nStrings {
  extensionName: string;
  
  commands: {
    addConnection: string;
    refreshConnections: string;
    deleteConnection: string;
    connect: string;
    disconnect: string;
    newQuery: string;
    executeQuery: string;
    refreshTables: string;
    viewTableData: string;
    editConnection: string;
    selectConnection: string;
    switchLanguage: string;
  };
  
  treeView: {
    connections: string;
    noConnections: string;
    tables: string;
    views: string;
    noTables: string;
    errorPrefix: string;
    statusConnected: string;
    statusDisconnected: string;
    statusConnecting: string;
    statusError: string;
  };
  
  connectionForm: {
    addTitle: string;
    editTitle: string;
    dbType: string;
    connectionName: string;
    connectionNameHint: string;
    host: string;
    port: string;
    username: string;
    password: string;
    database: string;
    databaseHint: string;
    useSsl: string;
    testConnection: string;
    saveConnection: string;
    cancel: string;
    testing: string;
    connectionSuccessful: string;
    connectionFailed: string;
    savedSuccessfully: string;
    saveFailed: string;
    fillRequired: string;
    advancedSettings: string;
    connectTimeout: string;
    connectTimeoutHint: string;
    retrySettings: string;
    maxRetries: string;
    retryDelay: string;
    exponentialBackoff: string;
    sshSettings: string;
    useSshTunnel: string;
    sshHost: string;
    sshPort: string;
    sshUsername: string;
    sshPassword: string;
    sshPrivateKey: string;
    sshPassphrase: string;
    poolSettings: string;
    poolMax: string;
    poolMin: string;
    poolIdleTimeout: string;
    poolAcquireTimeout: string;
  };
  
  messages: {
    connecting: string;
    connected: string;
    disconnected: string;
    deleted: string;
    confirmDelete: string;
    delete: string;
    cancel: string;
    noActiveEditor: string;
    noConnection: string;
    noConnections: string;
    selectConnection: string;
    switchedTo: string;
    executing: string;
    noQuery: string;
    loadingData: string;
    notConnected: string;
    connectFirst: string;
    connectingDb: string;
  };
  
  queryEditor: {
    connectionLabel: string;
    databaseLabel: string;
    executeHint: string;
  };
  
  statusBar: {
    noConnection: string;
    tooltip: string;
  };
  
  relationViewer: {
    title: string;
    legend: string;
    primaryKey: string;
    foreignKey: string;
    relation: string;
    tables: string;
    relations: string;
    noRelations: string;
    selectedRelation: string;
    exportImage: string;
    exportSuccess: string;
    exportFailed: string;
  };
  
  console: {
    title: string;
    inputPlaceholder: string;
    sqlModeEntered: string;
    sqlModeExited: string;
    sqlModeHint: string;
    cleared: string;
    unknownCommand: string;
    executing: string;
    queryOk: string;
    rowsReturned: string;
    error: string;
    noConnection: string;
    helpSql: string;
    helpExit: string;
    helpClear: string;
    helpHelp: string;
    helpClearHistory: string;
    historyCleared: string;
  };

  tableStructure: {
    title: string;
    error: string;
    database: string;
    columns: string;
    columnName: string;
    columnType: string;
    nullable: string;
    defaultValue: string;
    key: string;
    primaryKey: string;
    foreignKeys: string;
    referencesTable: string;
    referencesColumn: string;
    constraintName: string;
    noForeignKeys: string;
    referencedBy: string;
    fromTable: string;
    fromColumn: string;
    noReferencedBy: string;
    yes: string;
    no: string;
  };

  export: {
    csv: string;
    json: string;
    excel: string;
    xlsx: string;
    success: string;
    failed: string;
    noData: string;
  };

  dataEditor: {
    title: string;
    table: string;
    database: string;
    addRow: string;
    save: string;
    undo: string;
    refresh: string;
    modified: string;
    newRow: string;
    noData: string;
    pendingChanges: string;
    noPrimaryKey: string;
    confirmDelete: string;
    noChanges: string;
    saving: string;
    saveSuccess: string;
    saveFailed: string;
  };

  pagination: {
    page: string;
    of: string;
    rowsPerPage: string;
    first: string;
    previous: string;
    next: string;
    last: string;
    showingRows: string;
    totalRows: string;
    goTo: string;
    pageUnit: string;
  };

  loading: {
    loading: string;
    loadingData: string;
  };

  sqlIntelligence: {
    noSqlFile: string;
    formatSuccess: string;
    noActiveConnection: string;
    metadataRefreshed: string;
    keyword: string;
    function: string;
    dataType: string;
    table: string;
    column: string;
  };
}

const enStrings: I18nStrings = {
  extensionName: 'MiniDB Explorer',
  
  commands: {
    addConnection: 'Add Database Connection',
    refreshConnections: 'Refresh Connections',
    deleteConnection: 'Delete Connection',
    connect: 'Connect to Database',
    disconnect: 'Disconnect',
    newQuery: 'New Query',
    executeQuery: 'Execute Query',
    refreshTables: 'Refresh',
    viewTableData: 'View Table Data',
    editConnection: 'Edit Connection',
    selectConnection: 'Select Database Connection',
    switchLanguage: 'Switch Language'
  },
  
  treeView: {
    connections: 'Connections',
    noConnections: 'No connections. Click + to add.',
    tables: 'Tables',
    views: 'Views',
    noTables: 'No tables or views',
    errorPrefix: 'Error: ',
    statusConnected: 'Connected',
    statusDisconnected: 'Disconnected',
    statusConnecting: 'Connecting',
    statusError: 'Error'
  },
  
  connectionForm: {
    addTitle: 'Add Database Connection',
    editTitle: 'Edit Database Connection',
    dbType: 'Database Type',
    connectionName: 'Connection Name',
    connectionNameHint: 'A friendly name to identify this connection',
    host: 'Host',
    port: 'Port',
    username: 'Username',
    password: 'Password',
    database: 'Database',
    databaseHint: 'Optional: specify a default database',
    useSsl: 'Use SSL Connection',
    testConnection: 'Test Connection',
    saveConnection: 'Save Connection',
    cancel: 'Cancel',
    testing: 'Testing...',
    connectionSuccessful: 'Connection successful!',
    connectionFailed: 'Connection failed',
    savedSuccessfully: 'Connection saved successfully!',
    saveFailed: 'Failed to save',
    fillRequired: 'Please fill in all required fields',
    advancedSettings: 'Advanced Settings',
    connectTimeout: 'Connection Timeout (ms)',
    connectTimeoutHint: 'Timeout for establishing connection (default: 30000)',
    retrySettings: 'Retry Settings',
    maxRetries: 'Max Retries',
    retryDelay: 'Retry Delay (ms)',
    exponentialBackoff: 'Exponential Backoff',
    sshSettings: 'SSH Tunnel Settings',
    useSshTunnel: 'Use SSH Tunnel',
    sshHost: 'SSH Host',
    sshPort: 'SSH Port',
    sshUsername: 'SSH Username',
    sshPassword: 'SSH Password',
    sshPrivateKey: 'SSH Private Key Path',
    sshPassphrase: 'SSH Key Passphrase',
    poolSettings: 'Connection Pool Settings',
    poolMax: 'Max Connections',
    poolMin: 'Min Connections',
    poolIdleTimeout: 'Idle Timeout (ms)',
    poolAcquireTimeout: 'Acquire Timeout (ms)'
  },
  
  messages: {
    connecting: 'Connecting...',
    connected: 'Connected successfully',
    disconnected: 'Disconnected',
    deleted: 'deleted',
    confirmDelete: 'Are you sure you want to delete connection',
    delete: 'Delete',
    cancel: 'Cancel',
    noActiveEditor: 'No active editor',
    noConnection: 'No database connection selected',
    noConnections: 'No database connections. Please add a connection first.',
    selectConnection: 'Select a database connection',
    switchedTo: 'Switched to connection',
    executing: 'Executing query...',
    noQuery: 'No SQL query to execute',
    loadingData: 'Loading data from',
    notConnected: 'Not connected to database',
    connectFirst: 'Please connect first.',
    connectingDb: 'Connecting to database...'
  },
  
  queryEditor: {
    connectionLabel: 'Connection',
    databaseLabel: 'Database',
    executeHint: 'Press Ctrl+Alt+E or F9 to execute query'
  },
  
  statusBar: {
    noConnection: 'No connection',
    tooltip: 'Click to select a connection'
  },
  
  relationViewer: {
    title: 'Table Relations',
    legend: 'Legend',
    primaryKey: 'Primary Key',
    foreignKey: 'Foreign Key',
    relation: 'Relation',
    tables: 'Tables',
    relations: 'Relations',
    noRelations: 'No tables or relations found in this database',
    selectedRelation: 'Selected Relation',
    exportImage: 'Export Image',
    exportSuccess: 'Image exported successfully',
    exportFailed: 'Failed to export image'
  },
  
  console: {
    title: 'SQL Console',
    inputPlaceholder: 'Enter command or SQL...',
    sqlModeEntered: 'Entered SQL mode. Type SQL statements and press Enter to execute.',
    sqlModeExited: 'Exited SQL mode.',
    sqlModeHint: 'Type "exit" to exit SQL mode, "clear" to clear console.',
    cleared: 'Console cleared.',
    unknownCommand: 'Unknown command. Type "help" for available commands.',
    executing: 'Executing...',
    queryOk: 'Query OK',
    rowsReturned: 'rows returned',
    error: 'Error',
    noConnection: 'No database connection. Please connect first.',
    helpSql: 'Enter SQL mode to execute SQL statements',
    helpExit: 'Exit SQL mode',
    helpClear: 'Clear the console',
    helpHelp: 'Show this help message',
    helpClearHistory: 'Clear command history (persisted)',
    historyCleared: 'Command history cleared'
  },

  tableStructure: {
    title: 'Table Structure',
    error: 'Error',
    database: 'Database',
    columns: 'Columns',
    columnName: 'Column Name',
    columnType: 'Type',
    nullable: 'Nullable',
    defaultValue: 'Default Value',
    key: 'Key',
    primaryKey: 'Primary Key',
    foreignKeys: 'Foreign Keys',
    referencesTable: 'References Table',
    referencesColumn: 'References Column',
    constraintName: 'Constraint Name',
    noForeignKeys: 'No foreign keys',
    referencedBy: 'Referenced By',
    fromTable: 'From Table',
    fromColumn: 'From Column',
    noReferencedBy: 'No references from other tables',
    yes: 'Yes',
    no: 'No'
  },

  export: {
    csv: 'Export CSV',
    json: 'Export JSON',
    excel: 'Export Excel',
    xlsx: 'Export XLSX',
    success: 'Export successful',
    failed: 'Export failed',
    noData: 'No data to export'
  },

  dataEditor: {
    title: 'Edit Data',
    table: 'Table',
    database: 'Database',
    addRow: 'Add Row',
    save: 'Save',
    undo: 'Undo',
    refresh: 'Refresh',
    modified: 'Modified',
    newRow: 'New Row',
    noData: 'No data in this table',
    pendingChanges: 'Pending changes',
    noPrimaryKey: 'No primary key - editing disabled',
    confirmDelete: 'Are you sure you want to delete this row?',
    noChanges: 'No changes to save',
    saving: 'Saving changes...',
    saveSuccess: 'Changes saved successfully',
    saveFailed: 'Failed to save changes'
  },

  pagination: {
    page: 'Page',
    of: 'of',
    rowsPerPage: 'Rows per page',
    first: 'First',
    previous: 'Previous',
    next: 'Next',
    last: 'Last',
    showingRows: 'Showing rows',
    totalRows: 'Total rows',
    goTo: 'Go to',
    pageUnit: 'page'
  },

  loading: {
    loading: 'Loading...',
    loadingData: 'Loading data...'
  },

  sqlIntelligence: {
    noSqlFile: 'No SQL file is currently open',
    formatSuccess: 'SQL formatted successfully',
    noActiveConnection: 'No active database connection',
    metadataRefreshed: 'Database metadata cache refreshed',
    keyword: 'SQL Keyword',
    function: 'SQL Function',
    dataType: 'SQL Data Type',
    table: 'Table',
    column: 'Column'
  }
};

const zhStrings: I18nStrings = {
  extensionName: 'MiniDB 数据库管理器',
  
  commands: {
    addConnection: '添加数据库连接',
    refreshConnections: '刷新连接',
    deleteConnection: '删除连接',
    connect: '连接数据库',
    disconnect: '断开连接',
    newQuery: '新建查询',
    executeQuery: '执行查询',
    refreshTables: '刷新',
    viewTableData: '查看表数据',
    editConnection: '编辑连接',
    selectConnection: '选择数据库连接',
    switchLanguage: '切换语言'
  },
  
  treeView: {
    connections: '连接',
    noConnections: '暂无连接。点击 + 添加。',
    tables: '表',
    views: '视图',
    noTables: '暂无表或视图',
    errorPrefix: '错误：',
    statusConnected: '已连接',
    statusDisconnected: '未连接',
    statusConnecting: '连接中',
    statusError: '错误'
  },
  
  connectionForm: {
    addTitle: '添加数据库连接',
    editTitle: '编辑数据库连接',
    dbType: '数据库类型',
    connectionName: '连接名称',
    connectionNameHint: '用于标识此连接的友好名称',
    host: '主机',
    port: '端口',
    username: '用户名',
    password: '密码',
    database: '数据库',
    databaseHint: '可选：指定默认数据库',
    useSsl: '使用 SSL 连接',
    testConnection: '测试连接',
    saveConnection: '保存连接',
    cancel: '取消',
    testing: '测试中...',
    connectionSuccessful: '连接成功！',
    connectionFailed: '连接失败',
    savedSuccessfully: '连接保存成功！',
    saveFailed: '保存失败',
    fillRequired: '请填写所有必填项',
    advancedSettings: '高级设置',
    connectTimeout: '连接超时 (毫秒)',
    connectTimeoutHint: '建立连接的超时时间（默认：30000）',
    retrySettings: '重试设置',
    maxRetries: '最大重试次数',
    retryDelay: '重试延迟 (毫秒)',
    exponentialBackoff: '指数退避',
    sshSettings: 'SSH 隧道设置',
    useSshTunnel: '使用 SSH 隧道',
    sshHost: 'SSH 主机',
    sshPort: 'SSH 端口',
    sshUsername: 'SSH 用户名',
    sshPassword: 'SSH 密码',
    sshPrivateKey: 'SSH 私钥路径',
    sshPassphrase: 'SSH 密钥密码',
    poolSettings: '连接池设置',
    poolMax: '最大连接数',
    poolMin: '最小连接数',
    poolIdleTimeout: '空闲超时 (毫秒)',
    poolAcquireTimeout: '获取超时 (毫秒)'
  },
  
  messages: {
    connecting: '正在连接...',
    connected: '连接成功',
    disconnected: '已断开连接',
    deleted: '已删除',
    confirmDelete: '确定要删除连接',
    delete: '删除',
    cancel: '取消',
    noActiveEditor: '没有活动的编辑器',
    noConnection: '未选择数据库连接',
    noConnections: '没有数据库连接。请先添加连接。',
    selectConnection: '选择数据库连接',
    switchedTo: '已切换到连接',
    executing: '正在执行查询...',
    noQuery: '没有要执行的 SQL 查询',
    loadingData: '正在加载数据',
    notConnected: '未连接到数据库',
    connectFirst: '请先连接数据库。',
    connectingDb: '正在连接数据库...'
  },
  
  queryEditor: {
    connectionLabel: '连接',
    databaseLabel: '数据库',
    executeHint: '按 Ctrl+Alt+E 或 F9 执行查询'
  },
  
  statusBar: {
    noConnection: '未连接',
    tooltip: '点击选择连接'
  },
  
  relationViewer: {
    title: '表关系图',
    legend: '图例',
    primaryKey: '主键',
    foreignKey: '外键',
    relation: '关系',
    tables: '表',
    relations: '关系',
    noRelations: '该数据库中没有表或关系',
    selectedRelation: '选中关系',
    exportImage: '导出图片',
    exportSuccess: '图片导出成功',
    exportFailed: '图片导出失败'
  },
  
  console: {
    title: 'SQL 控制台',
    inputPlaceholder: '输入命令或 SQL...',
    sqlModeEntered: '已进入 SQL 模式。输入 SQL 语句并按回车执行。',
    sqlModeExited: '已退出 SQL 模式。',
    sqlModeHint: '输入 "exit" 退出 SQL 模式，"clear" 清空控制台。',
    cleared: '控制台已清空。',
    unknownCommand: '未知命令。输入 "help" 查看可用命令。',
    executing: '正在执行...',
    queryOk: '查询成功',
    rowsReturned: '行返回',
    error: '错误',
    noConnection: '没有数据库连接。请先连接数据库。',
    helpSql: '进入 SQL 模式执行 SQL 语句',
    helpExit: '退出 SQL 模式',
    helpClear: '清空控制台',
    helpHelp: '显示帮助信息',
    helpClearHistory: '清空命令历史（持久化保存的）',
    historyCleared: '命令历史已清空'
  },

  tableStructure: {
    title: '表结构',
    error: '错误',
    database: '数据库',
    columns: '列',
    columnName: '列名',
    columnType: '类型',
    nullable: '可空',
    defaultValue: '默认值',
    key: '键',
    primaryKey: '主键',
    foreignKeys: '外键',
    referencesTable: '引用表',
    referencesColumn: '引用列',
    constraintName: '约束名',
    noForeignKeys: '无外键',
    referencedBy: '被引用',
    fromTable: '来源表',
    fromColumn: '来源列',
    noReferencedBy: '无其他表引用此表',
    yes: '是',
    no: '否'
  },

  export: {
    csv: '导出 CSV',
    json: '导出 JSON',
    excel: '导出 Excel',
    xlsx: '导出 XLSX',
    success: '导出成功',
    failed: '导出失败',
    noData: '没有数据可导出'
  },

  dataEditor: {
    title: '编辑数据',
    table: '表',
    database: '数据库',
    addRow: '添加行',
    save: '保存',
    undo: '撤销',
    refresh: '刷新',
    modified: '已修改',
    newRow: '新行',
    noData: '此表没有数据',
    pendingChanges: '待保存更改',
    noPrimaryKey: '无主键 - 编辑已禁用',
    confirmDelete: '确定要删除此行吗？',
    noChanges: '没有更改需要保存',
    saving: '正在保存更改...',
    saveSuccess: '更改保存成功',
    saveFailed: '保存更改失败'
  },

  pagination: {
    page: '页',
    of: '/',
    rowsPerPage: '每页行数',
    first: '首页',
    previous: '上一页',
    next: '下一页',
    last: '末页',
    showingRows: '显示行',
    totalRows: '总行数',
    goTo: '前往',
    pageUnit: '页'
  },

  loading: {
    loading: '加载中...',
    loadingData: '正在加载数据...'
  },

  sqlIntelligence: {
    noSqlFile: '当前没有打开 SQL 文件',
    formatSuccess: 'SQL 格式化成功',
    noActiveConnection: '没有活动的数据库连接',
    metadataRefreshed: '数据库元数据缓存已刷新',
    keyword: 'SQL 关键字',
    function: 'SQL 函数',
    dataType: 'SQL 数据类型',
    table: '表',
    column: '列'
  }
};

export class I18n {
  private static instance: I18n;
  private _language: Language = 'en';
  private _strings: I18nStrings;
  
  private constructor() {
    this._strings = enStrings;
  }
  
  static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }
    return I18n.instance;
  }
  
  get language(): Language {
    return this._language;
  }
  
  set language(lang: Language) {
    this._language = lang;
    this._strings = lang === 'zh' ? zhStrings : enStrings;
  }
  
  get strings(): I18nStrings {
    return this._strings;
  }
  
  toggleLanguage(): Language {
    this._language = this._language === 'en' ? 'zh' : 'en';
    this._strings = this._language === 'zh' ? zhStrings : enStrings;
    return this._language;
  }
  
  t(): I18nStrings {
    return this._strings;
  }
}

export const i18n = I18n.getInstance();
