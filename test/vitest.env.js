const envModule =
  typeof Deno !== "undefined"
    ? await import("./vitest-env-deno.js")
    : await import("./vitest-env-node-or-bun.js");

export default envModule;
