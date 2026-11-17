const { app, BrowserWindow, dialog, protocol, session, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createSQLiteBridge } = require("./sqlite.cjs");

const APP_URL_PREFIX = "accounting://app/";
const PARTITION = "persist:alsafa-accounting";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "accounting",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.setName("AlsafaAccounting");
app.commandLine.appendSwitch("disable-http-cache");
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});

function showInternetRequiredNotice() {
  void dialog.showMessageBox({
    type: "info",
    title: "الاتصال بالإنترنت مطلوب",
    message: "هذه الخدمة أو الصفحة تحتاج إلى اتصال بالإنترنت.",
  });
}

function isLocalAppUrl(url) {
  return typeof url === "string" && url.startsWith(APP_URL_PREFIX);
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "AlsafaAccounting"),
  );

  const htmlPath = path.join(__dirname, "offline", "native.html");
  const html = await fs.readFile(htmlPath);
  const database = createSQLiteBridge(path.join(app.getPath("userData"), "databases"));
  ipcMain.on("accounting:sqlite", (event, json) => {
    if (!isLocalAppUrl(event.senderFrame?.url) || typeof json !== "string") {
      event.returnValue = JSON.stringify({ ok: false, error: "Untrusted storage request" });
      return;
    }
    event.returnValue = database.request(json);
  });
  app.on("will-quit", () => database.close());

  const accountingSession = session.fromPartition(PARTITION);
  accountingSession.protocol.handle("accounting", async (request) => {
    if (request.method !== "GET" || !isLocalAppUrl(request.url)) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });

  accountingSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );

  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 920,
    minHeight: 640,
    show: false,
    icon: path.join(__dirname, "app.ico"),
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalAppUrl(url)) showInternetRequiredNotice();
    return { action: "deny" };
  });

  const blockExternalNavigation = (event, url) => {
    if (isLocalAppUrl(url)) return;
    event.preventDefault();
    showInternetRequiredNotice();
  };

  window.webContents.on("will-navigate", blockExternalNavigation);
  window.webContents.on("will-redirect", blockExternalNavigation);
  window.once("ready-to-show", () => window.show());
  await window.loadURL(`${APP_URL_PREFIX}index.html`);
});

app.on("window-all-closed", () => app.quit());
