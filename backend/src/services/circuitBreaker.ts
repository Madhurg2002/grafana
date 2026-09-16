/**
 * 3-state circuit breaker (docs/skills.md §3):
 *  - Closed: normal operation; trip to Open after 5 consecutive failures
 *    or a 3000ms timeout.
 *  - Open: reject requests for 30s; callers should serve cached fallback.
 *  - Half-Open: allow exactly 1 probe request after the 30s cooldown to
 *    verify recovery; success closes the circuit, failure re-opens it.
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  timeoutMs?: number;
  cooldownMs?: number;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

export class CircuitOpenError extends Error {
  public readonly state: CircuitState = "open";

  public constructor(message = "Circuit is open — upstream request rejected") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_COOLDOWN_MS = 30_000;

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureAt: number | null = null;
  private openedAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;

  public constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  public get currentState(): CircuitState {
    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this.cooldownMs) {
        // Transition to half-open lazily on next access/attempt.
        this.state = "half-open";
        this.probeInFlight = false;
      }
    }
    return this.state;
  }

  private probeInFlight = false;

  /**
   * Executes `fn` under breaker protection. Timeout defaults to 3000ms.
   * Throws CircuitOpenError while the breaker is open.
   */
  public async execute<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const state = this.currentState;

    if (state === "open") {
      throw new CircuitOpenError();
    }

    if (state === "half-open") {
      if (this.probeInFlight) {
        throw new CircuitOpenError("Circuit is half-open — probe already in flight");
      }
      this.probeInFlight = true;
      try {
        const result = await this.runWithTimeout(fn, timeoutMs ?? this.timeoutMs);
        this.recordSuccess();
        return result;
      } catch (error) {
        this.recordFailure();
        throw error;
      } finally {
        this.probeInFlight = false;
      }
    }

    try {
      const result = await this.runWithTimeout(fn, timeoutMs ?? this.timeoutMs);
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  public recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = null;
  }

  public recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.trip();
    }
  }

  public reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = null;
    this.lastFailureAt = null;
    this.probeInFlight = false;
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = Date.now();
  }

  private async runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Upstream request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public status(): CircuitBreakerStatus {
    return {
      state: this.currentState,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt,
      openedAt: this.openedAt,
    };
  }
}

const globalForBreaker = globalThis as unknown as { __CIRCUIT__?: CircuitBreaker };

export function getCircuitBreaker(): CircuitBreaker {
  if (!globalForBreaker.__CIRCUIT__) {
    globalForBreaker.__CIRCUIT__ = new CircuitBreaker();
  }
  return globalForBreaker.__CIRCUIT__;
}

export function setCircuitBreaker(breaker: CircuitBreaker | undefined): void {
  globalForBreaker.__CIRCUIT__ = breaker;
}
