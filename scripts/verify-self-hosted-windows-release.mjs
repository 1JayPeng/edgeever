import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { unzipSync } from "fflate";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WINDOWS_UPDATE_KEY_ID,
  WINDOWS_UPDATE_MANIFEST_NAME,
  WINDOWS_UPDATE_PUBLIC_KEY_PEM,
  WINDOWS_UPDATE_SIGNATURE_NAME,
} from "../apps/desktop/src/main/windows-update-trust.mjs";

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const REVISION = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_METADATA_BYTES = 64 * 1024;

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const parseJson = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
};

const assertManifest = (manifest, expectedVersion) => {
  const selfHosted = manifest?.selfHosted;
  if (
    manifest?.schemaVersion !== 1
    || manifest.keyId !== WINDOWS_UPDATE_KEY_ID
    || manifest.version !== expectedVersion
    || !STABLE_VERSION.test(manifest.version)
    || !REVISION.test(manifest.revision)
    || manifest.platform !== "win32"
    || manifest.arch !== "x64"
    || typeof selfHosted?.name !== "string"
    || selfHosted.name !== `edgeever-self-hosted-${expectedVersion}-windows-x64.zip`
    || !Number.isSafeInteger(selfHosted.size)
    || selfHosted.size <= 0
    || !SHA256_HEX.test(selfHosted.sha256)
  ) {
    throw new Error("Self-hosted release metadata fields are invalid");
  }
  return manifest;
};

const verifyManifestSignature = ({ manifestBytes, signatureBytes, trustedPublicKeys }) => {
  if (manifestBytes.byteLength === 0 || manifestBytes.byteLength > MAX_METADATA_BYTES) {
    throw new Error("Self-hosted release manifest has an invalid size");
  }
  const signatureEnvelope = parseJson(signatureBytes, "Self-hosted release signature");
  if (
    signatureEnvelope?.schemaVersion !== 1
    || signatureEnvelope.keyId !== WINDOWS_UPDATE_KEY_ID
    || typeof signatureEnvelope.signature !== "string"
  ) {
    throw new Error("Self-hosted release signature fields are invalid");
  }
  const signature = Buffer.from(signatureEnvelope.signature, "base64");
  const publicKey = trustedPublicKeys[signatureEnvelope.keyId];
  const verificationKey = publicKey?.type === "public" ? publicKey : publicKey ? createPublicKey(publicKey) : null;
  if (signature.byteLength !== 64 || !verificationKey || !verify(null, manifestBytes, verificationKey, signature)) {
    throw new Error("Self-hosted release manifest signature is invalid");
  }
};

const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const requiredArchiveFiles = new Set([
  "edgeever-self-hosted.exe",
  "apps/web/dist/index.html",
  "release.json",
]);
const isAllowedArchiveEntry = (name) => (
  requiredArchiveFiles.has(name)
  || ["apps/", "apps/web/", "apps/web/dist/", "migrations/"].includes(name)
  || name.startsWith("apps/web/dist/")
  || (name.startsWith("migrations/") && name.endsWith(".sql"))
);

const verifyArchivePayload = ({ archivePath, manifest }) => {
  let entries;
  let totalOriginalBytes = 0;
  try {
    entries = unzipSync(readFileSync(archivePath), {
      filter: (entry) => {
        if (
          entry.originalSize < 0
          || entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES
          || entry.name.startsWith("/")
          || entry.name.split("/").includes("..")
          || !isAllowedArchiveEntry(entry.name)
        ) {
          throw new Error("Self-hosted release archive contains an unsafe entry");
        }
        totalOriginalBytes += entry.originalSize;
        if (totalOriginalBytes > MAX_ARCHIVE_BYTES) {
          throw new Error("Self-hosted release archive exceeds the extraction limit");
        }
        return requiredArchiveFiles.has(entry.name) || entry.name.startsWith("migrations/");
      },
    });
  } catch (error) {
    if (error.message?.startsWith("Self-hosted release archive")) throw error;
    throw new Error("Self-hosted release archive cannot be extracted");
  }

  const release = parseJson(Buffer.from(entries["release.json"] ?? []), "Extracted self-hosted release identity");
  if (
    release?.schemaVersion !== 1
    || release.version !== manifest.version
    || release.revision !== manifest.revision
  ) {
    throw new Error("Extracted self-hosted release identity does not match the signed manifest");
  }
  for (const file of requiredArchiveFiles) {
    if (!entries[file]?.byteLength) {
      throw new Error(`Self-hosted release archive is missing ${file}`);
    }
  }
  if (!Object.entries(entries).some(([name, bytes]) => name.startsWith("migrations/") && name.endsWith(".sql") && bytes.byteLength > 0)) {
    throw new Error("Self-hosted release archive is missing migrations");
  }
};

export const verifySelfHostedWindowsRelease = async ({
  directory,
  expectedVersion,
  trustedPublicKeys = { [WINDOWS_UPDATE_KEY_ID]: WINDOWS_UPDATE_PUBLIC_KEY_PEM },
}) => {
  if (!STABLE_VERSION.test(expectedVersion)) {
    throw new Error(`Self-hosted release version must be stable X.Y.Z: ${expectedVersion}`);
  }
  const root = resolve(directory);
  const manifestBytes = readFileSync(join(root, WINDOWS_UPDATE_MANIFEST_NAME));
  const signatureBytes = readFileSync(join(root, WINDOWS_UPDATE_SIGNATURE_NAME));
  verifyManifestSignature({ manifestBytes, signatureBytes, trustedPublicKeys });
  const manifest = assertManifest(parseJson(manifestBytes, "Self-hosted release manifest"), expectedVersion);
  const archivePath = join(root, manifest.selfHosted.name);
  const stats = statSync(archivePath);
  if (!stats.isFile() || stats.size !== manifest.selfHosted.size || sha256File(archivePath) !== manifest.selfHosted.sha256) {
    throw new Error("Self-hosted release archive checksum does not match the signed manifest");
  }
  verifyArchivePayload({ archivePath, manifest });
  return manifest;
};

export const verifyExtractedSelfHostedWindowsRelease = ({ directory, manifest }) => {
  const root = resolve(directory);
  assertManifest(manifest, manifest.version);
  const releasePath = join(root, "release.json");
  const release = parseJson(readFileSync(releasePath), "Extracted self-hosted release identity");
  if (
    release?.schemaVersion !== 1
    || release.version !== manifest.version
    || release.revision !== manifest.revision
  ) {
    throw new Error("Extracted self-hosted release identity does not match the signed manifest");
  }
  for (const path of [
    join(root, "edgeever-self-hosted.exe"),
    join(root, "apps", "web", "dist", "index.html"),
  ]) {
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size <= 0) {
      throw new Error(`Extracted self-hosted release is missing ${path}`);
    }
  }
  const migrationsDirectory = join(root, "migrations");
  if (
    !existsSync(migrationsDirectory)
    || !statSync(migrationsDirectory).isDirectory()
    || !readdirSync(migrationsDirectory).some((name) => name.endsWith(".sql"))
  ) {
    throw new Error(`Extracted self-hosted release is missing migrations: ${migrationsDirectory}`);
  }
  return true;
};

const run = async () => {
  const [directory, expectedVersion] = process.argv.slice(2);
  if (!directory || !expectedVersion) {
    throw new Error("Usage: node scripts/verify-self-hosted-windows-release.mjs <directory> <version>");
  }
  const manifest = await verifySelfHostedWindowsRelease({ directory, expectedVersion });
  process.stdout.write(`Verified ${manifest.selfHosted.name} with ${manifest.keyId}\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
