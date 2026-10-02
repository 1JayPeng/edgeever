import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, test } from "bun:test";
import { WINDOWS_UPDATE_KEY_ID } from "../apps/desktop/src/main/windows-update-trust.mjs";
import {
  verifyExtractedSelfHostedWindowsRelease,
  verifySelfHostedWindowsRelease,
} from "./verify-self-hosted-windows-release.mjs";

const version = "1.90.1";
const revision = "a".repeat(40);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sha512 = (value) => createHash("sha512").update(value).digest("base64");
const releaseArchive = (archiveRevision = revision) => Buffer.from(zipSync({
  "edgeever-self-hosted.exe": Buffer.from("runtime"),
  "apps/web/dist/index.html": Buffer.from("<!doctype html>"),
  "migrations/0001.sql": Buffer.from("SELECT 1;"),
  "release.json": Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    version,
    revision: archiveRevision,
  })}\n`),
}));

const signedManifest = ({ privateKey, archive }) => {
  const manifest = {
    schemaVersion: 1,
    keyId: WINDOWS_UPDATE_KEY_ID,
    version,
    revision,
    platform: "win32",
    arch: "x64",
    releaseDate: "2026-09-30T00:00:00.000Z",
    file: {
      name: `EdgeEver-${version}-windows-x64.exe`,
      size: 7,
      sha512: sha512("payload"),
      sha256: hash("payload"),
    },
    selfHosted: {
      name: `edgeever-self-hosted-${version}-windows-x64.zip`,
      size: Buffer.byteLength(archive),
      sha256: hash(archive),
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const signatureBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    keyId: WINDOWS_UPDATE_KEY_ID,
    signature: sign(null, manifestBytes, privateKey).toString("base64"),
  })}\n`);
  return { manifest, manifestBytes, signatureBytes };
};

describe("self-hosted Windows release verification", () => {
  test("verifies the signed self-hosted archive independently of the desktop installer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-release-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const archive = releaseArchive();
    const signed = signedManifest({ privateKey, archive });
    try {
      await writeFile(join(directory, signed.manifest.selfHosted.name), archive);
      await writeFile(join(directory, "latest-windows.json"), signed.manifestBytes);
      await writeFile(join(directory, "latest-windows.json.sig"), signed.signatureBytes);

      await expect(verifySelfHostedWindowsRelease({
        directory,
        expectedVersion: version,
        trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: publicKey },
      })).resolves.toEqual(signed.manifest);

      await writeFile(join(directory, signed.manifest.selfHosted.name), "tampered");
      await expect(verifySelfHostedWindowsRelease({
        directory,
        expectedVersion: version,
        trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: publicKey },
      })).rejects.toThrow("checksum");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects a signed archive whose embedded release identity differs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-archive-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const archive = releaseArchive("b".repeat(40));
    const signed = signedManifest({ privateKey, archive });
    try {
      await writeFile(join(directory, signed.manifest.selfHosted.name), archive);
      await writeFile(join(directory, "latest-windows.json"), signed.manifestBytes);
      await writeFile(join(directory, "latest-windows.json.sig"), signed.signatureBytes);
      await expect(verifySelfHostedWindowsRelease({
        directory,
        expectedVersion: version,
        trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: publicKey },
      })).rejects.toThrow("identity");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects an archive that carries persistent data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-archive-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const archive = Buffer.from(zipSync({
      "edgeever-self-hosted.exe": Buffer.from("runtime"),
      "apps/web/dist/index.html": Buffer.from("<!doctype html>"),
      "migrations/0001.sql": Buffer.from("SELECT 1;"),
      "release.json": Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        version,
        revision,
      })}\n`),
      "edgeever.sqlite": Buffer.from("must-not-ship"),
    }));
    const signed = signedManifest({ privateKey, archive });
    try {
      await writeFile(join(directory, signed.manifest.selfHosted.name), archive);
      await writeFile(join(directory, "latest-windows.json"), signed.manifestBytes);
      await writeFile(join(directory, "latest-windows.json.sig"), signed.signatureBytes);
      await expect(verifySelfHostedWindowsRelease({
        directory,
        expectedVersion: version,
        trustedPublicKeys: { [WINDOWS_UPDATE_KEY_ID]: publicKey },
      })).rejects.toThrow("unsafe entry");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires extracted payload identity and migrations to match the signed release", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-extracted-"));
    const manifest = signedManifest({
      privateKey: generateKeyPairSync("ed25519").privateKey,
      archive: "self-hosted-release",
    }).manifest;
    try {
      await mkdir(join(directory, "apps", "web", "dist"), { recursive: true });
      await mkdir(join(directory, "migrations"), { recursive: true });
      await writeFile(join(directory, "edgeever-self-hosted.exe"), "runtime");
      await writeFile(join(directory, "apps", "web", "dist", "index.html"), "<!doctype html>");
      await writeFile(join(directory, "migrations", "0001.sql"), "SELECT 1;");
      await writeFile(join(directory, "release.json"), `${JSON.stringify({
        schemaVersion: 1,
        version,
        revision,
      })}\n`);

      expect(verifyExtractedSelfHostedWindowsRelease({ directory, manifest })).toBe(true);

      await writeFile(join(directory, "release.json"), `${JSON.stringify({
        schemaVersion: 1,
        version,
        revision: "b".repeat(40),
      })}\n`);
      expect(() => verifyExtractedSelfHostedWindowsRelease({ directory, manifest }))
        .toThrow("does not match");

      await writeFile(join(directory, "release.json"), `${JSON.stringify({
        schemaVersion: 1,
        version,
        revision,
      })}\n`);
      await rm(join(directory, "migrations"), { recursive: true, force: true });
      expect(() => verifyExtractedSelfHostedWindowsRelease({ directory, manifest }))
        .toThrow("migrations");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
