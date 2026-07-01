export async function invoke(command, args = {}) {
  if (!window.__TAURI_INTERNALS__?.invoke) {
    throw new Error("Tauri backend is not available in this window.");
  }

  return window.__TAURI_INTERNALS__.invoke(command, args);
}
