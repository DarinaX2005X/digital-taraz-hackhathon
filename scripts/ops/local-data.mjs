import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { assertDockerAvailable, inspectOwnedServices } from "../dev/compose.mjs";
import { assertNodeVersion, loadEnvironment, projectIdentity } from "../dev/environment.mjs";
import { CliError, reportCliError } from "../dev/errors.mjs";
import { resolveLocalConfig } from "../dev/local-config.mjs";
import { acquireStartLock } from "../dev/runtime.mjs";
import { createLocalBackup, restoreLocalBackup, verifyLocalBackup } from "./local-data-core.mjs";
import { assertLocalApplicationStopped } from "./local-data-runtime.mjs";
import { postgresDatabaseAdapter, startLocalPostgres } from "./postgres-backup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const usage = `Usage:
  node scripts/ops/local-data.mjs backup [--output <new-directory>]
  node scripts/ops/local-data.mjs verify --from <backup-directory>
  node scripts/ops/local-data.mjs restore --from <backup-directory>

Backup and restore require the owned Tirlik application to be stopped. Existing backups are never overwritten or deleted.`;

function backupName(prefix = "backup") {
  return `${prefix}-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}`;
}

function commandLine() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "--help" || action === "-h") return { help: true };
  if (!["backup", "verify", "restore"].includes(action ?? "")) throw new CliError("BACKUP_ACTION_INVALID", "Choose backup, verify, or restore.", usage);
  let values;
  try {
    ({ values } = parseArgs({ args, options: { output: { type: "string" }, from: { type: "string" }, help: { type: "boolean", short: "h" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new CliError("BACKUP_OPTIONS_INVALID", "The backup command options are invalid.", usage);
  }
  if (values.help) return { help: true };
  if (action === "backup" && values.from || action !== "backup" && values.output || action !== "backup" && !values.from) {
    throw new CliError("BACKUP_OPTIONS_INVALID", "The selected action has missing or incompatible options.", usage);
  }
  return { action, ...values };
}

let release;
try {
  const selected = commandLine();
  if (selected.help) {
    console.log(usage);
  } else {
    assertNodeVersion();
    const identity = await projectIdentity(root);
    const migrationsDir = path.join(identity.root, "migrations");
    if (selected.action === "verify") {
      const result = await verifyLocalBackup({ root: identity.root, sourceDirectory: path.resolve(identity.root, selected.from), migrationsDir });
      console.log(`Verified backup ${result.directory} (${result.manifest.createdAt}).`);
    } else {
      release = await acquireStartLock(identity.root);
      const previous = await assertLocalApplicationStopped(identity.root, { identity });
      const inherited = await loadEnvironment(identity.root, { mode: "development" });
      const logFile = path.join(identity.root, ".local-data", "checks", `local-data-${Date.now()}.log`);
      await assertDockerAvailable({ cwd: identity.root, env: inherited, logFile });
      const services = await inspectOwnedServices(identity.root, identity.composeProject, { cwd: identity.root, env: inherited, logFile });
      const config = await resolveLocalConfig(identity.root, inherited, previous, services);
      await startLocalPostgres({ root: identity.root, project: identity.composeProject, env: config.env, logFile });
      const database = postgresDatabaseAdapter({ root: identity.root, project: identity.composeProject, env: config.env, logFile });
      const workflowDir = path.join(identity.root, ".local-data", "workflow");
      const backupsDir = path.join(identity.root, ".local-data", "backups");
      if (selected.action === "backup") {
        const outputDirectory = selected.output ? path.resolve(identity.root, selected.output) : path.join(backupsDir, backupName());
        const result = await createLocalBackup({ root: identity.root, dataDir: config.env.TIRLIK_DATA_DIR, workflowDir, migrationsDir, outputDirectory, database });
        console.log(`Created and verified backup: ${result.directory}`);
      } else {
        const sourceDirectory = path.resolve(identity.root, selected.from);
        await verifyLocalBackup({ root: identity.root, sourceDirectory, migrationsDir });
        const safetyDirectory = path.join(backupsDir, backupName("pre-restore"));
        const result = await restoreLocalBackup({ root: identity.root, dataDir: config.env.TIRLIK_DATA_DIR, workflowDir, migrationsDir, sourceDirectory, safetyDirectory, database });
        console.log(`Restored backup: ${result.directory}`);
        console.log(`Preserved pre-restore safety backup: ${result.safetyDirectory}`);
      }
    }
  }
} catch (error) {
  if (error.result?.output) console.error(error.result.output);
  reportCliError(error);
} finally {
  if (release) await release().catch(reportCliError);
}
