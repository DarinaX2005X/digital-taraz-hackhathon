import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { projectIdentity, localDatabaseUrl } from "./environment.mjs";
import { selectAvailablePorts } from "./ports.mjs";

export async function createTestContext(root, inherited = process.env) {
  const identity = await projectIdentity(root);
  const runId = randomUUID().replaceAll("-", "");
  const directory = path.join(identity.root, ".local-data", "tests", runId);
  const ports = await selectAvailablePorts({ database: {}, smtp: {}, mail: {}, app: {} });
  await mkdir(directory, { recursive: true });
  const composeProject = `tirlik-test-${identity.id}-${runId}`;
  return {
    runId,
    directory,
    composeProject,
    ports,
    env: {
      ...inherited,
      NODE_ENV: "test",
      DATABASE_URL: localDatabaseUrl(ports.database),
      TIRLIK_DB_PORT: String(ports.database),
      TIRLIK_SMTP_PORT: String(ports.smtp),
      TIRLIK_MAIL_UI_PORT: String(ports.mail),
      TIRLIK_DATA_DIR: path.join(directory, "files"),
      NEXT_DIST_DIR: path.relative(identity.root, path.join(directory, "next")).split(path.sep).join("/"),
      TIRLIK_TEST_NAMESPACE: runId,
      TIRLIK_TEST_APP_PORT: String(ports.app),
    },
  };
}
