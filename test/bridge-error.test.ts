import { describe, expect, it } from "vitest";

import { asBridgeError } from "../src/bridge-error.js";

describe("asBridgeError", () => {
  it("normalizes an unexpected local failure to NOT_SENT", () => {
    expect(asBridgeError(new Error("Unexpected local failure."))).toMatchObject({
      code: "NOT_SENT",
      message: "Unexpected bridge client error.",
    });
  });
});
