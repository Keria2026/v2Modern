import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  Tray,
} from "electron";
import { release } from "node:os";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { StateStore } from "./store";
import { CoreManager } from "./core-manager";
import { WindowsSystemProxy } from "./system-proxy";
import { AppService } from "./service";
let window: BrowserWindow;
let tray: Tray;
let service: AppService;
let quitting = false;
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn);
  queue = task.catch(() => {});
  return task;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const directory = app.getPath("userData");
      const secure =
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text");
      const store = new StateStore(
        directory,
        secure
          ? {
              encrypt: (v) => safeStorage.encryptString(v),
              decrypt: (v) => safeStorage.decryptString(v),
            }
          : null,
      );
      const state = await store.load();
      const forkPath = app.isPackaged
        ? join(process.resourcesPath, "core", "v2ray.exe")
        : resolve(
            __dirname,
            "../../resources/core",
            process.platform === "win32" ? "v2ray.exe" : "v2ray",
          );
      const proxy = new WindowsSystemProxy(
        join(directory, "proxy-recovery.json"),
        (message) => service?.log(message),
      );
      await proxy.restore();
      await unlink(join(directory, "runtime", "active-config.json")).catch(
        (e) => {
          if (e.code !== "ENOENT") throw e;
        },
      );
      const materialSupported =
        process.platform === "win32" &&
        Number(release().split(".")[2]) >= 22621;
      const appearance = () => ({
        materialAvailable: materialSupported,
        systemReduceTransparency:
          nativeTheme.prefersReducedTransparency ||
          nativeTheme.shouldUseHighContrastColors,
      });
      const core = new CoreManager(
        join(directory, "runtime"),
        forkPath,
        proxy,
        process.platform === "win32"
          ? join(forkPath, "..", "jobhost.exe")
          : undefined,
      );
      service = new AppService(
        state,
        store,
        core,
        app.getVersion(),
        net.fetch,
        appearance,
      );
      nativeTheme.themeSource = state.settings.theme;
      window = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 960,
        minHeight: 660,
        show: false,
        frame: false,
        backgroundColor:
          materialSupported &&
          !state.settings.reduceTransparency &&
          !appearance().systemReduceTransparency
            ? "#00000000"
            : nativeTheme.shouldUseDarkColors
              ? "#141926"
              : "#f2f4f8",
        icon: join(__dirname, "../../assets/icon.png"),
        webPreferences: {
          preload: join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const updateMaterial = () => {
        const glass =
          materialSupported &&
          !service.state.settings.reduceTransparency &&
          !appearance().systemReduceTransparency;
        if (materialSupported)
          window.setBackgroundMaterial(glass ? "acrylic" : "none");
        window.setBackgroundColor(
          glass
            ? "#00000000"
            : nativeTheme.shouldUseDarkColors
              ? "#141926"
              : "#f2f4f8",
        );
      };
      const applyAppearance = () => {
        nativeTheme.themeSource = service.state.settings.theme;
        updateMaterial();
      };
      nativeTheme.on("updated", () => {
        updateMaterial();
        service.emit("change");
      });
      applyAppearance();
      const valid = (
        event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
      ) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("无效窗口来源");
      };
      ipcMain.handle("snapshot", (event) => {
        valid(event);
        return service.snapshot();
      });
      ipcMain.handle("action", (event, action) => {
        valid(event);
        return serial(async () => {
          try {
            const snapshot = await service.action(action);
            applyAppearance();
            return snapshot;
          } catch (e) {
            const message = e instanceof Error ? e.message : "操作失败";
            service.log(message, "error");
            throw new Error(message);
          }
        });
      });
      ipcMain.handle("choose-xray", async (event) => {
        valid(event);
        const result = await dialog.showOpenDialog(window, {
          title: "选择 Xray 内核",
          properties: ["openFile"],
          filters:
            process.platform === "win32"
              ? [{ name: "可执行文件", extensions: ["exe"] }]
              : [],
        });
        return result.canceled ? null : result.filePaths[0];
      });
      ipcMain.on("window", (event, action) => {
        valid(event);
        if (action === "minimize") window.minimize();
        if (action === "maximize")
          window.isMaximized() ? window.unmaximize() : window.maximize();
        if (action === "close") window.hide();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      window.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          window.hide();
        }
      });
      tray = new Tray(
        nativeImage
          .createFromPath(join(__dirname, "../../assets/icon.png"))
          .resize({ width: 32, height: 32 }),
      );
      tray.setToolTip("V2 Modern · 双击打开，右键退出");
      tray.on("double-click", () => window.show());
      const updateTray = () =>
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "打开 V2 Modern", click: () => window.show() },
            {
              label:
                core.connection.status === "connected"
                  ? "断开连接"
                  : "连接所选节点",
              enabled:
                core.connection.status === "connected" ||
                !!service.state.selectedId,
              click: () => {
                void serial(() =>
                  service.action(
                    core.connection.status === "connected"
                      ? { type: "disconnect" }
                      : { type: "connect", id: service.state.selectedId! },
                  ),
                ).catch((e) => {
                  service.log(String(e), "error");
                  window.show();
                });
              },
            },
            { type: "separator" },
            { label: "退出并恢复系统代理", click: () => app.quit() },
          ]),
        );
      let publishTimer: NodeJS.Timeout | undefined;
      service.on("change", () => {
        updateTray();
        if (!publishTimer)
          publishTimer = setTimeout(() => {
            publishTimer = undefined;
            void service.snapshot().then((snapshot) => {
              if (!window.isDestroyed())
                window.webContents.send("snapshot-changed", snapshot);
            });
          }, 75);
      });
      updateTray();
      await window.loadFile(join(__dirname, "../renderer/index.html"));
      window.show();
      app.on("activate", () => window.show());
    })
    .catch((error) => {
      dialog.showErrorBox(
        "V2 Modern 启动失败",
        error instanceof Error ? error.message : "请检查配置和系统凭据存储",
      );
      quitting = true;
      app.quit();
    });
  app.on("before-quit", (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    void serial(() => service.core.disconnect())
      .then(() => {
        quitting = true;
        tray?.destroy();
        app.quit();
      })
      .catch(() => {
        window?.show();
        dialog.showErrorBox(
          "系统代理恢复失败",
          "请检查 Windows 代理设置后重试退出；客户端暂时保持运行。",
        );
      });
  });
}
