import { contextBridge, ipcRenderer } from "electron";
import type { AgentOSApi } from "../shared/api";
import type { Entry } from "../shared/types";

const api: AgentOSApi = {
	agentRuntime: () => ipcRenderer.invoke("agents:runtime"),
	listWorkspaces: () => ipcRenderer.invoke("workspaces:list"),
	createWorkspace: (name) => ipcRenderer.invoke("workspaces:create", name),
	listConversations: (workspaceId) => ipcRenderer.invoke("conversations:list", workspaceId),
	readConversation: (workspaceId, conversationId) =>
		ipcRenderer.invoke("conversations:read", workspaceId, conversationId),
	startConversation: (workspaceId, content) => ipcRenderer.invoke("conversations:start", workspaceId, content),
	startConversationWithTool: (workspaceId, content) =>
		ipcRenderer.invoke("conversations:startWithTool", workspaceId, content),
	sendMessage: (workspaceId, conversationId, content) =>
		ipcRenderer.invoke("conversations:send", workspaceId, conversationId, content),
	archiveConversation: (workspaceId, conversationId) =>
		ipcRenderer.invoke("conversations:archive", workspaceId, conversationId),
	openSandbox: (workspaceId, conversationId) =>
		ipcRenderer.invoke("conversations:openSandbox", workspaceId, conversationId),
	viewSandboxPath: (workspaceId, conversationId, path) =>
		ipcRenderer.invoke("sandbox:view", workspaceId, conversationId, path),
	listAgents: (workspaceId) => ipcRenderer.invoke("agents:list", workspaceId),
	createAgent: (workspaceId, draft) => ipcRenderer.invoke("agents:create", workspaceId, draft),
	updateAgent: (workspaceId, agent) => ipcRenderer.invoke("agents:update", workspaceId, agent),
	readEnv: (workspaceId) => ipcRenderer.invoke("env:read", workspaceId),
	setEnv: (workspaceId, key, value) => ipcRenderer.invoke("env:set", workspaceId, key, value),
	listSources: (workspaceId) => ipcRenderer.invoke("sources:list", workspaceId),
	createSource: (workspaceId, draft) => ipcRenderer.invoke("sources:create", workspaceId, draft),
	listTools: () => ipcRenderer.invoke("tools:list"),
	listScriptTools: (workspaceId) => ipcRenderer.invoke("tools:listScripts", workspaceId),
	createScriptTool: (workspaceId, draft) => ipcRenderer.invoke("tools:createScript", workspaceId, draft),
	updateScriptTool: (workspaceId, tool) => ipcRenderer.invoke("tools:updateScript", workspaceId, tool),
	decideToolCall: (callId, decision) => ipcRenderer.invoke("tools:decide", callId, decision),
	cancelTurn: (conversationId) => ipcRenderer.invoke("turns:cancel", conversationId),
	cancelToolCall: (callId) => ipcRenderer.invoke("tools:cancel", callId),
	invokeTool: (workspaceId, conversationId, toolId, input) =>
		ipcRenderer.invoke("tools:invoke", workspaceId, conversationId, toolId, input),
	onThreadEntry: (listener) => {
		const handler = (_event: unknown, workspaceId: string, conversationId: string, entry: Entry) =>
			listener(workspaceId, conversationId, entry);

		ipcRenderer.on("thread:entry", handler);
		return () => void ipcRenderer.off("thread:entry", handler);
	},
};

contextBridge.exposeInMainWorld("agentOS", api);
