import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Store } from '../src/app/store.js';
import { defaultProfile, SessionRecord } from '../src/core/records.js';

const record = (id: string, value = NaN): SessionRecord => ({
  id, startedAt: 100, program: 'understudy', understudy: 'left', appVersion: 'test',
  calibrationHash: 'a', metrics: { 'left:tam.index': { value, trials: [value], validShare: 0 } },
  exercises: [], completed: false,
});

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('session storage', () => {
  it('keeps sample history separate from saved personal sessions', async () => {
    const personal = new Store();
    await personal.init();
    await personal.saveSession(record('personal', 80));
    const demo = new Store();
    await demo.init({ sandbox: true });
    await demo.saveSession(record('sample', 240));
    await demo.clear();
    const reopened = new Store();
    await reopened.init();
    expect((await reopened.sessions()).map((r) => r.id)).toEqual(['personal']);
  });

  it('preserves missing measurements through an IndexedDB round trip', async () => {
    const store = new Store();
    await store.init();
    await store.saveSession(record('missing'));
    const next = new Store();
    await next.init();
    expect((await next.sessions())[0].metrics['left:tam.index'].value).toBeNaN();
  });

  it('retains history and settings in memory when a write fails', async () => {
    const store = new Store();
    await store.init();
    await store.saveSession(record('earlier', 100));
    await store.saveProfile(defaultProfile());
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await store.saveSession(record('latest', 110));
    expect(store.persistent).toBe(false);
    expect((await store.sessions()).map((r) => r.id)).toEqual(['earlier', 'latest']);
    expect((await store.profile())?.understudy).toBe('left');
  });

  it('waits for transaction commit and detects an abort after request success', async () => {
    const store = new Store();
    await store.init();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await store.saveSession(record('aborted', 90));
    expect(store.persistent).toBe(false);
    expect((await store.sessions())[0].id).toBe('aborted');
  });

  it('erases persistent data after falling back to memory', async () => {
    const store = new Store();
    await store.init();
    await store.saveSession(record('old', 90));
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Quota'); });
    await store.saveSession(record('new', 95));
    spy.mockRestore();
    await store.clear();
    const next = new Store();
    await next.init();
    expect(await next.sessions()).toEqual([]);
    expect(await next.profile()).toBeNull();
  });

  it('returns snapshots that cannot mutate saved history', async () => {
    const store = new Store();
    await store.init({ sandbox: true });
    await store.saveSession(record('a', 90));
    (await store.sessions())[0].metrics['left:tam.index'].value = 250;
    expect((await store.sessions())[0].metrics['left:tam.index'].value).toBe(90);
  });
});
