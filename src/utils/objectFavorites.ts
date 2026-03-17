import * as vscode from 'vscode';

export type FavoriteObjectType = 'database' | 'table' | 'view';

export interface FavoriteObjectEntry {
  id: string;
  connectionId: string;
  database: string;
  objectType: FavoriteObjectType;
  objectName: string;
  updatedAt: number;
}

interface FavoriteObjectStore {
  entries: FavoriteObjectEntry[];
}

const STORE_KEY = 'minidb.objectFavorites.v1';
const MAX_ENTRIES = 500;

export class ObjectFavoritesManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getRecent(limit: number = 100, connectionId?: string): FavoriteObjectEntry[] {
    const store = this.getStore();
    return store.entries
      .filter(entry => !connectionId || entry.connectionId === connectionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  async addOrTouch(entry: Omit<FavoriteObjectEntry, 'id' | 'updatedAt'>): Promise<FavoriteObjectEntry> {
    const store = this.getStore();
    const existing = store.entries.find(item => this.isSameObject(item, entry));

    if (existing) {
      existing.updatedAt = Date.now();
      store.entries = [existing, ...store.entries.filter(item => item.id !== existing.id)];
      await this.saveStore(store);
      return existing;
    }

    const created: FavoriteObjectEntry = {
      ...entry,
      id: this.generateId(),
      updatedAt: Date.now()
    };
    store.entries = [created, ...store.entries];
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(0, MAX_ENTRIES);
    }
    await this.saveStore(store);
    return created;
  }

  async remove(entry: Omit<FavoriteObjectEntry, 'id' | 'updatedAt'>): Promise<boolean> {
    const store = this.getStore();
    const before = store.entries.length;
    store.entries = store.entries.filter(item => !this.isSameObject(item, entry));
    const changed = store.entries.length !== before;
    if (changed) {
      await this.saveStore(store);
    }
    return changed;
  }

  async removeById(id: string): Promise<boolean> {
    const store = this.getStore();
    const before = store.entries.length;
    store.entries = store.entries.filter(item => item.id !== id);
    const changed = store.entries.length !== before;
    if (changed) {
      await this.saveStore(store);
    }
    return changed;
  }

  async clear(connectionId?: string): Promise<number> {
    const store = this.getStore();
    const before = store.entries.length;
    store.entries = connectionId
      ? store.entries.filter(entry => entry.connectionId !== connectionId)
      : [];
    const removed = before - store.entries.length;
    if (removed > 0) {
      await this.saveStore(store);
    }
    return removed;
  }

  private isSameObject(
    left: Pick<FavoriteObjectEntry, 'connectionId' | 'database' | 'objectType' | 'objectName'>,
    right: Pick<FavoriteObjectEntry, 'connectionId' | 'database' | 'objectType' | 'objectName'>
  ): boolean {
    return (
      left.connectionId === right.connectionId &&
      left.database === right.database &&
      left.objectType === right.objectType &&
      left.objectName.toLowerCase() === right.objectName.toLowerCase()
    );
  }

  private getStore(): FavoriteObjectStore {
    const store = this.context.globalState.get<FavoriteObjectStore>(STORE_KEY);
    return store && Array.isArray(store.entries) ? store : { entries: [] };
  }

  private async saveStore(store: FavoriteObjectStore): Promise<void> {
    await this.context.globalState.update(STORE_KEY, store);
  }

  private generateId(): string {
    return `objfav_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
