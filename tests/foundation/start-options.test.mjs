import { describe, expect, it } from "vitest";
import { parseStartOptions } from "../../scripts/dev/start-options.mjs";

describe("local start options", () => {
  it("keeps development as the default and accepts explicit production in either option order", () => {
    expect(parseStartOptions([])).toEqual({ mode: "development", port: undefined });
    expect(parseStartOptions(["--mode", "production", "--port", "4173"])).toEqual({ mode: "production", port: "4173" });
    expect(parseStartOptions(["--port", "4173", "--mode", "development"])).toEqual({ mode: "development", port: "4173" });
  });

  it("rejects missing, repeated and unsupported values", () => {
    expect(() => parseStartOptions(["--mode", "preview"])).toThrow(expect.objectContaining({ code: "APP_MODE_INVALID" }));
    expect(() => parseStartOptions(["--mode"])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
    expect(() => parseStartOptions(["--port", "3000", "--port", "4000"])).toThrow(expect.objectContaining({ code: "ARGUMENT_INVALID" }));
  });
});
