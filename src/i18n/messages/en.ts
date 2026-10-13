import type { ru } from "./ru";
import type { MessageShape } from "./types";

export const en = {
  common: {
    brand: { name: "Tirlik", tagline: "Everything for your business" },
    navigation: { work: "Work", materials: "Materials", business: "Business", settings: "Settings", help: "Help", profile: "Profile", language: "Language", back: "Back", home: "Home", skipToContent: "Skip to content" },
    actions: { create: "Create", newTask: "New task", open: "Open", edit: "Edit", save: "Save", cancel: "Cancel", close: "Close", confirm: "Confirm", retry: "Retry", remove: "Delete", archive: "Archive", restore: "Restore", search: "Search", clear: "Clear", choose: "Choose", download: "Download", upload: "Upload", export: "Export", undo: "Undo", redo: "Redo", versions: "Versions", duplicate: "Make a copy", more: "More actions", signIn: "Sign in", signOut: "Sign out", continue: "Continue" },
    fields: { required: "Required", optional: "Optional", invalid: "Check this value", chooseOption: "Choose an option from the list", noMatches: "No matches", noOptions: "No options available", searching: "Searching", unit: "Unit" },
    state: { loading: "Loading", pending: "In progress", empty: "Nothing here yet", partial: "Partly complete", interrupted: "Work interrupted", saved: "Saved", saving: "Saving", unsaved: "Not saved", savedLocally: "Saved in this browser", offline: "No connection", conflict: "Another version of these changes exists" },
    dialog: { unsavedTitle: "You have unsaved changes", unsavedDescription: "Closing now will discard your unsaved changes.", keepEditing: "Keep editing", discard: "Close without saving" },
    errors: { unauthenticated: "Sign in to continue.", forbidden: "You do not have permission for this action.", notFound: "This material was not found or is unavailable.", conflict: "This material has changed. Compare versions before saving.", payloadTooLarge: "This file is too large. Choose a smaller file.", validationFailed: "Check the highlighted fields.", rateLimited: "Too many requests. Try again shortly.", providerFailed: "AI could not finish this work. Try again.", unavailable: "The service is temporarily unavailable. Try again.", unexpected: "This action could not be completed. Try again.", saveFailed: "Your changes could not be saved.", loadFailed: "The data could not be loaded." },
    locale: { sessionOnly: "The language was changed for this visit only.", preferenceFailed: "The language could not be saved to your profile.", savingPreference: "Saving language", savedPreference: "Language saved" },
    time: { timeZone: "Time zone", date: "Date", time: "Time" },
    feedback: { notifications: "Notifications" },
  },
} as const satisfies MessageShape<typeof ru>;
