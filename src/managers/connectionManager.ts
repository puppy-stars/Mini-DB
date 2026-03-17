import * as vscode from 'vscode';
import { ConnectionConfig, DatabaseType } from '../models/types';
import { ConnectionStorage } from '../models/connectionStorage';
import { IDatabaseProvider } from '../providers/databaseProvider';
import { MySQLProvider } from '../providers/mysqlProvider';
import { PostgreSQLProvider } from '../providers/postgresqlProvider';
import { SQLiteProvider } from '../providers/sqliteProvider';
import { SQLServerProvider } from '../providers/sqlserverProvider';
import { OracleProvider } from '../providers/oracleProvider';
import { SecretManager } from '../utils/secretManager';

export class ConnectionManager {
  private storage: ConnectionStorage;
  private activeConnections: Map<string, IDatabaseProvider> = new Map();
  private secretManager: SecretManager;

  constructor(context: vscode.ExtensionContext) {
    this.storage = new ConnectionStorage(context);
    this.secretManager = SecretManager.initialize(context);
    this.migrateSecrets();
  }

  private async migrateSecrets(): Promise<void> {
    const connections = await this.storage.getConnections();
    let needsUpdate = false;
    
    for (const conn of connections) {
      if (conn.password && !conn.passwordMigrated) {
        await this.secretManager.storePassword(conn.id, conn.password);
        delete conn.password;
        conn.passwordMigrated = true;
        needsUpdate = true;
      }

      if (conn.ssh) {
        if (conn.ssh.password) {
          await this.secretManager.storeSshSecret(conn.id, 'password', conn.ssh.password);
          delete conn.ssh.password;
          needsUpdate = true;
        }
        if (conn.ssh.privateKey) {
          await this.secretManager.storeSshSecret(conn.id, 'privateKey', conn.ssh.privateKey);
          delete conn.ssh.privateKey;
          needsUpdate = true;
        }
        if (conn.ssh.passphrase) {
          await this.secretManager.storeSshSecret(conn.id, 'passphrase', conn.ssh.passphrase);
          delete conn.ssh.passphrase;
          needsUpdate = true;
        }
      }
    }
    
    if (needsUpdate) {
      for (const conn of connections) {
        await this.storage.saveConnection(conn);
      }
    }
  }

  async getConnections(): Promise<ConnectionConfig[]> {
    return this.storage.getConnections();
  }

  async saveConnection(config: ConnectionConfig): Promise<void> {
    const configToSave: ConnectionConfig = {
      ...config,
      ssh: config.ssh ? { ...config.ssh } : undefined
    };

    if (config.password) {
      await this.secretManager.storePassword(config.id, config.password);
      configToSave.passwordMigrated = true;
    }
    delete configToSave.password;

    if (config.ssh?.password) {
      await this.secretManager.storeSshSecret(config.id, 'password', config.ssh.password);
    }
    if (configToSave.ssh) {
      delete configToSave.ssh.password;
    }

    if (config.ssh?.privateKey) {
      await this.secretManager.storeSshSecret(config.id, 'privateKey', config.ssh.privateKey);
    }
    if (configToSave.ssh) {
      delete configToSave.ssh.privateKey;
    }

    if (config.ssh?.passphrase) {
      await this.secretManager.storeSshSecret(config.id, 'passphrase', config.ssh.passphrase);
    }
    if (configToSave.ssh) {
      delete configToSave.ssh.passphrase;
    }

    await this.storage.saveConnection(configToSave);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.disconnect(connectionId);
    await this.secretManager.deletePassword(connectionId);
    await this.secretManager.deleteSshSecrets(connectionId);
    await this.storage.deleteConnection(connectionId);
  }

  async connect(connectionId: string): Promise<IDatabaseProvider> {
    const config = await this.storage.getConnection(connectionId);
    if (!config) {
      throw new Error('Connection not found');
    }

    if (this.activeConnections.has(connectionId)) {
      const existingProvider = this.activeConnections.get(connectionId)!;
      if (existingProvider.isConnected()) {
        return existingProvider;
      }
    }

    const configWithSecrets = await this.hydrateSecrets(config);
    const provider = this.createProvider(configWithSecrets);
    await provider.connect();
    this.activeConnections.set(connectionId, provider);
    
    return provider;
  }

  async disconnect(connectionId: string): Promise<void> {
    const provider = this.activeConnections.get(connectionId);
    if (provider) {
      await provider.disconnect();
      this.activeConnections.delete(connectionId);
    }
  }

  getProvider(connectionId: string): IDatabaseProvider | undefined {
    return this.activeConnections.get(connectionId);
  }

  isConnected(connectionId: string): boolean {
    const provider = this.activeConnections.get(connectionId);
    return provider?.isConnected() || false;
  }

  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.activeConnections.keys()).map(id => this.disconnect(id));
    await Promise.all(disconnectPromises);
  }

  private createProvider(config: ConnectionConfig): IDatabaseProvider {
    switch (config.type) {
      case 'mysql':
        return new MySQLProvider(config);
      case 'postgresql':
        return new PostgreSQLProvider(config);
      case 'sqlite':
        return new SQLiteProvider(config);
      case 'sqlserver':
        return new SQLServerProvider(config);
      case 'oracle':
        return new OracleProvider(config);
      default:
        throw new Error(`Unsupported database type: ${config.type}`);
    }
  }

  async testConnection(config: ConnectionConfig): Promise<void> {
    const configToTest = await this.hydrateSecrets(config);
    
    const provider = this.createProvider(configToTest);
    try {
      await provider.connect();
    } finally {
      await provider.disconnect();
    }
  }

  generateId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private async hydrateSecrets(config: ConnectionConfig): Promise<ConnectionConfig> {
    const hydrated: ConnectionConfig = {
      ...config,
      ssh: config.ssh ? { ...config.ssh } : undefined
    };

    if (!hydrated.password) {
      const password = await this.secretManager.getPassword(config.id);
      if (password) {
        hydrated.password = password;
      }
    }

    if (hydrated.ssh) {
      if (!hydrated.ssh.password) {
        const sshPassword = await this.secretManager.getSshSecret(config.id, 'password');
        if (sshPassword) {
          hydrated.ssh.password = sshPassword;
        }
      }

      if (!hydrated.ssh.privateKey) {
        const sshPrivateKey = await this.secretManager.getSshSecret(config.id, 'privateKey');
        if (sshPrivateKey) {
          hydrated.ssh.privateKey = sshPrivateKey;
        }
      }

      if (!hydrated.ssh.passphrase) {
        const sshPassphrase = await this.secretManager.getSshSecret(config.id, 'passphrase');
        if (sshPassphrase) {
          hydrated.ssh.passphrase = sshPassphrase;
        }
      }
    }

    return hydrated;
  }
}
