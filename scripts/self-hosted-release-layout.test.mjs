import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  resolveSelfHostedApplicationDirectory,
  resolveSelfHostedConfig,
  resolveSelfHostedRuntimeEnvironment,
} from "./self-hosted-config.mjs";

describe("self-hosted release layout", () => {
  test("uses an explicit application directory for a packaged runtime", () => {
    const sourceRoot = resolve(import.meta.dir, "..");
    const releaseRoot = resolve(import.meta.dir, "fixture-release");

    expect(resolveSelfHostedApplicationDirectory({
      EDGE_EVER_APP_DIR: releaseRoot,
    }, sourceRoot)).toBe(releaseRoot);
  });

  test("derives a compiled Bun application's directory from its executable", () => {
    const environment = resolveSelfHostedRuntimeEnvironment({
      EDGE_EVER_DATA_DIR: resolve(import.meta.dir, "fixture-data"),
    }, {
      entryPath: "B:\\~BUN\\root\\edgeever-self-hosted.exe",
      executablePath: resolve(import.meta.dir, "fixture-release", "edgeever-self-hosted.exe"),
    });

    expect(environment.EDGE_EVER_APP_DIR).toBe(resolve(import.meta.dir, "fixture-release"));
  });

  test("requires an external data directory for a packaged runtime", () => {
    const releaseRoot = resolve(import.meta.dir, "fixture-release");

    expect(() => resolveSelfHostedConfig({
      EDGE_EVER_APP_DIR: releaseRoot,
    }, releaseRoot)).toThrow("EDGE_EVER_DATA_DIR");
  });

  test("defaults a packaged runtime to loopback after data is explicit", () => {
    const releaseRoot = resolve(import.meta.dir, "fixture-release");
    const dataRoot = resolve(import.meta.dir, "fixture-data");

    const config = resolveSelfHostedConfig({
      EDGE_EVER_APP_DIR: releaseRoot,
      EDGE_EVER_DATA_DIR: dataRoot,
    }, releaseRoot);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.databaseFile).toBe(join(dataRoot, "edgeever.sqlite"));
    expect(config.resourcesDirectory).toBe(join(dataRoot, "resources"));
    expect(config.webDirectory).toBe(join(releaseRoot, "apps", "web", "dist"));
  });

  test("rejects a non-loopback host for a packaged runtime", () => {
    const releaseRoot = resolve(import.meta.dir, "fixture-release");
    const dataRoot = resolve(import.meta.dir, "fixture-data");

    expect(() => resolveSelfHostedConfig({
      EDGE_EVER_APP_DIR: releaseRoot,
      EDGE_EVER_DATA_DIR: dataRoot,
      EDGE_EVER_HOST: "0.0.0.0",
    }, releaseRoot)).toThrow("127.0.0.1");
  });

  test("accepts an absolute cross-volume data directory for a packaged Windows runtime", () => {
    if (process.platform !== "win32") return;

    const config = resolveSelfHostedConfig({
      EDGE_EVER_APP_DIR: "C:\\edgeever-release",
      EDGE_EVER_DATA_DIR: "D:\\edgeever-data",
    }, "C:\\edgeever-release");
    expect(config.dataDirectory).toBe("D:\\edgeever-data");
  });

  test("rejects packaged database and resource overrides inside the replaceable bundle", () => {
    const releaseRoot = resolve(import.meta.dir, "fixture-release");
    const dataRoot = resolve(import.meta.dir, "fixture-data");

    for (const [name, value] of [
      ["EDGE_EVER_SQLITE_FILE", join(releaseRoot, "edgeever.sqlite")],
      ["EDGE_EVER_RESOURCES_DIR", join(releaseRoot, "resources")],
    ]) {
      expect(() => resolveSelfHostedConfig({
        EDGE_EVER_APP_DIR: releaseRoot,
        EDGE_EVER_DATA_DIR: dataRoot,
        [name]: value,
      }, releaseRoot)).toThrow(name);
    }
  });
});
