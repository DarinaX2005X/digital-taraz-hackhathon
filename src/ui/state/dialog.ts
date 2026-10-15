export type DialogCloseState = "editing" | "confirming-discard" | "closed";
export type DialogCloseEvent =
  | { type: "request-close"; dirty: boolean; blocked?: boolean }
  | { type: "keep-editing" }
  | { type: "discard"; blocked?: boolean }
  | { type: "open" };

export function dialogCloseReducer(state: DialogCloseState, event: DialogCloseEvent): DialogCloseState {
  if ((event.type === "request-close" || event.type === "discard") && event.blocked) return state;
  if (event.type === "open" || event.type === "keep-editing") return "editing";
  if (event.type === "request-close") return event.dirty ? "confirming-discard" : "closed";
  return state === "confirming-discard" ? "closed" : state;
}
