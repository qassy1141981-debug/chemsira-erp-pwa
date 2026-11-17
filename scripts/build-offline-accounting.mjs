import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const publicDir = process.env.ACCOUNTING_PUBLIC_DIR || path.join(workspaceRoot, "artifacts/accounting/public");
const mobileAsset = path.join(
  workspaceRoot,
  "artifacts/accounting-mobile/assets/accounting-app.json",
);
const desktopDir = path.join(
  workspaceRoot,
  "artifacts/accounting/desktop/offline",
);

const [sourceHtml, css, sourceScript, storageScript] = await Promise.all([
  readFile(path.join(publicDir, "index.html"), "utf8"),
  readFile(path.join(publicDir, "assets/index-DqJGh83Z.css"), "utf8"),
  readFile(path.join(publicDir, "assets/index-chemsira.js"), "utf8"),
  readFile(path.join(publicDir, "local-storage-status.js"), "utf8"),
]);

const statusStyles = sourceHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1];
if (!statusStyles) {
  throw new Error("Could not find the local-save indicator styles.");
}

let appScript = sourceScript;

const updateActionStart = appScript.indexOf(
  'b=async()=>{if(!f){c("offline"),we.error(',
);
const updateActionEndMarker = "},y=async()=>";
const updateActionEnd =
  updateActionStart < 0
    ? -1
    : appScript.indexOf(updateActionEndMarker, updateActionStart);
if (updateActionStart < 0 || updateActionEnd < 0) {
  throw new Error("Could not locate the web-only update action.");
}
appScript =
  appScript.slice(0, updateActionStart) +
  'b=async()=>{c("offline"),we.error("تحديث التطبيق يحتاج اتصالاً بالإنترنت.")},y=async()=>' +
  appScript.slice(updateActionEnd + updateActionEndMarker.length);

const serviceWorkerGuard =
  /if\(!\("serviceWorker"\s*in\s*navigator\)\)return;/g;
const guardMatches = appScript.match(serviceWorkerGuard)?.length ?? 0;
if (guardMatches !== 1) {
  throw new Error(
    `Expected one service-worker update hook, found ${guardMatches}.`,
  );
}
appScript = appScript.replace(serviceWorkerGuard, "return;");

function escapeHtmlTagContent(value, tagName) {
  return value.replace(new RegExp(`</${tagName}`, "gi"), `<\\/${tagName}`);
}

const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#1e2a4a" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; media-src data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" />
    <title>النظام المحاسبي المتكامل</title>
    <style>${escapeHtmlTagContent(css, "style")}</style>
    <style>${escapeHtmlTagContent(statusStyles, "style")}</style>
    <script>
      try {
        let theme = localStorage.getItem("theme");
        if (theme === "system" || !theme) {
          theme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        }
        document.documentElement.classList.add(theme);
      } catch {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <button id="local-save-status" type="button" data-state="checking" aria-live="polite" hidden>
      جارٍ التحقق من التخزين المحلي…
    </button>
    <script>${escapeHtmlTagContent(storageScript, "script")}</script>
    <script type="module">${escapeHtmlTagContent(appScript, "script")}</script>
  </body>
</html>
`;

await mkdir(path.dirname(mobileAsset), { recursive: true });
await mkdir(desktopDir, { recursive: true });
await Promise.all([
  writeFile(mobileAsset, JSON.stringify(html), "utf8"),
  writeFile(path.join(desktopDir, "index.html"), html, "utf8"),
]);

const require = createRequire(process.env.ACCOUNTING_BUILD_PACKAGE || path.join(workspaceRoot, "artifacts/accounting/package.json"));
const shimPath = require.resolve("indexeddbshim/dist/indexeddbshim-noninvasive.min.js");
const [shim, transportSource, bootstrap] = await Promise.all([
  readFile(shimPath, "utf8"),
  readFile(path.join(workspaceRoot, "native/storage/websql.js"), "utf8"),
  readFile(path.join(workspaceRoot, "native/storage/bootstrap.js"), "utf8"),
]);
const { build } = require("esbuild");
const transport = (await build({
  stdin: { contents: transportSource, resolveDir: path.dirname(shimPath) },
  bundle: true, write: false, platform: "browser", format: "iife", target: "chrome100",
  define: { global: "globalThis" },
})).outputFiles[0].text;
const nativeHtml = html.replace(
  `<script>${escapeHtmlTagContent(storageScript, "script")}</script>`,
  "",
).replace(
  '<script type="module">',
  () => `<script>${escapeHtmlTagContent(transport, "script")}</script>
    <script>${escapeHtmlTagContent(shim, "script")}</script>
    <script>${escapeHtmlTagContent(bootstrap, "script")}</script>
    <script type="module">await window.nativeStorageReady;
    ${escapeHtmlTagContent(storageScript, "script")};`,
);
await writeFile(path.join(desktopDir, "native.html"), nativeHtml, "utf8");
await writeFile(
  path.join(desktopDir, "../sqlite.cjs"),
  await readFile(path.join(workspaceRoot, "native/storage/sqlite.cjs"), "utf8"),
  "utf8",
);
const androidAssets = path.join(workspaceRoot, "native/android/app/src/main/assets");
await mkdir(androidAssets, { recursive: true });
await writeFile(path.join(androidAssets, "accounting.html"), nativeHtml, "utf8");
const windowsAssets = path.join(workspaceRoot, "native/windows/offline");
await mkdir(windowsAssets, { recursive: true });
await writeFile(path.join(windowsAssets, "native.html"), nativeHtml, "utf8");
await writeFile(
  path.join(workspaceRoot, "native/windows/sqlite.cjs"),
  await readFile(path.join(workspaceRoot, "native/storage/sqlite.cjs"), "utf8"),
);

console.log(
  `Built self-contained offline app (${Buffer.byteLength(html)} bytes).`,
);
