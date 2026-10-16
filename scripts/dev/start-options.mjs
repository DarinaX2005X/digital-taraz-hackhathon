import { CliError } from "./errors.mjs";

export function parseStartOptions(args) {
  const result = { mode: "development", port: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || !["--mode", "--port"].includes(name) || seen.has(name)) {
      throw new CliError("ARGUMENT_INVALID", "Unsupported startup arguments.", "Use node scripts/dev/start.mjs [--mode development|production] [--port 3000].");
    }
    seen.add(name);
    if (name === "--mode") {
      if (!['development', 'production'].includes(value)) throw new CliError("APP_MODE_INVALID", "Unsupported local application mode.", "Use --mode development or --mode production.");
      result.mode = value;
    } else result.port = value;
  }
  return result;
}
