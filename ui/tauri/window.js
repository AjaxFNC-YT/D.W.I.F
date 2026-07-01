import { invoke } from "./core.js";

class CurrentWindow {
  async minimize() {
    return invoke("minimize_window");
  }

  async toggleMaximize() {
    return invoke("toggle_maximize_window");
  }

  async close() {
    return invoke("close_window");
  }
}

export function getCurrentWindow() {
  return new CurrentWindow();
}
