import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, test } from "bun:test";
import { createWindowsUpdateMetadata } from "./create-windows-update-metadata.mjs";
import {
  assertWindowsUpdateSigningKey,
  signWindowsUpdateManifest,
} from "./sign-windows-update-manifest.mjs";
import { verifyWindowsUpdateRelease } from "./verify-windows-update-release.mjs";

describe("Windows update release metadata", () => {
  test("creates installer metadata consumed by electron-updater and the trust gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-windows-metadata-"));
    try {
      await writeFile(join(directory, "EdgeEver-1.49.0-windows-x64.exe"), "payload");
      const manifest = await createWindowsUpdateMetadata({ directory, version: "1.49.0" });
      expect(manifest.file).toMatchObject({
        name: "EdgeEver-1.49.0-windows-x64.exe",
        size: 7,
        sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      });
      expect(await readFile(join(directory, "latest.yml"), "utf8"))
        .toContain(`sha512: ${manifest.file.sha512}`);
      expect(await readFile(join(directory, "SHA256SUMS-windows.txt"), "utf8"))
        .toBe(`${manifest.file.sha256}  ${manifest.file.name}\n`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("binds a self-hosted archive and revision into the signed metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-metadata-"));
    const version = "1.90.1";
    const revision = "a".repeat(40);
    const archiveName = `edgeever-self-hosted-${version}-windows-x64.zip`;
    const archive = Buffer.from("self-hosted-release");
    try {
      await writeFile(join(directory, `EdgeEver-${version}-windows-x64.exe`), "desktop-release");
      await writeFile(join(directory, archiveName), archive);

      const manifest = await createWindowsUpdateMetadata({
        directory,
        version,
        revision,
        selfHostedPath: join(directory, archiveName),
      });

      expect(manifest).toMatchObject({
        revision,
        selfHosted: {
          name: archiveName,
          size: archive.byteLength,
          sha256: createHash("sha256").update(archive).digest("hex"),
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("signs self-hosted archive metadata with the desktop trust key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-signing-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifestPath = join(directory, "latest-windows.json");
    const signaturePath = `${manifestPath}.sig`;
    const privateKeyPath = join(directory, "private.pem");
    const archiveName = "edgeever-self-hosted-1.90.1-windows-x64.zip";
    try {
      const archive = Buffer.from("self-hosted-release");
      await writeFile(join(directory, archiveName), archive);
      await writeFile(manifestPath, `${JSON.stringify({
        schemaVersion: 1,
        keyId: "edgeever-fork-windows-update-2026-09",
        version: "1.90.1",
        revision: "a".repeat(40),
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-09-30T00:00:00.000Z",
        file: {
          name: "EdgeEver-1.90.1-windows-x64.exe",
          size: 7,
          sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
          sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
        },
        selfHosted: {
          name: archiveName,
          size: archive.byteLength,
          sha256: createHash("sha256").update(archive).digest("hex"),
        },
      })}\n`);
      await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      expect(signWindowsUpdateManifest({
        manifestPath,
        signaturePath,
        privateKeyPath,
        expectedPublicKey: publicKey,
      }).signature).toHaveLength(88);
      expect(await readFile(signaturePath, "utf8")).toContain("signature");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("signs only with the private key matching the expected public key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-windows-signing-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
    const manifestPath = join(directory, "latest-windows.json");
    const signaturePath = `${manifestPath}.sig`;
    const privateKeyPath = join(directory, "private.pem");
    try {
      await writeFile(manifestPath, `${JSON.stringify({
        schemaVersion: 1,
        keyId: "edgeever-fork-windows-update-2026-09",
        version: "1.49.0",
        platform: "win32",
        arch: "x64",
        releaseDate: "2026-08-30T00:00:00.000Z",
        file: {
          name: "EdgeEver-1.49.0-windows-x64.exe",
          size: 7,
          sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
          sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
        },
      })}\n`);
      await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      expect(assertWindowsUpdateSigningKey({
        privateKeyPath,
        expectedPublicKey: publicKey,
      }).asymmetricKeyType).toBe("ed25519");
      expect(signWindowsUpdateManifest({
        manifestPath,
        signaturePath,
        privateKeyPath,
        expectedPublicKey: publicKey,
      }).signature).toHaveLength(88);
      expect(() => signWindowsUpdateManifest({
        manifestPath,
        signaturePath,
        privateKeyPath,
        expectedPublicKey: otherPublicKey,
      })).toThrow("does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("audits a signed self-hosted archive beside the desktop update assets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-release-audit-"));
    const keyDirectory = await mkdtemp(join(tmpdir(), "edgeever-self-hosted-release-key-"));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const version = "1.90.1";
    const archiveName = `edgeever-self-hosted-${version}-windows-x64.zip`;
    const privateKeyPath = join(keyDirectory, "private.pem");
    try {
      await writeFile(join(directory, `EdgeEver-${version}-windows-x64.exe`), "desktop-release");
      await writeFile(join(directory, archiveName), Buffer.from(zipSync({
        "edgeever-self-hosted.exe": Buffer.from("runtime"),
        "apps/web/dist/index.html": Buffer.from("<!doctype html>"),
        "migrations/0001.sql": Buffer.from("SELECT 1;"),
        "release.json": Buffer.from(`${JSON.stringify({
          schemaVersion: 1,
          version,
          revision: "a".repeat(40),
        })}\n`),
      })));
      await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
      await createWindowsUpdateMetadata({
        directory,
        version,
        selfHostedPath: join(directory, archiveName),
        revision: "a".repeat(40),
      });
      signWindowsUpdateManifest({
        manifestPath: join(directory, "latest-windows.json"),
        signaturePath: join(directory, "latest-windows.json.sig"),
        privateKeyPath,
        expectedPublicKey: publicKey,
      });

      try {
        const verified = await verifyWindowsUpdateRelease(directory, {
          trustedPublicKeys: { "edgeever-fork-windows-update-2026-09": publicKey },
        });
        expect(verified).toMatchObject({
          version,
          selfHosted: { name: archiveName },
        });
      } catch (error) {
        throw new Error(`self-hosted audit failed: ${error.message}`);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(keyDirectory, { recursive: true, force: true });
    }
  });

  test("authenticates metadata before inspecting release-directory contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-windows-audit-order-"));
    const manifest = {
      schemaVersion: 1,
      keyId: "edgeever-fork-windows-update-2026-09",
      version: "1.49.0",
      platform: "win32",
      arch: "x64",
      releaseDate: "2026-08-30T00:00:00.000Z",
      file: {
        name: "EdgeEver-1.49.0-windows-x64.exe",
        size: 7,
        sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
        sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      },
    };
    try {
      await writeFile(join(directory, "latest-windows.json"), `${JSON.stringify(manifest)}\n`);
      await writeFile(join(directory, "latest-windows.json.sig"), `${JSON.stringify({
        schemaVersion: 1,
        keyId: manifest.keyId,
        signature: `${"A".repeat(86)}==`,
      })}\n`);
      await writeFile(join(directory, "private.pem"), "untrusted extra");

      await expect(verifyWindowsUpdateRelease(directory))
        .rejects.toThrow("Windows update manifest signature");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("audits the complete production release asset set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edgeever-windows-release-audit-"));
    const manifest = {
      schemaVersion: 1,
      keyId: "edgeever-fork-windows-update-2026-09",
      version: "1.49.0",
      platform: "win32",
      arch: "x64",
      releaseDate: "2026-08-30T00:00:00.000Z",
      file: {
        name: "EdgeEver-1.49.0-windows-x64.exe",
        size: 7,
        sha512: "cLM86ckEfjD5F+fqE+Qvd2cAjD9PnJuvSeQ5D8YlVJ6WJe7jm5RUUHTooYJM8/I4RjsRvAPZc0jg/CmZyh//fw==",
        sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      },
    };
    try {
      await writeFile(join(directory, manifest.file.name), "payload");
      await writeFile(join(directory, "latest-windows.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(directory, "latest-windows.json.sig"), `${JSON.stringify({
        schemaVersion: 1,
        keyId: manifest.keyId,
        signature: "34cvdNwFsnnMjEXqUqk8P6q6pHLOxjTBRQ0LZIK+o8LC6h0cD0tBimRzAhL4O/qBZAFqs6mW6glXmM+0ebV0AQ==",
      })}\n`);
      await writeFile(join(directory, "latest.yml"), [
        `version: ${manifest.version}`,
        "files:",
        `  - url: ${manifest.file.name}`,
        `    sha512: ${manifest.file.sha512}`,
        `    size: ${manifest.file.size}`,
        `path: ${manifest.file.name}`,
        `sha512: ${manifest.file.sha512}`,
        `releaseDate: '${manifest.releaseDate}'`,
        "",
      ].join("\n"));
      await writeFile(
        join(directory, "SHA256SUMS-windows.txt"),
        `${manifest.file.sha256}  ${manifest.file.name}\n`,
      );
      await expect(verifyWindowsUpdateRelease(directory)).resolves.toEqual(manifest);
      await writeFile(join(directory, manifest.file.name), "tampered");
      await expect(verifyWindowsUpdateRelease(directory)).rejects.toThrow("size does not match");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
