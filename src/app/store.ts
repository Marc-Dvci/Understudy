/**
 * On-device storage in IndexedDB. Nothing leaves the headset unless the user
 * exports it. When storage is unavailable (private mode, blocked site data),
 * the app keeps working in memory for the session.
 */
import { defaultProfile, Profile, SessionRecord } from '../core/records.js';

const DB = 'understudy';
const VERSION = 1;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class Store {
  private db: IDBDatabase | null = null;
  private memorySessions: SessionRecord[] = [];
  private memoryKv = new Map<string, unknown>();
  persistent = false;

  async init(): Promise<void> {
    this.db = await open();
    this.persistent = !!this.db;
  }

  private tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const db = this.db;
    if (!db) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async sessions(): Promise<SessionRecord[]> {
    if (!this.db) return [...this.memorySessions];
    const all = (await this.tx<SessionRecord[]>('sessions', 'readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => a.startedAt - b.startedAt);
  }

  async saveSession(r: SessionRecord): Promise<void> {
    if (!this.db) {
      const i = this.memorySessions.findIndex((x) => x.id === r.id);
      if (i >= 0) this.memorySessions[i] = r;
      else this.memorySessions.push(r);
      return;
    }
    await this.tx('sessions', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(r))));
  }

  async profile(): Promise<Profile | null> {
    const p = this.db ? await this.tx<Profile>('kv', 'readonly', (s) => s.get('profile')) : (this.memoryKv.get('profile') as Profile | undefined);
    return p ? { ...defaultProfile(), ...p } : null;
  }

  async saveProfile(p: Profile): Promise<void> {
    if (!this.db) {
      this.memoryKv.set('profile', p);
      return;
    }
    await this.tx('kv', 'readwrite', (s) => s.put(p, 'profile'));
  }

  async clear(): Promise<void> {
    this.memorySessions = [];
    this.memoryKv.clear();
    if (!this.db) return;
    await this.tx('sessions', 'readwrite', (s) => s.clear());
    await this.tx('kv', 'readwrite', (s) => s.clear());
  }
}

export const store = new Store();
