/* global process */

export function isCI() {
  return process.env.CI === "true";
}
