import path from "node:path";
import { CliError } from "./errors.mjs";
import { assertOwnedDatabaseUrl, parsePort } from "./environment.mjs";
import { selectAvailablePorts } from "./ports.mjs";

export async function resolveLocalConfig(root, inherited, previous, services, requestedPort) {
  const specs = {
    database: { envName: "TIRLIK_DB_PORT", saved: previous?.databasePort, own: services.postgres?.running ? services.postgres.ports["5432/tcp"] : undefined, fallback: 54329 },
    smtp: { envName: "TIRLIK_SMTP_PORT", saved: previous?.smtpPort, own: services.mailpit?.running ? services.mailpit.ports["1025/tcp"] : undefined, fallback: 10259 },
    mail: { envName: "TIRLIK_MAIL_UI_PORT", saved: previous?.mailPort, own: services.mailpit?.running ? services.mailpit.ports["8025/tcp"] : undefined, fallback: 8029 },
    app: { envName: "TIRLIK_APP_PORT", saved: previous?.appPort, fallback: 3000, explicit: requestedPort },
  };
  const checks = {};
  const ports = {};
  for (const [name, spec] of Object.entries(specs)) {
    const configured = spec.explicit ?? inherited[spec.envName];
    const preferred = parsePort(configured, spec.envName, spec.saved ?? spec.own ?? spec.fallback);
    if (spec.own === preferred) ports[name] = preferred;
    else checks[name] = { preferred, allowFallback: configured === undefined && (name === "app" || !spec.saved) };
  }
  Object.assign(ports, await selectAvailablePorts(checks));
  if (new Set(Object.values(ports)).size !== 4) throw new CliError("PORTS_OVERLAP", "Application and dependency ports must be distinct.", "Choose separate TIRLIK_APP_PORT, TIRLIK_DB_PORT, TIRLIK_SMTP_PORT, and TIRLIK_MAIL_UI_PORT values.");
  const databaseUrl = assertOwnedDatabaseUrl(inherited.DATABASE_URL, ports.database);
  const dataDir = path.resolve(root, inherited.TIRLIK_DATA_DIR || ".local-data/files");
  const relative = path.relative(path.join(root, ".local-data"), dataDir);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new CliError("DATA_DIRECTORY_OUTSIDE_LOCAL_ROOT", "Local files must be stored inside this checkout's .local-data directory.", "Set TIRLIK_DATA_DIR to .local-data/files or a subdirectory of .local-data.");
  return {
    ports,
    env: {
      ...inherited,
      DATABASE_URL: databaseUrl,
      TIRLIK_DB_PORT: String(ports.database), TIRLIK_SMTP_PORT: String(ports.smtp), TIRLIK_MAIL_UI_PORT: String(ports.mail), TIRLIK_APP_PORT: String(ports.app),
      TIRLIK_DATA_DIR: dataDir, NEXT_DIST_DIR: ".next", NODE_ENV: "development",
      SMTP_HOST: "127.0.0.1", SMTP_PORT: String(ports.smtp), SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "Tirlik local <no-reply@tirlik.invalid>",
      BETTER_AUTH_URL: `http://127.0.0.1:${ports.app}`,
    },
  };
}
