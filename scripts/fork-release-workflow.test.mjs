import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  new URL("../.github/workflows/fork-release.yml", import.meta.url),
  "utf8",
);

describe("fork Windows release workflow", () => {
  test("builds unsigned assets for offline signed publication", () => {
    expect(workflow).toContain("github.repository == '1JayPeng/edgeever'");
    expect(workflow).toContain("release_tag:");
    expect(workflow).toContain("ref: refs/tags/${{ inputs.release_tag }}");
    expect(workflow).toContain('$tagRef = "refs/tags/$env:RELEASE_TAG"');
    expect(workflow).toContain('git fetch --force origin "main:refs/remotes/origin/main" "${tagRef}:${tagRef}"');
    expect(workflow).toContain('if ($LASTEXITCODE -ne 0) {\n            throw "Could not fetch release tag and main"');
    expect(workflow).toContain("git show-ref --verify --quiet $tagRef");
    expect(workflow).toContain('git rev-parse --verify --end-of-options "${tagRef}^{commit}"');
    expect(workflow).not.toContain('git rev-parse "${tagRef}^{commit}"');
    expect(workflow).not.toContain('git rev-parse "${env:RELEASE_TAG}^{commit}"');
    expect(workflow).toContain('$mainCommit = (git rev-parse --verify --end-of-options "refs/remotes/origin/main^{commit}").Trim()');
    expect(workflow).toContain("git merge-base --is-ancestor $tagCommit $mainCommit");
    expect(workflow).toContain('throw "release_tag must resolve to a commit reachable from main"');
    expect(workflow).toContain('if ($tagCommit -ne (git rev-parse HEAD).Trim()) {');
    expect(workflow).toContain('throw "checked-out source does not match release_tag"');
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5");
    expect(workflow).toContain("uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2");
    expect(workflow).toContain("uses: dtolnay/rust-toolchain@6bed0761d98439e5a578e2877258200ad565ba87 # stable");
    expect(workflow).toContain('toolchain: "1.98.1"');
    expect(workflow).toContain("create-windows-update-metadata.mjs");
    expect(workflow).toContain("bun run test:release-planning");
    expect(workflow).toContain("scripts/self-hosted-release-layout.test.mjs scripts/verify-self-hosted-windows-release.test.mjs");
    expect(workflow).toContain("release/desktop/EdgeEver-*-windows-x64.exe");
    expect(workflow).not.toContain("bun-version:");
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("edgeever-self-hosted-$version-windows-x64.zip");
    expect(workflow).toContain("edgeever-self-hosted.exe");
    expect(workflow).toContain("--compile");
    expect(workflow).toContain("--target=bun-windows-x64");
    expect(workflow).toContain('New-Item -ItemType Directory -Force -Path "$bundleRoot/apps/web", "$bundleRoot/migrations", $probeData | Out-Null');
    expect(workflow).toContain('Copy-Item migrations/* "$bundleRoot/migrations" -Recurse');
    expect(workflow).not.toContain('Copy-Item migrations "$bundleRoot/migrations" -Recurse');
    expect(workflow).toContain("Self-hosted bundle smoke test");
    expect(workflow).toContain("Create unsigned Windows update metadata with self-hosted binding");
    expect(workflow).toContain("--self-hosted $bundlePath --revision $revision");
    expect(workflow).toContain("EDGE_EVER_DATA_DIR");
    expect(workflow).toContain("Remove-Item Env:EDGE_EVER_APP_DIR");
    expect(workflow).not.toContain("$env:EDGE_EVER_APP_DIR =");
    expect(workflow).not.toContain("EDGE_EVER_ALLOW_UNAUTHENTICATED");
    expect(workflow).not.toContain("SHA256SUMS-self-hosted.txt");
    expect(workflow).toContain("uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6");
    expect(workflow).toContain("edgeever-fork-release-${{ inputs.release_tag }}");
    expect(workflow).not.toContain("EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY");
    expect(workflow).not.toContain("sign-self-hosted-release-manifest.mjs");
    expect(workflow).not.toContain("gh release edit");
  });
});
