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
	archiveConversation: (workspaceId, conversationId) =>
		ipcRenderer.invoke("conversations:archive", workspaceId, conversationId),
	listAgents: (workspaceId) => ipcRenderer.invoke("agents:list", workspaceId),
	createAgent: (workspaceId, draft) => ipcRenderer.invoke("agents:create", workspaceId, draft),
	updateAgent: (workspaceId, agent) => ipcRenderer.invoke("agents:update", workspaceId, agent),
	invokeTool: (workspaceId, conversationId, toolId, input) =>
		ipcRenderer.invoke("tools:invoke", workspaceId, conversationId, toolId, input),
};

contextBridge.exposeInMainWorld("agentOS", api);
