import { invoke } from "./core.js";

export async function open(options) {
  return invoke("plugin:dialog|open", { options });
}

export async function save(options) {
  return invoke("plugin:dialog|save", { options });
}
