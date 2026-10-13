import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { finishOwnedShutdown } from "../../scripts/dev/app-process.mjs";

describe("owned supervisor shutdown", () => {
  it("still stops its child and closes control sockets when runtime persistence fails", async () => {
    const control = http.createServer();
    await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
    const socket = net.createConnection(control.address().port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write("POST /stop HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000\r\n\r\npartial");
    let childStopped = false;
    let writes = 0;
    try {
      await expect(finishOwnedShutdown({
        persist: async () => { writes += 1; throw new Error("disk-full-fixture"); },
        app: Promise.resolve({ stop: async () => { childStopped = true; } }),
        control,
      })).rejects.toMatchObject({ code: "SHUTDOWN_INCOMPLETE" });
      expect(childStopped).toBe(true);
      expect(control.listening).toBe(false);
      expect(writes).toBe(2);
    } finally {
      socket.destroy();
      if (control.listening) await new Promise((resolve) => control.close(resolve));
    }
  });

  it("waits for an app still being launched before stopping it", async () => {
    const events = [];
    const app = new Promise((resolve) => setTimeout(() => { events.push("launched"); resolve({ stop: async () => events.push("stopped") }); }, 10));
    await finishOwnedShutdown({ persist: async (state) => events.push(state.status), app });
    expect(events).toEqual(["stopping", "launched", "stopped", "stopped"]);
  });
});
