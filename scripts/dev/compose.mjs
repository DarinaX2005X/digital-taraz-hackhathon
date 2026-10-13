import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { CliError } from "./errors.mjs";
import { projectIdentity } from "./environment.mjs";
import { runCommand } from "./process.mjs";

export async function assertDockerAvailable(options) {
  try {
    await runCommand("docker", ["version", "--format", "{{.Server.Version}}"], { ...options, label: "Docker server", timeoutMs: 20_000 });
    await runCommand("docker", ["compose", "version", "--short"], { ...options, label: "Docker Compose", timeoutMs: 20_000 });
  } catch {
    throw new CliError("DOCKER_UNAVAILABLE", "Docker Engine and Docker Compose must be running.", "Start Docker Desktop, wait for the engine to become ready, and retry this command.");
  }
}

export async function composeSpecHash(root) {
  return createHash("sha256").update(await readFile(path.join(root, "compose.yaml"))).digest("hex");
}

export function runCompose(root, project, args, options = {}) {
  if (!/^tirlik-(?:test-)?[a-f0-9]{12}(?:-[a-f0-9]{32})?$/.test(project)) {
    throw new CliError("COMPOSE_PROJECT_INVALID", "The Compose project identity is invalid.", "Run the project command from the original checkout.");
  }
  return runCommand("docker", ["compose", "--project-name", project, "--project-directory", root, "--file", path.join(root, "compose.yaml"), ...args], { ...options, cwd: root });
}

export async function waitForMailpit(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1500), redirect: "error" });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch { /* A newly started dependency may not be accepting connections yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new CliError("MAIL_NOT_READY", "The local mail service did not become ready.", "Check its owned Compose logs and retry; existing mail and database volumes are preserved.");
}

export async function startCompose(root, project, options) {
  await runCompose(root, project, ["up", "--detach", "--wait", "--wait-timeout", "120", "postgres", "mailpit"], { ...options, label: "Local PostgreSQL and Mailpit", timeoutMs: 300_000 });
  await waitForMailpit(Number(options.env.TIRLIK_MAIL_UI_PORT));
}

export async function inspectOwnedServices(root, project, options) {
  const listing = await runCommand("docker", ["ps", "--all", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"], { ...options, label: "Local service ownership" });
  const ids = listing.output.trim().split(/\r?\n/).filter(Boolean);
  if (!ids.length) return {};
  if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new CliError("COMPOSE_IDENTITY_MISMATCH", "Unexpected local container identity.", "Inspect the local Docker project before retrying.");
  const result = await runCommand("docker", ["inspect", ...ids], { ...options, label: "Local service labels" });
  const normalize = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : value;
  const services = {};
  for (const container of JSON.parse(result.output)) {
    const labels = container.Config?.Labels;
    const service = labels?.["com.docker.compose.service"];
    if (labels?.["com.docker.compose.project"] !== project || normalize(labels?.["com.docker.compose.project.working_dir"] ?? "") !== normalize(root)
      || !["postgres", "mailpit"].includes(service) || services[service]) {
      throw new CliError("COMPOSE_IDENTITY_MISMATCH", "A local container does not match this checkout's service identity.", "Inspect the local Docker project; no container has been stopped.");
    }
    const ports = {};
    for (const [internal, bindings] of Object.entries(container.HostConfig?.PortBindings ?? {})) {
      for (const binding of bindings ?? []) {
        if (binding.HostIp !== "127.0.0.1") throw new CliError("COMPOSE_BINDING_UNSAFE", "A local service is not restricted to the loopback address.", "Check compose.yaml and the owned service configuration.");
        ports[internal] = Number(binding.HostPort);
      }
    }
    services[service] = { running: container.State?.Running === true, ports };
  }
  return services;
}

export async function assertDevVolumeOwnership(project, options) {
  const name = `${project}_postgres-data`;
  const listing = await runCommand("docker", ["volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"], { ...options, label: "Local volume ownership" });
  if (!listing.output.trim()) return;
  const inspection = await runCommand("docker", ["volume", "inspect", name], { ...options, label: "Local volume labels" });
  const [volume] = JSON.parse(inspection.output);
  if (volume?.Name !== name || volume?.Labels?.["com.docker.compose.project"] !== project || volume?.Labels?.["com.docker.compose.volume"] !== "postgres-data") {
    throw new CliError("COMPOSE_VOLUME_MISMATCH", "The existing database volume does not match this checkout.", "Inspect the volume ownership; it has been preserved.");
  }
}

export async function cleanupTestCompose(root, context, expectedSpecHash, options) {
  const identity = await projectIdentity(root);
  const expected = `tirlik-test-${identity.id}-${context.runId}`;
  if (!/^[a-f0-9]{32}$/.test(context.runId) || context.composeProject !== expected || await composeSpecHash(root) !== expectedSpecHash) {
    throw new CliError("TEST_CLEANUP_REFUSED", "The isolated test project identity or Compose file changed.", "Inspect the preserved test project before removing anything.");
  }
  const listing = await runCommand("docker", ["ps", "--all", "--filter", `label=com.docker.compose.project=${expected}`, "--format", "{{.ID}}"], { ...options, label: "Test container ownership" });
  const ids = listing.output.trim().split(/\r?\n/).filter(Boolean);
  if (ids.length) {
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new CliError("TEST_CLEANUP_REFUSED", "Unexpected test container identity.", "Inspect the preserved test project.");
    const inspection = await runCommand("docker", ["inspect", ...ids], { ...options, label: "Test container labels" });
    const containers = JSON.parse(inspection.output);
    if (containers.some((container) => container.Config?.Labels?.["com.docker.compose.project"] !== expected)) {
      throw new CliError("TEST_CLEANUP_REFUSED", "A container does not belong to this test run.", "Inspect the preserved test project.");
    }
  }
  const volumes = await runCommand("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${expected}`, "--format", "{{.Name}}"], { ...options, label: "Test volume ownership" });
  const names = volumes.output.trim().split(/\r?\n/).filter(Boolean);
  for (const name of names) {
    if (name !== `${expected}_postgres-data`) throw new CliError("TEST_CLEANUP_REFUSED", "An unexpected volume belongs to the test project.", "Inspect the preserved test project.");
    const inspection = await runCommand("docker", ["volume", "inspect", name], { ...options, label: "Test volume labels" });
    const [volume] = JSON.parse(inspection.output);
    if (volume?.Name !== name || volume?.Labels?.["com.docker.compose.project"] !== expected || volume?.Labels?.["com.docker.compose.volume"] !== "postgres-data") {
      throw new CliError("TEST_CLEANUP_REFUSED", "The test volume ownership could not be verified.", "Inspect the preserved test project.");
    }
  }
  await runCompose(root, expected, ["down", "--volumes", "--remove-orphans", "--timeout", "10"], { ...options, label: "Isolated test cleanup", timeoutMs: 60_000 });
}
