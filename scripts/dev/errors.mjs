export class CliError extends Error {
  constructor(code, message, recovery, options = {}) {
    super(message, options);
    this.name = "CliError";
    this.code = code;
    this.recovery = recovery;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function reportCliError(error) {
  if (error instanceof CliError) {
    console.error(`[${error.code}] ${error.message}`);
    if (error.recovery) console.error(`Recovery: ${error.recovery}`);
    process.exitCode = error.exitCode;
    return;
  }

  console.error("[UNEXPECTED_FAILURE] The command could not finish.");
  console.error("Recovery: Check the local command logs and run it again.");
  process.exitCode = 1;
}
