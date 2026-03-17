import * as vscode from 'vscode';

type SSHSecretField = 'password' | 'privateKey' | 'passphrase';

export class SecretManager {
  private static instance: SecretManager;
  private secrets: vscode.SecretStorage;
  
  private constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
  }
  
  static initialize(context: vscode.ExtensionContext): SecretManager {
    if (!SecretManager.instance) {
      SecretManager.instance = new SecretManager(context);
    }
    return SecretManager.instance;
  }
  
  static getInstance(): SecretManager {
    if (!SecretManager.instance) {
      throw new Error('SecretManager not initialized. Call initialize() first.');
    }
    return SecretManager.instance;
  }
  
  private getPasswordKey(connectionId: string): string {
    return `minidb.password.${connectionId}`;
  }

  private getSshSecretKey(connectionId: string, field: SSHSecretField): string {
    return `minidb.ssh.${field}.${connectionId}`;
  }
  
  async storePassword(connectionId: string, password: string): Promise<void> {
    const key = this.getPasswordKey(connectionId);
    await this.secrets.store(key, password);
  }
  
  async getPassword(connectionId: string): Promise<string | undefined> {
    const key = this.getPasswordKey(connectionId);
    return await this.secrets.get(key);
  }
  
  async deletePassword(connectionId: string): Promise<void> {
    const key = this.getPasswordKey(connectionId);
    await this.secrets.delete(key);
  }

  async storeSshSecret(connectionId: string, field: SSHSecretField, value: string): Promise<void> {
    const key = this.getSshSecretKey(connectionId, field);
    await this.secrets.store(key, value);
  }

  async getSshSecret(connectionId: string, field: SSHSecretField): Promise<string | undefined> {
    const key = this.getSshSecretKey(connectionId, field);
    return await this.secrets.get(key);
  }

  async deleteSshSecrets(connectionId: string): Promise<void> {
    await Promise.all([
      this.secrets.delete(this.getSshSecretKey(connectionId, 'password')),
      this.secrets.delete(this.getSshSecretKey(connectionId, 'privateKey')),
      this.secrets.delete(this.getSshSecretKey(connectionId, 'passphrase'))
    ]);
  }
  
  async migratePasswordsFromGlobalState(context: vscode.ExtensionContext): Promise<void> {
    const connections = context.globalState.get<any[]>('minidb.connections') || [];
    
    for (const conn of connections) {
      if (conn.password && !conn.passwordMigrated) {
        await this.storePassword(conn.id, conn.password);
        delete conn.password;
        conn.passwordMigrated = true;
      }

      if (conn.ssh) {
        if (conn.ssh.password) {
          await this.storeSshSecret(conn.id, 'password', conn.ssh.password);
          delete conn.ssh.password;
        }
        if (conn.ssh.privateKey) {
          await this.storeSshSecret(conn.id, 'privateKey', conn.ssh.privateKey);
          delete conn.ssh.privateKey;
        }
        if (conn.ssh.passphrase) {
          await this.storeSshSecret(conn.id, 'passphrase', conn.ssh.passphrase);
          delete conn.ssh.passphrase;
        }
      }
    }
    
    await context.globalState.update('minidb.connections', connections);
  }
}
