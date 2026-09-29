
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ZOTERO_ITEM_PATH = /^\/library\/items\/([A-Za-z0-9]{1,32})$/;

export const isAllowedZoteroUrl = (targetUrl) => {
  try {
    const target = new URL(targetUrl);
    if (
      target.protocol !== "zotero:"
      || !["select", "open-pdf"].includes(target.hostname)
      || target.username
      || target.password
      || target.port
      || target.hash
      || !ZOTERO_ITEM_PATH.test(target.pathname)
    ) return false;

    return target.search === "";
  } catch {
    return false;
  }
};

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
