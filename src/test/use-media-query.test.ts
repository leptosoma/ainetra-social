import { describe, expect, it, vi } from "vitest";
import { desktopMediaQuery, mobileMediaQuery, subscribeMediaQuery } from "@/components/use-media-query";

// Desktop calendar regression: the first matching state must be known on the first client
// mount, without waiting for a breakpoint-crossing `change` event.
function fakeList(initial: boolean, api: "modern" | "legacy" = "modern") {
  const listeners = new Set<() => void>();
  const modern = api === "modern";
  return {
    matches: initial,
    listeners,
    set(value: boolean) { this.matches = value; listeners.forEach((listener) => listener()); },
    addEventListener: modern ? vi.fn((_: "change", l: () => void) => { listeners.add(l); }) : undefined,
    removeEventListener: modern ? vi.fn((_: "change", l: () => void) => { listeners.delete(l); }) : undefined,
    addListener: modern ? undefined : vi.fn((l: () => void) => { listeners.add(l); }),
    removeListener: modern ? undefined : vi.fn((l: () => void) => { listeners.delete(l); }),
  };
}

describe("Desktop calendar regression: useMediaQuery subscription", () => {
  it("keeps the breakpoint aligned with the CSS rule", () => {
    expect(mobileMediaQuery).toBe("(max-width: 820px)");
    expect(desktopMediaQuery).toBe("(min-width: 821px)");
  });

  it("reports true immediately on mount when the query already matches (cold desktop load)", () => {
    const list = fakeList(true);
    const onMatch = vi.fn();
    subscribeMediaQuery(desktopMediaQuery, onMatch, () => list);
    expect(onMatch).toHaveBeenCalledTimes(1);
    expect(onMatch).toHaveBeenLastCalledWith(true);
  });

  it("reports false immediately on mount when the query does not match", () => {
    const list = fakeList(false);
    const onMatch = vi.fn();
    subscribeMediaQuery(desktopMediaQuery, onMatch, () => list);
    expect(onMatch).toHaveBeenCalledTimes(1);
    expect(onMatch).toHaveBeenLastCalledWith(false);
  });

  it("follows change events after mount through the modern addEventListener API", () => {
    const list = fakeList(false);
    const onMatch = vi.fn();
    subscribeMediaQuery(desktopMediaQuery, onMatch, () => list);
    expect(list.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    list.set(true);
    list.set(false);
    expect(onMatch.mock.calls.map(([value]) => value)).toEqual([false, true, false]);
  });

  it("removes its listener on cleanup", () => {
    const list = fakeList(true);
    const onMatch = vi.fn();
    const cleanup = subscribeMediaQuery(desktopMediaQuery, onMatch, () => list);
    cleanup();
    expect(list.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(list.listeners.size).toBe(0);
    list.set(false);
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy addListener/removeListener API", () => {
    const list = fakeList(true, "legacy");
    const onMatch = vi.fn();
    const cleanup = subscribeMediaQuery(mobileMediaQuery, onMatch, () => list);
    expect(onMatch).toHaveBeenLastCalledWith(true);
    list.set(false);
    expect(onMatch).toHaveBeenLastCalledWith(false);
    cleanup();
    expect(list.removeListener).toHaveBeenCalled();
    expect(list.listeners.size).toBe(0);
  });
});
