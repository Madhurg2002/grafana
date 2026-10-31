import { beforeEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver (required by Recharts).
class ResizeObserverStub {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/**
 * Standards-shaped in-memory Storage (the subset of the DOM API the app uses).
 */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  public get length(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }

  public getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null;
  }

  public key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  public removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  public setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }
}

/**
 * Node 22+ installs a `localStorage` accessor on `globalThis` that resolves to
 * `undefined` unless the process runs with `--localstorage-file`. Vitest's
 * jsdom environment bridges globals from the jsdom window, but that dead Node
 * accessor wins — so `localStorage.setItem(...)` in a test (or in the session
 * code under test) throws "Cannot read properties of undefined". Install a
 * real Storage whenever the environment did not supply one.
 */
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
if (typeof globalThis.sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// Sessions must never leak between tests.
beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
});
