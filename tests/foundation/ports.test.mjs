import { describe, expect, it } from "vitest";
import { reserveLoopbackPort, selectAvailablePorts } from "../../scripts/dev/ports.mjs";

describe("local ports", () => {
  it("does not take over a busy port and can choose a distinct fallback", async () => {
    const occupied = await reserveLoopbackPort();
    try {
      await expect(selectAvailablePorts({ app: { preferred: occupied.port } })).rejects.toMatchObject({ code: "PORT_UNAVAILABLE" });
      const selected = await selectAvailablePorts({ app: { preferred: occupied.port, allowFallback: true } });
      expect(selected.app).not.toBe(occupied.port);
      await expect(reserveLoopbackPort(occupied.port)).rejects.toMatchObject({ code: "PORT_UNAVAILABLE" });
    } finally {
      await occupied.release();
    }
  });

  it("holds all requested ports until selection is complete and then releases them", async () => {
    const ports = await selectAvailablePorts({ database: {}, smtp: {}, mail: {}, app: {} });
    expect(new Set(Object.values(ports)).size).toBe(4);
    const reservations = await Promise.all(Object.values(ports).map((port) => reserveLoopbackPort(port)));
    await Promise.all(reservations.map((reservation) => reservation.release()));
  });

  it("releases earlier reservations after a later port fails", async () => {
    const [available, occupied] = await Promise.all([reserveLoopbackPort(), reserveLoopbackPort()]);
    const port = available.port;
    await available.release();
    try {
      await expect(selectAvailablePorts({ first: { preferred: port }, second: { preferred: occupied.port } })).rejects.toMatchObject({ code: "PORT_UNAVAILABLE" });
      const recovered = await reserveLoopbackPort(port);
      await recovered.release();
    } finally {
      await occupied.release();
    }
  });
});
