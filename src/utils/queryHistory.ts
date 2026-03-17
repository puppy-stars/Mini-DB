import * as vscode from 'vscode';

interface QueryEntry {
  id: string;
  sql: string;
  connectionId?: string;
  database?: string;
  updatedAt: number;
  favorite: boolean;
}

interface QueryHistoryStore {
  entries: QueryEntry[];
}

const STORE_KEY = 'minidb.queryHistory.v1';
const MAX_ENTRIES = 500;

export class QueryHistoryManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async addQuery(connectionId: string | undefined, database: string | undefined, sql: string): Promise<void> {
    const normalizedSql = sql.trim();
    if (!normalizedSql) {
      return;
    }

    const store = this.getStore();
    const existingIndex = store.entries.findIndex(
      entry =>
        entry.connectionId === connectionId &&
        entry.database === database &&
        entry.sql === normalizedSql
    );

    if (existingIndex >= 0) {
      const existing = store.entries[existingIndex];
      existing.updatedAt = Date.now();
      store.entries.splice(existingIndex, 1);
      store.entries.unshift(existing);
    } else {
      store.entries.unshift({
        id: this.generateId(),
        sql: normalizedSql,
        connectionId,
        database,
        updatedAt: Date.now(),
        favorite: false
      });
    }

    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }

    await this.saveStore(store);
  }

  async toggleFavorite(
    connectionId: string | undefined,
    database: string | undefined,
    sql: string
  ): Promise<boolean> {
    const normalizedSql = sql.trim();
    if (!normalizedSql) {
      return false;
    }

    const store = this.getStore();
    let entry = store.entries.find(
      item =>
        item.connectionId === connectionId &&
        item.database === database &&
        item.sql === normalizedSql
    );

    if (!entry) {
      entry = {
        id: this.generateId(),
        sql: normalizedSql,
        connectionId,
        database,
        updatedAt: Date.now(),
        favorite: false
      };
      store.entries.unshift(entry);
    }

    entry.favorite = !entry.favorite;
    entry.updatedAt = Date.now();
    store.entries = store.entries
      .filter(item => item.id !== entry!.id)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    store.entries.unshift(entry);

    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }

    await this.saveStore(store);
    return entry.favorite;
  }

  getRecent(connectionId?: string, database?: string, limit: number = 100): QueryEntry[] {
    const store = this.getStore();
    return store.entries
      .filter(entry => {
        if (connectionId && entry.connectionId !== connectionId) {
          return false;
        }
        if (database && entry.database !== database) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  getFavorites(connectionId?: string, database?: string, limit: number = 100): QueryEntry[] {
    return this.getRecent(connectionId, database, limit).filter(entry => entry.favorite);
  }

  async clearHistory(
    connectionId?: string,
    database?: string,
    includeFavorites: boolean = true
  ): Promise<number> {
    const store = this.getStore();
    const before = store.entries.length;
    store.entries = store.entries.filter(entry => {
      const inScope =
        (!connectionId || entry.connectionId === connectionId) &&
        (!database || entry.database === database);
      if (!inScope) {
        return true;
      }
      if (!includeFavorites && entry.favorite) {
        return true;
      }
      return false;
    });

    const removed = before - store.entries.length;
    if (removed > 0) {
      await this.saveStore(store);
    }
    return removed;
  }

  private getStore(): QueryHistoryStore {
    const store = this.context.globalState.get<QueryHistoryStore>(STORE_KEY);
    return store && Array.isArray(store.entries) ? store : { entries: [] };
  }

  private async saveStore(store: QueryHistoryStore): Promise<void> {
    await this.context.globalState.update(STORE_KEY, store);
  }

  private generateId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
