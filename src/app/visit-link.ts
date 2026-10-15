/**
 * Two-person transport for visit mode.
 *
 * One visitor hosts a four-digit room code and the other joins it. Both then
 * exchange frames from src/core/pose-codec.ts. The 'local' transport uses
 * BroadcastChannel between tabs of one origin, for automated tests. The 'peer'
 * transport uses PeerJS on its default cloud signalling server. PeerJS is
 * imported lazily, so the main bundle does not carry it.
 *
 * Each side announces a hello every 500 ms while connected and is open once it
 * has heard the other's. Repeating the hello means a frame lost on the
 * unreliable data channel cannot strand either side. Hellos are handshake only
 * and are not passed to onMessage.
 */
import { clamp } from '../core/math.js';
import { CODEC_VERSION, packMessage, unpackMessage, type VisitMessage } from '../core/pose-codec.js';
import type { DataConnection } from 'peerjs';

export type LinkState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface VisitLink {
  readonly state: LinkState;
  readonly code: string; // 4-digit room code
  readonly error: string | null; // plain-English reason when state is 'error'
  send(m: VisitMessage): void; // no-op unless open; never throws
  onMessage(fn: (m: VisitMessage) => void): () => void;
  onState(fn: (s: LinkState) => void): () => void;
  close(): void;
}

type Role = 'host' | 'joiner';
/** Writes one encoded frame. `droppable` frames may be discarded under backpressure. */
type Writer = (frame: ArrayBuffer, droppable: boolean) => void;

const ROOM_PREFIX = 'understudy-visit-';
const CONNECT_TIMEOUT_MS = 15000;
const HELLO_INTERVAL_MS = 500;
/** Unreliable-mode hands are dropped while more than this is queued unsent. */
const BUFFER_LIMIT_BYTES = 64 * 1024;
const NETWORK_ERROR = "Can't reach the visit service. Check the connection.";
const TIMEOUT_ERROR = 'No answer. Check the code.';
const LOCAL_ERROR = "This browser can't open a local visit channel.";

/** Four-digit room code, zero-padded from '0000' to '9999'. */
export function randomCode(rng: () => number = Math.random): string {
  const r = rng();
  const n = Number.isFinite(r) ? clamp(Math.floor(r * 10000), 0, 9999) : 0;
  return String(n).padStart(4, '0');
}

/** Opens the room for `code` and waits for one joiner. */
export function hostVisit(code: string, transport: 'peer' | 'local'): VisitLink {
  const link = new Link(code, 'host');
  if (transport === 'local') openLocal(link, code);
  else openPeerHost(link, code);
  return link;
}

/** Joins the room for `code`. Fails with a timeout if nobody answers. */
export function joinVisit(code: string, transport: 'peer' | 'local'): VisitLink {
  const link = new Link(code, 'joiner');
  if (transport === 'local') openLocal(link, code);
  else openPeerJoin(link, code);
  return link;
}

class Link implements VisitLink {
  readonly code: string;
  private readonly helloFrame: ArrayBuffer;
  private status: LinkState = 'connecting';
  private failure: string | null = null;
  private writer: Writer | null = null;
  private helloSeen = false;
  private readonly messageFns = new Set<(m: VisitMessage) => void>();
  private readonly stateFns = new Set<(s: LinkState) => void>();
  private readonly cleanups: (() => void)[] = [];
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, role: Role) {
    this.code = code;
    this.helloFrame = packMessage({
      t: 'hello',
      v: CODEC_VERSION,
      name: role === 'host' ? 'Host' : 'Guest',
    });
    if (role === 'joiner') {
      this.timeoutTimer = setTimeout(() => {
        this.timeoutTimer = null;
        this.finish('error', TIMEOUT_ERROR);
      }, CONNECT_TIMEOUT_MS);
    }
  }

  get state(): LinkState {
    return this.status;
  }

  get error(): string | null {
    return this.failure;
  }

  /** True once the link has closed or failed. No further transitions happen. */
  get ended(): boolean {
    return this.status === 'closed' || this.status === 'error';
  }

  send(m: VisitMessage): void {
    if (this.status !== 'open' || !this.writer) return;
    try {
      this.writer(packMessage(m), m.t === 'hands');
    } catch {
      // A frame that cannot be packed or sent is dropped; the next one replaces it.
    }
  }

  onMessage(fn: (m: VisitMessage) => void): () => void {
    this.messageFns.add(fn);
    return () => {
      this.messageFns.delete(fn);
    };
  }

  onState(fn: (s: LinkState) => void): () => void {
    this.stateFns.add(fn);
    return () => {
      this.stateFns.delete(fn);
    };
  }

  close(): void {
    if (this.ended) return;
    this.writeFrame(packMessage({ t: 'event', name: 'bye' }), false);
    this.finish('closed', null);
  }

  /** Transport hook: the channel can carry frames now. */
  attach(write: Writer): void {
    if (this.ended || this.writer) return;
    this.writer = write;
    this.announce();
    this.helloTimer = setInterval(() => this.announce(), HELLO_INTERVAL_MS);
    this.maybeOpen();
  }

  /** Transport hook: one frame arrived. Anything that is not a valid frame is ignored. */
  receive(data: unknown): void {
    if (this.ended) return;
    const buf = asArrayBuffer(data);
    const m = buf ? unpackMessage(buf) : null;
    if (!m) return;
    if (m.t === 'hello') {
      this.helloSeen = true;
      this.maybeOpen();
      return;
    }
    if (m.t === 'event' && m.name === 'bye') this.finish('closed', null);
    for (const fn of [...this.messageFns]) safely(() => fn(m));
  }

  /** Transport hook: the channel closed, normally because the other visitor left. */
  transportLost(): void {
    this.finish('closed', null);
  }

  /** Transport hook: setup or signalling failed. Ignored once the link is open. */
  fail(text: string): void {
    if (this.status === 'open') return;
    this.finish('error', text);
  }

  /** Registers a teardown step. Runs straight away if the link has already ended. */
  onCleanup(fn: () => void): void {
    if (this.ended) safely(fn);
    else this.cleanups.push(fn);
  }

  private announce(): void {
    this.writeFrame(this.helloFrame, false);
  }

  private writeFrame(frame: ArrayBuffer, droppable: boolean): void {
    if (!this.writer) return;
    try {
      this.writer(frame, droppable);
    } catch {
      // Transport errors surface through their own events. This frame is lost.
    }
  }

  private maybeOpen(): void {
    if (this.status !== 'connecting' || !this.writer || !this.helloSeen) return;
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.setStatus('open');
  }

  private finish(status: 'closed' | 'error', text: string | null): void {
    if (this.ended) return;
    this.failure = text;
    this.writer = null;
    if (this.helloTimer !== null) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.setStatus(status);
    for (const fn of this.cleanups.splice(0)) safely(fn);
  }

  private setStatus(status: LinkState): void {
    if (status === this.status) return;
    this.status = status;
    for (const fn of [...this.stateFns]) safely(() => fn(status));
  }
}

function openLocal(link: Link, code: string): void {
  const channel = openChannel(ROOM_PREFIX + code);
  if (!channel) {
    link.fail(LOCAL_ERROR);
    return;
  }
  channel.onmessage = (ev: MessageEvent) => link.receive(ev.data);
  link.onCleanup(() => channel.close());
  link.attach((frame) => channel.postMessage(frame));
}

function openChannel(name: string): BroadcastChannel | null {
  try {
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

function openPeerHost(link: Link, code: string): void {
  void loadPeer()
    .then((Peer) => {
      if (link.ended) return;
      const peer = new Peer(ROOM_PREFIX + code);
      link.onCleanup(() => peer.destroy());
      peer.on('error', (err: { type?: string }) => link.fail(peerErrorText(err.type)));
      let taken = false;
      peer.on('connection', (conn: DataConnection) => {
        // One joiner per room. A second connection is turned away.
        if (taken) {
          conn.close();
          return;
        }
        taken = true;
        wireConnection(link, conn);
      });
    })
    .catch(() => link.fail(NETWORK_ERROR));
}

function openPeerJoin(link: Link, code: string): void {
  void loadPeer()
    .then((Peer) => {
      if (link.ended) return;
      const peer = new Peer();
      link.onCleanup(() => peer.destroy());
      peer.on('error', (err: { type?: string }) => link.fail(peerErrorText(err.type)));
      peer.on('open', () => {
        if (link.ended) return;
        const conn = peer.connect(ROOM_PREFIX + code, { reliable: false, serialization: 'binary' });
        wireConnection(link, conn);
      });
    })
    .catch(() => link.fail(NETWORK_ERROR));
}

/** Lazy load keeps PeerJS out of the main bundle. */
async function loadPeer() {
  const mod = await import('peerjs');
  return mod.default;
}

function wireConnection(link: Link, conn: DataConnection): void {
  link.onCleanup(() => conn.close());
  conn.on('open', () => {
    link.attach((frame, droppable) => {
      if (droppable && (conn.dataChannel?.bufferedAmount ?? 0) > BUFFER_LIMIT_BYTES) return;
      conn.send(frame);
    });
  });
  conn.on('data', (data) => link.receive(data));
  conn.on('close', () => link.transportLost());
  conn.on('error', (err: { type?: string }) => {
    if (link.state === 'connecting') link.fail(peerErrorText(err.type));
    else link.transportLost();
  });
}

function peerErrorText(type: string | undefined): string {
  switch (type) {
    case 'unavailable-id':
      return 'That code is in use; try again.';
    case 'peer-unavailable':
      return 'No visit with that code.';
    case 'network':
    case 'server-error':
    case 'socket-error':
      return NETWORK_ERROR;
    default:
      return 'The visit connection failed.';
  }
}

/** Copies the bytes of a received frame. Anything other than binary data is rejected. */
function asArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    return copy.buffer as ArrayBuffer;
  }
  return null;
}

/** Runs a teardown step or a listener, logging rather than propagating errors. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error('visit link', err);
  }
}
