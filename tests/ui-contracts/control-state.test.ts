import { afterEach, describe, expect, it, vi } from "vitest";
import { getTranslations } from "../../src/i18n";
import { dialogCloseReducer } from "../../src/ui/state/dialog";
import { createOptionSearch, initialOptionSearch, optionSearchReducer, selectedOption, validateOptions, type OptionSearchState, type SelectOption } from "../../src/ui/state/option-search";
import { resolveToastText, toastDuration, toastReducer, type ToastNotice } from "../../src/ui/state/toast";

const options: readonly SelectOption[] = [{ id: "first", label: "First" }, { id: "locked", label: "Locked", disabled: true }];
const ready: OptionSearchState = { query: "", options, request: 2, phase: "ready" };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.useRealTimers(); });

describe("option selection contract", () => {
  it("selects only an available current option, never arbitrary text or a disabled ID", () => {
    expect(selectedOption(ready, "first")).toBe(options[0]);
    expect(selectedOption(ready, "First")).toBeUndefined();
    expect(selectedOption(ready, "locked")).toBeUndefined();
    for (const phase of ["idle", "debouncing", "loading", "error"] as const) {
      expect(selectedOption({ ...ready, phase }, "first")).toBeUndefined();
    }
  });

  it("retains prior data through search/error but ignores a stale response", () => {
    const pending = optionSearchReducer(ready, { type: "query", query: "new", request: 3, immediate: false });
    expect(pending).toEqual({ ...ready, query: "new", request: 3, phase: "debouncing" });
    expect(optionSearchReducer(pending, { type: "loaded", request: 2, options: [] })).toBe(pending);
    expect(optionSearchReducer(pending, { type: "failed", request: 3 })).toEqual({ ...pending, phase: "error" });
    expect(optionSearchReducer(pending, { type: "cancel", request: 4 })).toEqual({ ...pending, request: 4, phase: "idle" });
  });

  it("requires unique IDs and nonempty labels, allowing duplicate human labels", () => {
    expect(() => validateOptions([{ id: "a", label: "Same" }, { id: "b", label: "Same" }])).not.toThrow();
    expect(() => validateOptions([{ id: "", label: "A" }])).toThrow(TypeError);
    expect(() => validateOptions([{ id: "a", label: " " }])).toThrow(TypeError);
    expect(() => validateOptions([{ id: "a", label: "A" }, { id: "a", label: "B" }])).toThrow(TypeError);
  });
});

describe("search controller", () => {
  it("debounces to the latest query at 250ms", async () => {
    vi.useFakeTimers();
    const search = createOptionSearch();
    const loader = vi.fn(async () => options);
    search.setLoader(loader);
    search.search("a");
    await vi.advanceTimersByTimeAsync(200);
    search.search("ab");
    await vi.advanceTimersByTimeAsync(249);
    expect(loader).not.toHaveBeenCalled();
    expect(search.getSnapshot()).toMatchObject({ query: "ab", phase: "debouncing" });
    await vi.advanceTimersByTimeAsync(1);
    expect(loader).toHaveBeenCalledExactlyOnceWith("ab", expect.any(AbortSignal));
    expect(search.getSnapshot()).toMatchObject({ query: "ab", phase: "ready", options });
  });

  it("aborts an in-flight request and ignores late resolution even when the loader ignores abort", async () => {
    const first = deferred<readonly SelectOption[]>();
    const second = deferred<readonly SelectOption[]>();
    const signals: AbortSignal[] = [];
    const search = createOptionSearch();
    search.setLoader((query, signal) => { signals.push(signal); return query === "a" ? first.promise : second.promise; });
    search.search("a", true);
    search.search("b", true);
    expect(signals[0]?.aborted).toBe(true);
    second.resolve([{ id: "new", label: "New" }]);
    await flush();
    const latest = search.getSnapshot();
    first.resolve([{ id: "old", label: "Old" }]);
    await flush();
    expect(search.getSnapshot()).toBe(latest);
    expect(latest.options[0]?.id).toBe("new");
  });

  it("cancels debounce and in-flight work on close without erasing query/data", async () => {
    vi.useFakeTimers();
    const search = createOptionSearch();
    const loader = vi.fn(async () => options);
    search.setLoader(loader);
    search.search("first", true);
    await flush();
    search.search("draft");
    search.cancel();
    await vi.runAllTimersAsync();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(search.getSnapshot()).toMatchObject({ query: "draft", options, phase: "idle" });

    const pending = deferred<readonly SelectOption[]>();
    let signal: AbortSignal | undefined;
    search.setLoader((_query, inputSignal) => { signal = inputSignal; return pending.promise; });
    search.search("pending", true);
    search.cancel();
    expect(signal?.aborted).toBe(true);
    pending.reject(new Error("late failure"));
    await flush();
    expect(search.getSnapshot()).toMatchObject({ query: "pending", options, phase: "idle" });
  });

  it("retains results after failure and retries immediately without an extra debounce", async () => {
    const search = createOptionSearch();
    const loader = vi.fn().mockResolvedValueOnce(options).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce([{ id: "retry", label: "Retry" }]);
    search.setLoader(loader);
    search.search("", true);
    await flush();
    search.search("latest", true);
    await flush();
    expect(search.getSnapshot()).toMatchObject({ query: "latest", options, phase: "error" });
    expect(selectedOption(search.getSnapshot(), "first")).toBeUndefined();
    search.retry();
    expect(search.getSnapshot().phase).toBe("loading");
    await flush();
    expect(search.getSnapshot()).toMatchObject({ query: "latest", options: [{ id: "retry", label: "Retry" }], phase: "ready" });
  });

  it("refreshes active labels on a locale/source change without resetting the query or selected ID", async () => {
    const search = createOptionSearch();
    const selected: SelectOption = { id: "first", label: "First" };
    search.setLoader(async () => options);
    search.search("fi", true);
    await flush();
    const translated = [{ id: selected.id, label: "Бірінші" }];
    const loader = vi.fn(async () => translated);
    search.setLoader(loader);
    expect(search.getSnapshot()).toMatchObject({ query: "fi", options, phase: "loading" });
    await flush();
    expect(loader).toHaveBeenCalledExactlyOnceWith("fi", expect.any(AbortSignal));
    expect(selectedOption(search.getSnapshot(), selected.id)?.id).toBe(selected.id);
    expect(selected).toEqual({ id: "first", label: "First" });
    const current = search.getSnapshot();
    search.setLoader(loader);
    expect(search.getSnapshot()).toBe(current);
  });

  it("does not fetch a hidden field when its loader changes", () => {
    const search = createOptionSearch();
    const loader = vi.fn(async () => options);
    search.setLoader(loader);
    expect(search.getSnapshot()).toBe(initialOptionSearch);
    expect(loader).not.toHaveBeenCalled();
  });

  it("rejects malformed response data and exposes failure for retry", async () => {
    const search = createOptionSearch(0);
    search.setLoader(async () => [{ id: "duplicate", label: "One" }, { id: "duplicate", label: "Two" }]);
    search.search("bad");
    await flush();
    expect(search.getSnapshot()).toMatchObject({ phase: "error", options: [] });
    for (const delay of [-1, NaN, Infinity]) expect(() => createOptionSearch(delay)).toThrow(RangeError);
  });

  it("keeps stable snapshots and removes subscriptions", async () => {
    const search = createOptionSearch(0);
    const listener = vi.fn();
    const unsubscribe = search.subscribe(listener);
    search.setLoader(async () => options);
    search.search("a");
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(search.getServerSnapshot()).toBe(initialOptionSearch);
    const calls = listener.mock.calls.length;
    unsubscribe();
    search.cancel();
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("dialog close protection", () => {
  it("cannot discard a pending or unresolved effect through any close request", () => {
    for (const dirty of [true, false]) {
      expect(dialogCloseReducer("editing", { type: "request-close", dirty, blocked: true })).toBe("editing");
    }
    expect(dialogCloseReducer("confirming-discard", { type: "discard", blocked: true })).toBe("confirming-discard");
    expect(dialogCloseReducer("editing", { type: "request-close", dirty: true, blocked: false })).toBe("confirming-discard");
  });
  it("requires explicit discard after a dirty close request", () => {
    expect(dialogCloseReducer("editing", { type: "discard" })).toBe("editing");
    const warning = dialogCloseReducer("editing", { type: "request-close", dirty: true });
    expect(warning).toBe("confirming-discard");
    expect(dialogCloseReducer(warning, { type: "request-close", dirty: true })).toBe(warning);
    expect(dialogCloseReducer(warning, { type: "discard" })).toBe("closed");
  });

  it("keeps editing when confirmation is cancelled and resets on a new opening", () => {
    expect(dialogCloseReducer("confirming-discard", { type: "keep-editing" })).toBe("editing");
    expect(dialogCloseReducer("closed", { type: "open" })).toBe("editing");
    expect(dialogCloseReducer("confirming-discard", { type: "open" })).toBe("editing");
    expect(dialogCloseReducer("editing", { type: "request-close", dirty: false })).toBe("closed");
  });
});

describe("toast lifecycle", () => {
  const notice = (id: string, revision = 1): ToastNotice => ({ id, revision, title: "Saved", tone: "success", durationMs: 8000 });

  it("replaces duplicate IDs in place and preserves unrelated notices", () => {
    const first = notice("a");
    const second = notice("b");
    const state = [first, second];
    const updated = notice("a", 3);
    expect(toastReducer(state, { type: "push", notice: updated })).toEqual([updated, second]);
    expect(toastReducer(state, { type: "push", notice: notice("c") })).toHaveLength(3);
    expect(toastReducer(state, { type: "dismiss", id: "a" })).toEqual([second]);
    expect(toastReducer(state, { type: "clear" })).toEqual([]);
    expect(state).toEqual([first, second]);
  });

  it("never automatically removes errors or actions and gives other copy at least six seconds", () => {
    expect(toastDuration("error", false, 1000)).toBeNull();
    expect(toastDuration("success", true, 1000)).toBeNull();
    expect(toastDuration("info", false, null)).toBeNull();
    expect(toastDuration("success", false, 10)).toBe(6000);
    expect(toastDuration("info", false)).toBe(8000);
    expect(toastDuration("warning", false, 10000)).toBe(10000);
    for (const invalid of [-1, NaN, Infinity]) expect(() => toastDuration("info", false, invalid)).toThrow(RangeError);
  });

  it("resolves system copy at the current locale without translating user content", () => {
    const title = (locale: Parameters<typeof getTranslations>[0]) => getTranslations(locale)("common.state.saved");
    expect(resolveToastText(title, "ru")).toBe(getTranslations("ru")("common.state.saved"));
    expect(resolveToastText(title, "kk")).toBe(getTranslations("kk")("common.state.saved"));
    expect(resolveToastText(title, "en")).toBe(getTranslations("en")("common.state.saved"));
    expect(resolveToastText("My business name", "kk")).toBe("My business name");
  });
});
