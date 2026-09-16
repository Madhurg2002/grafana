import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver (required by Recharts).
class ResizeObserverStub {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
