import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { app, BrowserWindow, dialog, shell } from "electron";
import { resolveConfig } from "../server/config.ts";
import { startServer, type ServerRuntime } from "../server/runtime.ts";
import { desktopDataDirectoryOption, migrateLegacyDesktopDatabase } from "./dataDirectory.ts";
import { WorkerSessionIndexer } from "./workerIndexer.ts";

let mainWindow: BrowserWindow | null = null;
let runtime: ServerRuntime | null = null;
let closing = false;

const createWindow = async (): Promise<void> => {
  if (runtime === null) {
    const dataDir = desktopDataDirectoryOption(process.argv);
    const config = resolveConfig({
      ...(dataDir === undefined ? {} : { dataDir }),
      hostname: "127.0.0.1",
      port: "0",
    });
    const migration = await migrateLegacyDesktopDatabase(app.getPath("userData"), config.dataDir);
    if (migration !== "skipped") {
      process.stdout.write(`[desktop] Legacy database ${migration} into ${config.dataDir}\n`);
    }
    runtime = await startServer(config, {
      clientDirectory: join(app.getAppPath(), "dist", "client"),
      createIndexer: (_database, providers) => new WorkerSessionIndexer(
        new Worker(join(__dirname, "indexWorker.cjs"), {
          workerData: {
            dataDir: config.dataDir,
            providers: providers.map(({ id, home }) => ({ id, home })),
          },
        }),
        providers,
      ),
    });
  }

  const allowedOrigin = new URL(runtime.url).origin;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f7f5ef",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== allowedOrigin) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(runtime.url);
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(createWindow).catch((error: unknown) => {
    dialog.showErrorBox("AI Session Search", String(error));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (runtime === null || closing) return;
    event.preventDefault();
    closing = true;
    void runtime.close().finally(() => {
      runtime = null;
      app.quit();
    });
  });
}
