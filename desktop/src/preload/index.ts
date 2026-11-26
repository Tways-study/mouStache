import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type DesktopApi, type EngineReply, type EngineRequest } from '../shared/api';

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
};

contextBridge.exposeInMainWorld('mouDesktop', api);
