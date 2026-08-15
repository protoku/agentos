import { contextBridge, ipcRenderer } from "electron";
import type { AgentOSApi } from "../shared/api";

const api: AgentOSApi = {
	listWorkspaces: () => ipcRenderer.invoke("workspaces:list"),
	createWorkspace: (name) => ipcRenderer.invoke("workspaces:create", name),
	listConversations: (workspaceId) => ipcRenderer.invoke("conversations:list", workspaceId),
	readConversation: (workspaceId, conversationId) =>
		ipcRenderer.invoke("conversations:read", workspaceId, conversationId),
	startConversation: (workspaceId, content) => ipcRenderer.invoke("conversations:start", workspaceId, content),
	sendMessage: (workspaceId, conversationId, content) =>
		ipcRenderer.invoke("conversations:send", workspaceId, conversationId, content),
};

contextBridge.exposeInMainWorld("agentOS", api);
