import { it, expect } from "vitest";
import { pinOk } from "../lib/auth";
it("accepts only the right PIN", async () => {
  expect(await pinOk("1024")).toBe(true);
  for (const p of ["0000", "1025", "", "10244", "abcd"]) expect(await pinOk(p)).toBe(false);
});
