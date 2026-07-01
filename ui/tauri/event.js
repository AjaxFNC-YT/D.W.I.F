import { invoke } from "./core.js";

function transformCallback(callback) {
  return window.__TAURI_INTERNALS__.transformCallback(callback);
}

export async function listen(event, handler) {
  if (!window.__TAURI_INTERNALS__?.invoke || !window.__TAURI_INTERNALS__?.transformCallback) {
    throw new Error("Tauri event API is not available in this window.");
  }

  const eventId = await invoke("plugin:event|listen", {
    event,
    target: { kind: "Any" },
    handler: transformCallback(handler)
  });

  return async () => {
    await invoke("plugin:event|unlisten", { event, eventId });
  };
}
