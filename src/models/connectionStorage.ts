import * as vscode from 'vscode';
import { ConnectionConfig, CONNECTIONS_KEY } from '../models/types';

export class ConnectionStorage {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async getConnections(): Promise<ConnectionConfig[]> {
    const connections = this.context.globalState.get<ConnectionConfig[]>(CONNECTIONS_KEY);
    return connections || [];
  }

  async saveConnection(connection: ConnectionConfig): Promise<void> {
    const connections = await this.getConnections();
    const existingIndex = connections.findIndex(c => c.id === connection.id);
    
    if (existingIndex >= 0) {
      connections[existingIndex] = connection;
    } else {
      connections.push(connection);
    }
    
    await this.context.globalState.update(CONNECTIONS_KEY, connections);
  }

  async deleteConnection(connectionId: string): Promise<void> {
    const connections = await this.getConnections();
    const filtered = connections.filter(c => c.id !== connectionId);
    await this.context.globalState.update(CONNECTIONS_KEY, filtered);
  }

  async getConnection(connectionId: string): Promise<ConnectionConfig | undefined> {
    const connections = await this.getConnections();
    return connections.find(c => c.id === connectionId);
  }
}
