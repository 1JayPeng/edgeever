import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SUPPORTED_STORAGE_BACKENDS = new Set(["local", "s3"]);

const isInsideDirectory = (directory, candidate) => {
  const relation = relative(directory, candidate);
  return relation === "" || (
    !relation.startsWith(`..${sep}`)
    && relation !== ".."
    && !isAbsolute(relation)
  );
};

const parseInteger = (value, fallback, name, minimum, maximum) => {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
};

export const resolveSelfHostedRuntimeEnvironment = (
  environment = process.env,
  { entryPath = process.argv[1], executablePath = process.execPath } = {},
) => {
  const configuredApplicationDirectory = environment.EDGE_EVER_APP_DIR?.trim();
  if (configuredApplicationDirectory) return environment;

  // Bun --compile executes the embedded entrypoint from B:\\~BUN, while the
  // executable remains adjacent to the extracted app assets on disk.
  if (typeof entryPath === "string" && /^[A-Za-z]:[\\/]~BUN[\\/]/.test(entryPath)) {
    return {
      ...environment,
      EDGE_EVER_APP_DIR: dirname(resolve(executablePath)),
    };
  }
  return environment;
};

export const resolveSelfHostedApplicationDirectory = (
  environment = process.env,
  sourceProjectRoot = process.cwd(),
) => resolve(environment.EDGE_EVER_APP_DIR?.trim() || sourceProjectRoot);

export const resolveSelfHostedConfig = (environment = process.env, projectRoot = process.cwd()) => {
  const applicationDirectory = resolveSelfHostedApplicationDirectory(environment, projectRoot);
  const packagedRuntime = Boolean(environment.EDGE_EVER_APP_DIR?.trim());
  if (packagedRuntime && !environment.EDGE_EVER_DATA_DIR?.trim()) {
    throw new Error("EDGE_EVER_DATA_DIR is required when EDGE_EVER_APP_DIR is set");
  }
  const dataDirectory = resolve(environment.EDGE_EVER_DATA_DIR ?? join(applicationDirectory, ".edgeever-data"));
  if (
    packagedRuntime
    && (
      !isAbsolute(environment.EDGE_EVER_DATA_DIR.trim())
      || isInsideDirectory(applicationDirectory, dataDirectory)
    )
  ) {
    throw new Error("EDGE_EVER_DATA_DIR must be an absolute directory outside EDGE_EVER_APP_DIR");
  }
  const databaseFile = resolve(environment.EDGE_EVER_SQLITE_FILE ?? join(dataDirectory, "edgeever.sqlite"));
  const resourcesDirectory = resolve(environment.EDGE_EVER_RESOURCES_DIR ?? join(dataDirectory, "resources"));
  if (packagedRuntime) {
    for (const [name, path] of [
      ["EDGE_EVER_SQLITE_FILE", databaseFile],
      ["EDGE_EVER_RESOURCES_DIR", resourcesDirectory],
    ]) {
      if (isInsideDirectory(applicationDirectory, path)) {
        throw new Error(`${name} must be outside EDGE_EVER_APP_DIR`);
      }
    }
  }
  const hostname = environment.EDGE_EVER_HOST?.trim() || (packagedRuntime ? "127.0.0.1" : "0.0.0.0");
  if (packagedRuntime && hostname !== "127.0.0.1") {
    throw new Error("Packaged self-hosted runtime must bind to 127.0.0.1");
  }
  const storageBackend = (environment.EDGE_EVER_STORAGE_BACKEND ?? "local").trim().toLowerCase();

  if (!SUPPORTED_STORAGE_BACKENDS.has(storageBackend)) {
    throw new Error("EDGE_EVER_STORAGE_BACKEND must be either local or s3");
  }
  if (storageBackend === "s3" && !environment.EDGE_EVER_S3_BUCKET?.trim()) {
    throw new Error("EDGE_EVER_S3_BUCKET is required when EDGE_EVER_STORAGE_BACKEND=s3");
  }

  return {
    dataDirectory,
    databaseFile,
    resourcesDirectory,
    webDirectory: resolve(environment.EDGE_EVER_WEB_DIR ?? join(applicationDirectory, "apps/web/dist")),
    hostname,
    port: parseInteger(environment.PORT ?? environment.EDGE_EVER_PORT, 8787, "EDGE_EVER_PORT", 1, 65_535),
    idleTimeout: parseInteger(
      environment.EDGE_EVER_IDLE_TIMEOUT_SECONDS,
      120,
      "EDGE_EVER_IDLE_TIMEOUT_SECONDS",
      10,
      255,
    ),
    storageBackend,
  };
};
