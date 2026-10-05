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
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 2500);
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

export class Store {
  private db: IDBDatabase | null = null;
  private memorySessions: SessionRecord[] = [];
  private memoryKv = new Map<string, unknown>();
  persistent = false;
  /** Demo and sample-history visits use memory, separate from personal data. */
  sandbox = false;

  async init(options: { sandbox?: boolean } = {}): Promise<void> {
    this.db?.close();
    this.db = null;
    this.persistent = false;
    this.sandbox = !!options.sandbox;
    this.memorySessions = [];
    this.memoryKv.clear();
    if (this.sandbox) return;
    this.db = await open();
    this.persistent = !!this.db;
    if (!this.db) return;
    this.db.onversionchange = () => this.useMemory();
    try {
      const [sessions, profile] = await Promise.all([
        this.tx<SessionRecord[]>('sessions', 'readonly', (s) => s.getAll()),
        this.tx<Profile | undefined>('kv', 'readonly', (s) => s.get('profile')),
      ]);
      this.memorySessions = sessions;
      if (profile) this.memoryKv.set('profile', profile);
    } catch { this.useMemory(); }
  }

  private useMemory(): void {
    this.db?.close();
    this.db = null;
    this.persistent = false;
  }

  private tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = this.db;
    if (!db) return Promise.reject(new Error('Storage unavailable'));
    return new Promise((resolve, reject) => {
      try {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        // A successful request can still be followed by an aborted transaction.
        t.oncomplete = () => resolve(req.result);
        t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted'));
        t.onerror = () => reject(t.error ?? new Error('Storage transaction failed'));
        req.onerror = () => reject(req.error ?? new Error('Storage request failed'));
      } catch (error) { reject(error); }
    });
  }

  async sessions(): Promise<SessionRecord[]> {
    return structuredClone(this.memorySessions).sort((a, b) => a.startedAt - b.startedAt);
  }

  async saveSession(r: SessionRecord): Promise<void> {
    const copy = structuredClone(r);
    const i = this.memorySessions.findIndex((x) => x.id === r.id);
    if (i >= 0) this.memorySessions[i] = copy;
    else this.memorySessions.push(copy);
    if (this.db) {
      try { await this.tx('sessions', 'readwrite', (s) => s.put(copy)); }
      catch { this.useMemory(); }
    }
  }

  async profile(): Promise<Profile | null> {
    const p = this.memoryKv.get('profile') as Profile | undefined;
    return p ? { ...defaultProfile(), ...p } : null;
  }

  async saveProfile(p: Profile): Promise<void> {
    this.memoryKv.set('profile', structuredClone(p));
    if (this.db) {
      try { await this.tx('kv', 'readwrite', (s) => s.put(p, 'profile')); }
      catch { this.useMemory(); }
    }
  }

  async clear(): Promise<void> {
    this.memorySessions = [];
    this.memoryKv.clear();
    if (this.sandbox) return;
    if (!this.db) {
      this.db = await open();
      if (!this.db) throw new Error('Saved site data could not be erased');
      this.persistent = true;
    }
    try {
      const db = this.db;
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(['sessions', 'kv'], 'readwrite');
        t.objectStore('sessions').clear();
        t.objectStore('kv').clear();
        t.oncomplete = () => resolve();
        t.onabort = t.onerror = () => reject(t.error);
      });
    } catch (error) {
      this.useMemory();
      throw error;
    }
  }
}

export const store = new Store();
