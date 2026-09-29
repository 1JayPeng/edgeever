import { describe, expect, test } from "bun:test";
import { isAllowedPrintPreviewUrl, isAllowedZoteroUrl } from "./window-open-policy.mjs";

describe("desktop window open policy", () => {
  test("allows only the packaged print preview beside the app entry", () => {
    const webDirectory = process.platform === "win32"
      ? "file:///C:/EdgeEver/web/"
      : "file:///Applications/EdgeEver.app/Contents/Resources/web/";
    const appUrl = `${webDirectory}index.html`;

    expect(isAllowedPrintPreviewUrl(`${webDirectory}note-print.html?token=abc`, appUrl)).toBe(true);
    expect(isAllowedPrintPreviewUrl("file:///note-print.html?token=abc", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl(
      "file:///Applications/EdgeEver.app/Contents/Resources/web/mobile-edit.html",
      appUrl,
    )).toBe(false);
  });

  test("allows only Zotero select and PDF deep links", () => {
    expect(isAllowedZoteroUrl("zotero://select/library/items/ARTICLE01")).toBe(true);
    expect(isAllowedZoteroUrl("zotero://open-pdf/library/items/PDF00001")).toBe(true);
    expect(isAllowedZoteroUrl("zotero://open-pdf/library/items/PDF00001?page=12")).toBe(false);
    expect(isAllowedZoteroUrl("zotero://open-pdf/groups/123/items/PDF00001")).toBe(false);
    expect(isAllowedZoteroUrl("zotero://select/library/items/../private")).toBe(false);
    expect(isAllowedZoteroUrl("zotero://open-pdf/library/items/")).toBe(false);
    expect(isAllowedZoteroUrl("zotero://preferences/advanced")).toBe(false);
    expect(isAllowedZoteroUrl("https://zotero.org/library/items/ARTICLE01")).toBe(false);
  });

  test("allows the same-origin print preview in desktop development", () => {
    const appUrl = "http://127.0.0.1:5173/";

    expect(isAllowedPrintPreviewUrl("http://127.0.0.1:5173/note-print.html?token=abc", appUrl)).toBe(true);
    expect(isAllowedPrintPreviewUrl("https://example.com/note-print.html", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl("http://127.0.0.1:5173/settings", appUrl)).toBe(false);
  });

  test("allows only the print preview on the private desktop origin", () => {
    const appUrl = "edgeever-app://app/index.html";

    expect(isAllowedPrintPreviewUrl("edgeever-app://app/note-print.html?token=abc", appUrl)).toBe(true);
    expect(isAllowedPrintPreviewUrl("edgeever-app://other/note-print.html", appUrl)).toBe(false);
    expect(isAllowedPrintPreviewUrl("edgeever-app://app/mobile-edit.html", appUrl)).toBe(false);
  });
});
