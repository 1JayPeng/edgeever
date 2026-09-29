
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ZOTERO_URL = /^zotero:\/\/(?:select|open-pdf)\/library\/items\/[A-Za-z0-9]{1,32}$/;

export const isAllowedZoteroUrl = (targetUrl) => typeof targetUrl === "string" && ZOTERO_URL.test(targetUrl);

export const isAllowedPrintPreviewUrl = (targetUrl, appUrl) => {
  try {
    const target = new URL(targetUrl);
    const currentApp = new URL(appUrl);

    if (currentApp.protocol === "file:") {
      const expected = pathToFileURL(join(dirname(fileURLToPath(currentApp)), "note-print.html"));
      return target.protocol === "file:" && target.pathname === expected.pathname;
    }

    const expected = new URL("/note-print.html", currentApp);
    return target.protocol === expected.protocol &&
      target.hostname === expected.hostname &&
      target.port === expected.port &&
      target.pathname === expected.pathname;
  } catch {
    return false;
  }
};
