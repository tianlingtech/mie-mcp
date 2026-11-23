import { describe, expect, it } from "vitest";

import { BridgeClient } from "../src/bridge-client.js";

// Guards the requirement that decoder and connection callbacks complete
// synchronously. A handler turned async keeps satisfying the ordering
// tests (they inject synchronous stubs) but starts returning a promise,
// so the wiring's return value is what actually detects the change.

interface ClientInternals {
  handleFrame: (connection: unknown, rawFrame: unknown) => unknown;
  handleConnectionClosed: (connection: unknown) => unknown;
  requests: { rejectOversizedResponse: (requestId: string) => unknown };
}

function internals(client: BridgeClient): ClientInternals {
  return client as unknown as ClientInternals;
}

describe("production callback wiring", () => {
  it("returns undefined from frame handling", () => {
    const client = internals(new BridgeClient({ socketPath: "/tmp/unused" }));

    expect(client.handleFrame(undefined, { type: "event" })).toBeUndefined();
  });

  it("returns undefined from connection close handling", () => {
    const client = internals(new BridgeClient({ socketPath: "/tmp/unused" }));
    const foreign = { getTerminalError: () => undefined };

    expect(client.handleConnectionClosed(foreign)).toBeUndefined();
  });

  it("returns undefined from oversized response rejection", () => {
    const client = internals(new BridgeClient({ socketPath: "/tmp/unused" }));

    expect(
      client.requests.rejectOversizedResponse("no-such-request"),
    ).toBeUndefined();
  });
});
