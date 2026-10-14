import { contextBridge, ipcRenderer } from "electron";
import type { Action, DesktopAPI, Snapshot } from "../shared/model";
const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke("snapshot"),
  action: (action: Action) => ipcRenderer.invoke("action", action),
  chooseXray: () => ipcRenderer.invoke("choose-xray"),
  onSnapshot: (callback: (state: Snapshot) => void) => {
    const listener = (_: Electron.IpcRendererEvent, state: Snapshot) =>
      callback(state);
    ipcRenderer.on("snapshot-changed", listener);
    return () => ipcRenderer.removeListener("snapshot-changed", listener);
  },
  window: (action) => ipcRenderer.send("window", action),
};
contextBridge.exposeInMainWorld("desktop", api);
