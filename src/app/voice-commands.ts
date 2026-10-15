/**
 * Browser speech recognition for the voice option. A thin wrapper: each final
 * transcript goes to the handler, and matchIntent decides what it means.
 * Support differs by browser, so every browser call is guarded and nothing is
 * thrown out of the class. Where speech is unavailable, start() returns false
 * and the option simply stays off.
 */

interface SpeechAlternative { readonly transcript: string }
interface SpeechResult { readonly isFinal: boolean; readonly [index: number]: SpeechAlternative }
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
}
interface SpeechErrorEvent { readonly error: string }

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Errors after which the browser will not grant recognition, so there is no point retrying. */
const FATAL_ERRORS = ['not-allowed', 'service-not-allowed'];
const ERROR_LIMIT = 5;
const ERROR_WINDOW_MS = 10000;

/** The browser's recogniser constructor, or null when the browser has none. */
function constructorOrNull(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export class VoiceCommands {
  /** True when the browser exposes SpeechRecognition or webkitSpeechRecognition. */
  static get supported(): boolean {
    try {
      return constructorOrNull() !== null;
    } catch {
      return false;
    }
  }

  private readonly handler: (transcript: string) => void;
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;
  private active = false;
  private errorTimes: number[] = [];

  constructor(handler: (transcript: string) => void) {
    this.handler = handler;
  }

  /** Listening state, for the Settings label. */
  get listening(): boolean {
    return this.active;
  }

  /** Starts listening. False when the browser has no speech support or refuses to start. */
  start(): boolean {
    if (this.active) return true;
    try {
      const Ctor = constructorOrNull();
      if (!Ctor) return false;
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 3;
      recognition.onresult = (event) => this.onResult(event);
      recognition.onerror = (event) => this.onError(event);
      recognition.onend = () => this.onEnd();
      this.recognition = recognition;
      this.wanted = true;
      this.errorTimes = [];
      recognition.start();
      this.active = true;
      return true;
    } catch {
      this.wanted = false;
      this.active = false;
      return false;
    }
  }

  /** Stops listening and stops the browser from restarting it. */
  stop(): void {
    this.wanted = false;
    this.active = false;
    try {
      this.recognition?.stop();
    } catch {
      // Already stopped, so there is nothing to undo.
    }
  }

  private onResult(event: SpeechResultEvent): void {
    try {
      this.errorTimes = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const transcript = result[0]?.transcript;
        if (transcript) this.handler(transcript);
      }
    } catch (err) {
      console.warn('Voice command handler failed', err);
    }
  }

  private onError(event: SpeechErrorEvent): void {
    if (FATAL_ERRORS.includes(event.error)) {
      this.stop();
      return;
    }
    const now = Date.now();
    this.errorTimes = this.errorTimes.filter((t) => now - t <= ERROR_WINDOW_MS);
    this.errorTimes.push(now);
    if (this.errorTimes.length >= ERROR_LIMIT) this.stop();
  }

  private onEnd(): void {
    if (!this.wanted) {
      this.active = false;
      return;
    }
    // Continuous recognition stops on its own from time to time; pick it back up.
    try {
      this.recognition?.start();
    } catch {
      this.stop();
    }
  }
}
