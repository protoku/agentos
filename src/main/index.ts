import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from "electron";
import { join } from "node:path";
import { createWorkspace, loadWorkspaces, recoverAllInterruptedTurns } from "./storage/workspaceStore";
import {
	archiveConversation,
	listConversations,
	readConversation,
	sendMessage,
	startConversation,
} from "./storage/conversations";
import { createAgent, listAgents, updateAgent, type AgentDraft } from "./storage/agents";
import { builtinToolMetadata } from "./tools/builtin";
import { invokeTool } from "./tools/invoke";
import { decide, type Decision } from "./turns/decisions";
import { isTurnRunning, runMentionedTurns } from "./turns/run";
import type { Entry } from "../shared/types";
import type { Agent } from "../shared/types";

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

Menu.setApplicationMenu(null);
// The theme is dark by design, so the OS preference never gets a say.
nativeTheme.themeSource = "dark";

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		show: false,
		backgroundColor: "#0a0a0a",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
		},
	});

	window.on("ready-to-show", () => window.show());

	if (rendererUrl) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

void app.whenReady().then(async () => {
	const root = app.getPath("userData");

	ipcMain.handle("workspaces:list", () => loadWorkspaces(root));
	ipcMain.handle("workspaces:create", (_event, name: string) => createWorkspace(root, name));
	ipcMain.handle("conversations:list", (_event, workspaceId: string) => listConversations(root, workspaceId));
	ipcMain.handle("conversations:read", (_event, workspaceId: string, conversationId: string) =>
		readConversation(root, workspaceId, conversationId),
	);
	ipcMain.handle("conversations:start", async (_event, workspaceId: string, content: string) => {
		const started = await startConversation(root, workspaceId, content);
		startTurns(root, workspaceId, started.conversation.id, started.message.mentions);
		return started;
	});
	ipcMain.handle("conversations:send", async (_event, workspaceId: string, conversationId: string, content: string) => {
		refuseWhileTurnRuns(conversationId);
		const message = await sendMessage(root, workspaceId, conversationId, content);
		startTurns(root, workspaceId, conversationId, message.mentions);
		return message;
	});
	ipcMain.handle("conversations:archive", (_event, workspaceId: string, conversationId: string) =>
		archiveConversation(root, workspaceId, conversationId),
	);
	ipcMain.handle("agents:list", (_event, workspaceId: string) => listAgents(root, workspaceId));
	ipcMain.handle("agents:create", (_event, workspaceId: string, draft: AgentDraft) =>
		createAgent(root, workspaceId, draft),
	);
	ipcMain.handle("agents:update", (_event, workspaceId: string, agent: Agent) =>
		updateAgent(root, workspaceId, agent),
	);
	ipcMain.handle("tools:list", () => builtinToolMetadata());
	ipcMain.handle("tools:decide", (_event, callId: string, decision: Decision) => decide(callId, decision));
	ipcMain.handle(
		"tools:invoke",
		(_event, workspaceId: string, conversationId: string, toolId: string, input: Record<string, unknown>) => {
			refuseWhileTurnRuns(conversationId);
			return invokeTool(root, workspaceId, conversationId, toolId, input);
		},
	);

	await recoverAllInterruptedTurns(root);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

/** The thread has one writer at a time: while an agent acts, the user cannot add to it. */
function refuseWhileTurnRuns(conversationId: string): void {
	if (isTurnRunning(conversationId)) throw new Error("An agent is acting in this conversation");
}

function startTurns(root: string, workspaceId: string, conversationId: string, mentions?: string[]): void {
	if (mentions === undefined || mentions.length === 0) return;

	void runMentionedTurns(root, workspaceId, conversationId, mentions, (entry: Entry) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.send("thread:entry", workspaceId, conversationId, entry);
		}
	});
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
