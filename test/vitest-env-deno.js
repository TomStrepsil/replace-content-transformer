/* global Deno */

export function isCI() {
  // GitHub Actions sets CI="true" (as a string)
  try {
    return Deno.env.get("CI") === "true";
  } catch {
    return false;
  }
}
