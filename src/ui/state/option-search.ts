export type SelectOption = Readonly<{ id: string; label: string; description?: string; disabled?: boolean }>;
export type OptionLoader = (query: string, signal: AbortSignal) => Promise<readonly SelectOption[]>;
export type OptionSearchState = Readonly<{
  query: string;
  options: readonly SelectOption[];
  phase: "idle" | "debouncing" | "loading" | "ready" | "error";
  request: number;
}>;
export type OptionSearchEvent =
  | { type: "query"; query: string; request: number; immediate: boolean }
  | { type: "start"; request: number }
  | { type: "loaded"; request: number; options: readonly SelectOption[] }
  | { type: "failed"; request: number }
  | { type: "cancel"; request: number };

export const initialOptionSearch: OptionSearchState = { query: "", options: [], phase: "idle", request: 0 };

export function optionSearchReducer(state: OptionSearchState, event: OptionSearchEvent): OptionSearchState {
  if (event.type === "query") return { ...state, query: event.query, request: event.request, phase: event.immediate ? "loading" : "debouncing" };
  if (event.type === "cancel") return { ...state, request: event.request, phase: "idle" };
  if (event.request !== state.request) return state;
  if (event.type === "start") return { ...state, phase: "loading" };
  if (event.type === "loaded") return { ...state, options: event.options, phase: "ready" };
  return { ...state, phase: "error" };
}

export function selectedOption(state: OptionSearchState, id: string): SelectOption | undefined {
  if (state.phase !== "ready") return undefined;
  return state.options.find((option) => option.id === id && !option.disabled);
}

export function validateOptions(options: readonly SelectOption[]): void {
  const ids = new Set<string>();
  for (const option of options) {
    if (!option.id || !option.label.trim() || ids.has(option.id)) throw new TypeError("Options need unique IDs and nonempty labels");
    ids.add(option.id);
  }
}

export function createOptionSearch(delayMs = 250) {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("Invalid search delay");
  let state = initialOptionSearch;
  let loader: OptionLoader | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const dispatch = (event: OptionSearchEvent) => {
    const next = optionSearchReducer(state, event);
    if (next === state) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const stop = () => {
    clearTimeout(timeout);
    timeout = undefined;
    controller?.abort();
    controller = undefined;
  };
  const search = (query: string, immediate = false) => {
    stop();
    const request = state.request + 1;
    dispatch({ type: "query", query, request, immediate });
    const run = async () => {
      const currentLoader = loader;
      if (!currentLoader) return;
      const currentController = new AbortController();
      controller = currentController;
      dispatch({ type: "start", request });
      try {
        const options = await currentLoader(query, currentController.signal);
        if (currentController.signal.aborted) return;
        validateOptions(options);
        dispatch({ type: "loaded", request, options: [...options] });
      } catch {
        if (!currentController.signal.aborted) dispatch({ type: "failed", request });
      } finally {
        if (controller === currentController) controller = undefined;
      }
    };
    if (immediate || delayMs === 0) void run();
    else timeout = setTimeout(() => { timeout = undefined; void run(); }, delayMs);
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initialOptionSearch,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLoader: (next: OptionLoader) => {
      if (loader === next) return;
      loader = next;
      if (state.phase !== "idle") search(state.query, true);
    },
    search,
    retry: () => search(state.query, true),
    cancel: () => { stop(); dispatch({ type: "cancel", request: state.request + 1 }); },
  };
}
