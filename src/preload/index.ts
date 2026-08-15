import { contextBridge, ipcRenderer } from "electron";
import type { AgentOSApi } from "../shared/api";

const api: AgentOSApi = {
	listWorkspaces: () => ipcRenderer.invoke("workspaces:list"),
	createWorkspace: (name) => ipcRenderer.invoke("workspaces:create", name),
};

contextBridge.exposeInMainWorld("agentOS", api);
