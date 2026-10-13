import net from "node:net";
import { CliError } from "./errors.mjs";

export function reserveLoopbackPort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        reject(new CliError("PORT_UNAVAILABLE", "The requested local port is unavailable.", "Choose another port or stop the application that owns it yourself."));
      } else {
        reject(new CliError("PORT_CHECK_FAILED", "Cannot check a local port.", "Check local network permissions and retry."));
      }
    });
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      resolve({
        port: server.address().port,
        release: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done())),
      });
    });
  });
}

export async function selectAvailablePorts(requests) {
  const held = [];
  try {
    const ports = {};
    for (const [name, { preferred = 0, allowFallback = false }] of Object.entries(requests)) {
      let reservation;
      try {
        reservation = await reserveLoopbackPort(preferred);
      } catch (error) {
        if (!allowFallback || error.code !== "PORT_UNAVAILABLE" || preferred === 0) throw error;
        reservation = await reserveLoopbackPort(0);
      }
      held.push(reservation);
      ports[name] = reservation.port;
    }
    return ports;
  } finally {
    await Promise.all(held.map((reservation) => reservation.release()));
  }
}
