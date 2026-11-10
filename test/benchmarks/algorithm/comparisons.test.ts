import { describe, expect, it } from "vitest";
import * as harnesses from "../harnesses/index.ts";
import type { BaseHarness } from "../harnesses/types.ts";
import { comparisons } from "./comparisons.ts";

describe("comparisons", () => {
  it("includes every harness in at least one comparison", () => {
    const compared = new Set(
      comparisons.flatMap(({ baseline, compared }) => [baseline, ...compared])
    );
    const all: BaseHarness[] = Object.values(harnesses);
    const missing = all
      .filter((harness) => !compared.has(harness))
      .map(({ name }) => name);

    expect(missing).toEqual([]);
  });
});
