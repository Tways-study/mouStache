import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type BlipRender, type RegionShow, type DesktopApi, type EngineReply, type EngineRequest } from '../shared/api';

const api: DesktopApi = {
  send: (msg) => ipcRenderer.invoke(CH.send, msg),
  onMessage(cb) {
    const handler = (_e: IpcRendererEvent, msg: unknown) => cb(msg);
    ipcRenderer.on(CH.message, handler);
    return () => void ipcRenderer.removeListener(CH.message, handler);
  },
  serveEngine(handler) {
    ipcRenderer.on(CH.engineRequest, (_e, req: EngineRequest) => {
      handler(req.msg).then(
        (result) => ipcRenderer.send(CH.engineReply, { id: req.id, result } satisfies EngineReply),
        (e: unknown) =>
          ipcRenderer.send(CH.engineReply, {
            id: req.id,
            result: { ok: false, error: e instanceof Error ? e.message : String(e) },
          } satisfies EngineReply),
      );
    });
    ipcRenderer.send(CH.engineReady);
  },
  openExternal: (url) => ipcRenderer.invoke(CH.openExternal, url),
  pushSettings: (settings) => ipcRenderer.send(CH.settings, settings),
  markOwnWrite: (w) => ipcRenderer.send(CH.ownWrite, w),
  getLoginItem: () => ipcRenderer.invoke(CH.getLogin),
  setLoginItem: (open) => ipcRenderer.invoke(CH.setLogin, open),
  onBlip: (cb) => void ipcRenderer.on(CH.blip, (_e, r: BlipRender) => cb(r)),
  paletteChoose: (req) => ipcRenderer.send(CH.paletteChoose, req),
  paletteClose: () => ipcRenderer.send(CH.paletteClose),
  paletteReady: () => ipcRenderer.send(CH.paletteReady),
  onPaletteShow: (cb) => void ipcRenderer.on(CH.paletteShow, () => cb()),
  onRegionShow: (cb) => void ipcRenderer.on(CH.regionShow, (_e, r: RegionShow) => cb(r)),
  regionDone: (dataUrl) => ipcRenderer.send(CH.regionDone, dataUrl),
  regionCancel: () => ipcRenderer.send(CH.regionCancel),
  getHotkeyStatus: () => ipcRenderer.invoke(CH.hotkeyStatus),
};

contextBridge.exposeInMainWorld('mouDesktop', api);
