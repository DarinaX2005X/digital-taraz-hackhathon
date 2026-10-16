import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../dev/errors.mjs";

export const localBackupFormat = "tirlik-local-backup-v1";
const normalized = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function ordinaryDirectory(directory, { missing = false } = {}) {
  let info;
  try { info = await lstat(directory); } catch (error) {
    if (missing && error.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError("BACKUP_PATH_UNSAFE", `Expected an ordinary directory at ${directory}.`, "Replace linked or special paths before retrying.");
  return true;
}

async function targetLayout(root, dataDir, workflowDir) {
  const canonicalRoot = await realpath(root);
  const localRoot = path.join(canonicalRoot, ".local-data");
  await mkdir(localRoot, { recursive: true });
  if (!await ordinaryDirectory(localRoot)) throw new CliError("BACKUP_PATH_UNSAFE", "The local data root is unsafe.", "Inspect .local-data before retrying.");
  const targets = { files: path.resolve(dataDir), workflow: path.resolve(workflowDir) };
  for (const [name, target] of Object.entries(targets)) {
    if (normalized(target) === normalized(localRoot) || !within(localRoot, target)) {
      throw new CliError("BACKUP_TARGET_OUTSIDE_LOCAL_ROOT", `${name} must be a dedicated directory inside .local-data.`, "Use the owned local data directories for backup and restore.");
    }
    await ordinaryDirectory(target, { missing: true });
  }
  if (within(targets.files, targets.workflow) || within(targets.workflow, targets.files)) {
    throw new CliError("BACKUP_TARGETS_OVERLAP", "File and workflow directories must not overlap.", "Correct TIRLIK_DATA_DIR before retrying.");
  }
  return { root: canonicalRoot, localRoot, targets };
}

async function safeDestination(directory, forbidden) {
  const output = path.resolve(directory);
  const name = path.basename(output);
  if (!name || name === "." || name === "..") throw new CliError("BACKUP_DESTINATION_INVALID", "The backup destination needs a directory name.", "Choose a new empty backup directory.");
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const canonicalParent = await realpath(parent);
  if (normalized(canonicalParent) !== normalized(parent)) throw new CliError("BACKUP_DESTINATION_UNSAFE", "The backup parent resolves through a linked path.", "Choose an ordinary local directory.");
  if (forbidden.some((target) => within(target, output) || within(output, target))) {
    throw new CliError("BACKUP_DESTINATION_OVERLAP", "The backup cannot be stored inside a directory it copies.", "Choose .local-data/backups or another separate directory.");
  }
  try {
    await lstat(output);
    throw new CliError("BACKUP_DESTINATION_EXISTS", "The backup destination already exists.", "Choose a new directory; existing backups are never overwritten.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { output, parent: canonicalParent, staging: path.join(canonicalParent, `.${name}.incomplete-${randomUUID()}`) };
}

async function removeGenerated(directory, parent) {
  if (normalized(path.dirname(directory)) !== normalized(parent)
    || (!path.basename(directory).includes(".incomplete-") && !path.basename(directory).startsWith(".restore-"))) {
    throw new CliError("GENERATED_CLEANUP_REFUSED", "Refused to remove an unverified directory.", "Inspect the preserved path manually.");
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function walkTree(source, destination, prefix = "") {
  const entries = [];
  const names = await readdir(source, { withFileTypes: true });
  for (const entry of names.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const from = path.join(source, entry.name);
    const to = destination ? path.join(destination, entry.name) : null;
    if (entry.isSymbolicLink()) throw new CliError("BACKUP_SOURCE_UNSAFE", `Linked entry ${relative} cannot be backed up.`, "Replace the link with an ordinary file or directory.");
    if (entry.isDirectory()) {
      if (to) await mkdir(to, { recursive: true });
      entries.push(...await walkTree(from, to, relative));
      continue;
    }
    if (!entry.isFile()) throw new CliError("BACKUP_SOURCE_UNSAFE", `Special entry ${relative} cannot be backed up.`, "Remove the special entry before retrying.");
    if (to) await copyFile(from, to);
    const measured = to ?? from;
    const info = await stat(measured);
    entries.push({ path: relative, bytes: info.size, sha256: await hashFile(measured) });
  }
  return entries;
}

async function copyTree(source, destination) {
  const present = await ordinaryDirectory(source, { missing: true });
  if (!present) return { present: false, entries: [] };
  await mkdir(destination, { recursive: true });
  return { present: true, entries: await walkTree(source, destination) };
}

function validEntry(entry) {
  return entry && typeof entry.path === "string" && entry.path.length > 0 && entry.path === entry.path.replaceAll("\\", "/")
    && !path.posix.isAbsolute(entry.path) && !entry.path.split("/").includes("..")
    && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/.test(entry.sha256 ?? "");
}

async function verifyTree(directory, tree, name) {
  if (!tree || typeof tree.present !== "boolean" || !Array.isArray(tree.entries) || tree.entries.some((entry) => !validEntry(entry))) {
    throw new CliError("BACKUP_MANIFEST_INVALID", `The ${name} manifest is invalid.`, "Use an intact backup created by this Tirlik version.");
  }
  if (!tree.present) {
    try { await lstat(directory); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    throw new CliError("BACKUP_CONTENT_MISMATCH", `Unexpected ${name} content exists in the backup.`, "Use an intact backup directory.");
  }
  await ordinaryDirectory(directory);
  const actual = await walkTree(directory, null);
  if (JSON.stringify(actual) !== JSON.stringify(tree.entries)) throw new CliError("BACKUP_CONTENT_MISMATCH", `${name} files do not match the manifest.`, "Do not restore this backup; recover an intact copy.");
}

async function migrationFiles(directory) {
  await ordinaryDirectory(directory);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name).sort();
  return Promise.all(names.map(async (name) => ({ name, hash: await hashFile(path.join(directory, name)) })));
}

function validateApplied(applied) {
  if (!Array.isArray(applied) || applied.some((item) => typeof item?.name !== "string" || !/^[a-f0-9]{64}$/.test(item.hash ?? ""))) {
    throw new CliError("BACKUP_MIGRATIONS_INVALID", "The applied migration history is invalid.", "Inspect the database migration table before retrying.");
  }
}

function validateMigrationFiles(files) {
  if (!Array.isArray(files) || files.some((item) => typeof item?.name !== "string" || !/^\d{4}_[a-z0-9_]+\.sql$/.test(item.name)
    || !/^[a-f0-9]{64}$/.test(item.hash ?? "")) || new Set(files.map((item) => item.name)).size !== files.length) {
    throw new CliError("BACKUP_MIGRATIONS_INVALID", "The migration file history is invalid.", "Use an intact backup and an unchanged migrations directory.");
  }
}

export async function createLocalBackup(options) {
  const layout = await targetLayout(options.root, options.dataDir, options.workflowDir);
  const destination = await safeDestination(options.outputDirectory, Object.values(layout.targets));
  let completed = false;
  try {
    await mkdir(destination.staging);
    const dump = path.join(destination.staging, "database.dump");
    const applied = await options.database.migrationHistory();
    validateApplied(applied);
    const files = await migrationFiles(options.migrationsDir ?? path.join(layout.root, "migrations"));
    validateMigrationFiles(files);
    for (let index = 0; index < applied.length; index++) {
      if (files[index]?.name !== applied[index].name || files[index].hash !== applied[index].hash) {
        throw new CliError("BACKUP_MIGRATION_MISMATCH", "The database migration history does not match this source checkout.", "Run the normal local migration command and resolve any history mismatch before backing up.");
      }
    }
    await options.database.dump(dump);
    const dumpInfo = await lstat(dump);
    if (!dumpInfo.isFile() || dumpInfo.isSymbolicLink()) throw new CliError("BACKUP_DATABASE_INVALID", "The database dump was not written as an ordinary file.", "Inspect PostgreSQL diagnostics and retry.");
    const trees = {
      files: await copyTree(layout.targets.files, path.join(destination.staging, "files")),
      workflow: await copyTree(layout.targets.workflow, path.join(destination.staging, "workflow")),
    };
    const manifest = {
      format: localBackupFormat,
      createdAt: new Date().toISOString(),
      database: { file: "database.dump", bytes: dumpInfo.size, sha256: await hashFile(dump) },
      migrations: { applied, files },
      trees,
    };
    await writeFile(path.join(destination.staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(destination.staging, destination.output);
    completed = true;
    return verifyLocalBackup({ root: layout.root, sourceDirectory: destination.output, migrationsDir: options.migrationsDir });
  } finally {
    if (!completed) await removeGenerated(destination.staging, destination.parent).catch(() => {});
  }
}

async function readManifest(directory) {
  const source = path.resolve(directory);
  await ordinaryDirectory(source);
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8")); } catch {
    throw new CliError("BACKUP_MANIFEST_INVALID", "The backup manifest cannot be read.", "Use an intact backup created by Tirlik.");
  }
  if (manifest?.format !== localBackupFormat || !Number.isFinite(Date.parse(manifest.createdAt ?? ""))
    || manifest.database?.file !== "database.dump" || !Number.isSafeInteger(manifest.database?.bytes)
    || !/^[a-f0-9]{64}$/.test(manifest.database?.sha256 ?? "") || !Array.isArray(manifest.migrations?.files)) {
    throw new CliError("BACKUP_MANIFEST_INVALID", "The backup manifest format is invalid.", "Use an intact backup created by this Tirlik version.");
  }
  validateApplied(manifest.migrations.applied);
  validateMigrationFiles(manifest.migrations.files);
  return { source, manifest };
}

export async function verifyLocalBackup(options) {
  const { source, manifest } = await readManifest(options.sourceDirectory);
  const dump = path.join(source, "database.dump");
  const dumpInfo = await lstat(dump).catch(() => null);
  if (!dumpInfo?.isFile() || dumpInfo.isSymbolicLink() || dumpInfo.size !== manifest.database.bytes || await hashFile(dump) !== manifest.database.sha256) {
    throw new CliError("BACKUP_DATABASE_MISMATCH", "The database dump does not match the manifest.", "Do not restore this backup; recover an intact copy.");
  }
  await verifyTree(path.join(source, "files"), manifest.trees?.files, "files");
  await verifyTree(path.join(source, "workflow"), manifest.trees?.workflow, "workflow");
  const current = await migrationFiles(options.migrationsDir ?? path.join(options.root, "migrations"));
  const currentByName = new Map(current.map((item) => [item.name, item.hash]));
  for (const applied of manifest.migrations.applied) {
    if (currentByName.get(applied.name) !== applied.hash) throw new CliError("BACKUP_MIGRATION_MISMATCH", `Applied migration ${applied.name} is unavailable or changed.`, "Restore with source code that contains the same migration history.");
  }
  return { directory: source, manifest };
}

async function stageTree(source, tree, destination, name) {
  if (!tree.present) return null;
  await mkdir(destination, { recursive: true });
  await walkTree(source, destination);
  await verifyTree(destination, tree, name);
  return destination;
}

async function activateTree(target, staged, rollbackRoot, name) {
  const rollback = path.join(rollbackRoot, name);
  const hadOriginal = await ordinaryDirectory(target, { missing: true });
  await mkdir(path.dirname(target), { recursive: true });
  if (hadOriginal) await rename(target, rollback);
  try {
    if (staged) await rename(staged, target);
  } catch (error) {
    if (hadOriginal) await rename(rollback, target).catch(() => {});
    throw error;
  }
  return { target, rollback, hadOriginal, installed: Boolean(staged) };
}

async function revertTrees(swaps) {
  for (const swap of [...swaps].reverse()) {
    if (swap.installed) await rm(swap.target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (swap.hadOriginal) await rename(swap.rollback, swap.target);
  }
}

export async function restoreLocalBackup(options) {
  const layout = await targetLayout(options.root, options.dataDir, options.workflowDir);
  const verified = await verifyLocalBackup({ root: layout.root, sourceDirectory: options.sourceDirectory, migrationsDir: options.migrationsDir });
  if (Object.values(layout.targets).some((target) => within(target, verified.directory) || within(verified.directory, target))) {
    throw new CliError("BACKUP_SOURCE_OVERLAP", "The restore source is inside a directory it would replace.", "Move the backup to .local-data/backups or another separate directory.");
  }
  const safety = await createLocalBackup({ ...options, outputDirectory: options.safetyDirectory });
  await verifyLocalBackup({ root: layout.root, sourceDirectory: safety.directory, migrationsDir: options.migrationsDir });
  const runId = randomUUID();
  const staging = path.join(layout.localRoot, `.restore-staging-${runId}`);
  const rollback = path.join(layout.localRoot, `.restore-rollback-${runId}`);
  await mkdir(staging);
  await mkdir(rollback);
  const swaps = [];
  let databaseChanged = false;
  try {
    const stagedFiles = await stageTree(path.join(verified.directory, "files"), verified.manifest.trees.files, path.join(staging, "files"), "files");
    const stagedWorkflow = await stageTree(path.join(verified.directory, "workflow"), verified.manifest.trees.workflow, path.join(staging, "workflow"), "workflow");
    await options.database.restore(path.join(verified.directory, "database.dump"));
    databaseChanged = true;
    swaps.push(await activateTree(layout.targets.files, stagedFiles, rollback, "files"));
    swaps.push(await activateTree(layout.targets.workflow, stagedWorkflow, rollback, "workflow"));
  } catch (cause) {
    let rollbackFailure;
    try {
      await revertTrees(swaps);
      if (databaseChanged) await options.database.restore(path.join(safety.directory, "database.dump"));
    } catch (error) { rollbackFailure = error; }
    if (rollbackFailure) throw new CliError("RESTORE_ROLLBACK_FAILED", "Restore failed and automatic rollback could not finish.", `Preserve the safety backup at ${safety.directory} and recover it before starting Tirlik.`, { cause: rollbackFailure });
    await removeGenerated(staging, layout.localRoot).catch(() => {});
    await removeGenerated(rollback, layout.localRoot).catch(() => {});
    throw new CliError("RESTORE_FAILED", "Restore failed; the previous local state was put back.", `The safety backup remains at ${safety.directory}.`, { cause });
  }
  await removeGenerated(rollback, layout.localRoot).catch(() => {});
  await removeGenerated(staging, layout.localRoot).catch(() => {});
  return { directory: verified.directory, safetyDirectory: safety.directory, manifest: verified.manifest };
}
