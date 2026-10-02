import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_UPDATE_KEY_ID,
  WINDOWS_UPDATE_MANIFEST_NAME,
} from "../apps/desktop/src/main/windows-update-trust.mjs";

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const REVISION = /^[0-9a-f]{40}$/;

const hashFile = (path, algorithm, encoding) => new Promise((resolveHash, rejectHash) => {
  const hash = createHash(algorithm);
  const stream = createReadStream(path);
  stream.on("error", rejectHash);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", () => resolveHash(hash.digest(encoding)));
});

const createSelfHostedMetadata = async ({ selfHostedPath, revision, version }) => {
  if (!selfHostedPath && !revision) return {};
  if (!selfHostedPath || !revision || !REVISION.test(revision)) {
    throw new Error("Self-hosted release metadata requires an archive and a 40-character revision");
  }
  const name = basename(selfHostedPath);
  if (name !== `edgeever-self-hosted-${version}-windows-x64.zip`) {
    throw new Error(`Self-hosted archive name must be edgeever-self-hosted-${version}-windows-x64.zip`);
  }
  const stats = statSync(selfHostedPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`Self-hosted archive is missing or empty: ${selfHostedPath}`);
  }
  return {
    revision,
    selfHosted: {
      name,
      size: stats.size,
      sha256: await hashFile(selfHostedPath, "sha256", "hex"),
    },
  };
};

export const createWindowsUpdateMetadata = async ({ directory, version, selfHostedPath, revision }) => {
  if (!STABLE_VERSION.test(version)) {
    throw new Error(`Windows update version must be stable X.Y.Z: ${version}`);
  }
  const installerName = `EdgeEver-${version}-windows-x64.exe`;
  const installerPath = join(directory, installerName);
  const stats = statSync(installerPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`Windows installer is missing or empty: ${installerPath}`);
  }
  const [sha512, sha256] = await Promise.all([
    hashFile(installerPath, "sha512", "base64"),
    hashFile(installerPath, "sha256", "hex"),
  ]);
  const releaseDate = new Date().toISOString();
  const selfHosted = await createSelfHostedMetadata({ selfHostedPath, revision, version });
  const manifest = {
    schemaVersion: 1,
    keyId: WINDOWS_UPDATE_KEY_ID,
    version,
    platform: "win32",
    arch: "x64",
    releaseDate,
    file: {
      name: installerName,
      size: stats.size,
      sha512,
      sha256,
    },
    ...selfHosted,
  };
  writeFileSync(
    join(directory, WINDOWS_UPDATE_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(join(directory, "latest.yml"), [
    `version: ${version}`,
    "files:",
    `  - url: ${installerName}`,
    `    sha512: ${sha512}`,
    `    size: ${stats.size}`,
    `path: ${installerName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n"));
  writeFileSync(
    join(directory, "SHA256SUMS-windows.txt"),
    `${sha256}  ${installerName}\n`,
  );
  return manifest;
};

const run = async () => {
  const [directoryValue, version, ...options] = process.argv.slice(2);
  if (!directoryValue || !version) {
    throw new Error("Usage: node scripts/create-windows-update-metadata.mjs <directory> <version> [--self-hosted <archive> --revision <sha>]");
  }
  const parsed = {};
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    if (!value || !["--self-hosted", "--revision"].includes(key) || parsed[key]) {
      throw new Error("Expected optional --self-hosted <archive> and --revision <sha> arguments");
    }
    parsed[key] = value;
  }
  const directory = resolve(directoryValue);
  const packageVersion = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  if (version !== packageVersion) {
    throw new Error(`Requested version ${version} does not match desktop package version ${packageVersion}`);
  }
  const manifest = await createWindowsUpdateMetadata({
    directory,
    version,
    selfHostedPath: parsed["--self-hosted"],
    revision: parsed["--revision"],
  });
  process.stdout.write(`${basename(directory)}: ${manifest.file.name}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
