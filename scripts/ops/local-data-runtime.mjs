import { CliError } from "../dev/errors.mjs";
import { projectIdentity } from "../dev/environment.mjs";
import { controlRequest, readRuntime } from "../dev/runtime.mjs";

export async function assertLocalApplicationStopped(root, options = {}) {
  const identity = options.identity ?? await projectIdentity(root);
  const runtime = await (options.readRuntime ?? readRuntime)(identity.root, identity.id);
  if (!runtime) return null;
  const active = await (options.controlRequest ?? controlRequest)(runtime);
  if (active || !["stopped", "failed"].includes(runtime.status)) {
    throw new CliError(
      "LOCAL_APP_ACTIVE",
      "The owned local application is not confirmed stopped.",
      "Run node scripts/dev/stop.mjs before backing up or restoring local data.",
    );
  }
  return runtime;
}
