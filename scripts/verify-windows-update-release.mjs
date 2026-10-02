import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_UPDATE_MANIFEST_NAME,
  WINDOWS_UPDATE_SIGNATURE_NAME,
  verifyDownloadedWindowsUpdate,
  verifyWindowsUpdateMetadata,
} from "../apps/desktop/src/main/windows-update-trust.mjs";
import { verifySelfHostedWindowsRelease } from "./verify-self-hosted-windows-release.mjs";

export const verifyWindowsUpdateRelease = async (directory, {
  trustedPublicKeys,
} = {}) => {
  const manifestBytes = readFileSync(join(directory, WINDOWS_UPDATE_MANIFEST_NAME));
  const signatureBytes = readFileSync(join(directory, WINDOWS_UPDATE_SIGNATURE_NAME));
  const untrustedManifest = JSON.parse(manifestBytes.toString("utf8"));
  const manifest = verifyWindowsUpdateMetadata({
    manifestBytes,
    signatureBytes,
    expectedVersion: untrustedManifest.version,
    updateInfo: {
      version: untrustedManifest.version,
      files: [{
        url: untrustedManifest.file?.name,
        size: untrustedManifest.file?.size,
        sha512: untrustedManifest.file?.sha512,
      }],
    },
    ...(trustedPublicKeys ? { trustedPublicKeys } : {}),
  });
  const expectedNames = [
    manifest.file.name,
    manifest.selfHosted?.name,
    "latest.yml",
    WINDOWS_UPDATE_MANIFEST_NAME,
    WINDOWS_UPDATE_SIGNATURE_NAME,
    "SHA256SUMS-windows.txt",
  ].filter(Boolean).sort();
  const actualNames = readdirSync(directory).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Windows update audit expected exactly: ${expectedNames.join(", ")}`);
  }
  await verifyDownloadedWindowsUpdate({
    path: join(directory, manifest.file.name),
    manifest,
  });
  if (manifest.selfHosted) {
    const selfHostedManifest = await verifySelfHostedWindowsRelease({
      directory,
      expectedVersion: manifest.version,
      ...(trustedPublicKeys ? { trustedPublicKeys } : {}),
    });
    if (JSON.stringify(selfHostedManifest) !== JSON.stringify(manifest)) {
      throw new Error("Self-hosted release manifest does not match the signed Windows update manifest");
    }
  }

  const latestYml = readFileSync(join(directory, "latest.yml"), "utf8");
  const expectedLatestYml = [
    `version: ${manifest.version}`,
    "files:",
    `  - url: ${manifest.file.name}`,
    `    sha512: ${manifest.file.sha512}`,
    `    size: ${manifest.file.size}`,
    `path: ${manifest.file.name}`,
    `sha512: ${manifest.file.sha512}`,
    `releaseDate: '${manifest.releaseDate}'`,
    "",
  ].join("\n");
  if (latestYml !== expectedLatestYml) {
    throw new Error("latest.yml does not exactly match the signed manifest");
  }
  const checksum = readFileSync(join(directory, "SHA256SUMS-windows.txt"), "utf8");
  if (checksum !== `${manifest.file.sha256}  ${manifest.file.name}\n`) {
    throw new Error("SHA256SUMS-windows.txt does not match the signed manifest");
  }
  return manifest;
};

const run = async () => {
  const [directoryValue] = process.argv.slice(2);
  if (!directoryValue) {
    throw new Error("Usage: node scripts/verify-windows-update-release.mjs <directory>");
  }
  const manifest = await verifyWindowsUpdateRelease(resolve(directoryValue));
  process.stdout.write(`Verified ${manifest.file.name} with ${manifest.keyId}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
