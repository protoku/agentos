import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import { join } from "node:path";
import { claudeCodeMissing, claudeCodePath } from "./agents/claudeCode";
import { adoptShellPath } from "./environment";
import { createWorkspace, loadWorkspace, loadWorkspaces, recoverAllInterruptedTurns } from "./storage/workspaceStore";
import { deleteWorkspace } from "./storage/workspaces";
import {
	archiveConversation,
	listConversations,
	readConversation,
	renameConversation,
	sendMessage,
	startConversation,
	startConversationWithTool,
	startConversationWithWorkflow,
} from "./storage/conversations";
import { createAgent, listAgents, updateAgent, type AgentDraft } from "./storage/agents";
import { createSource, listSources, updateSource, deleteSource, type SourceDraft } from "./storage/sources";
import { cancelWorkflow, isWorkflowRunning, runWorkflow, whenWorkflowSettles } from "./workflows/run";
import {
	createWorkflow,
	deleteWorkflow,
	listWorkflows,
	updateWorkflow,
	type WorkflowDraft,
} from "./storage/workflows";
import { createMemory, deleteMemory, listMemories, updateMemory } from "./storage/memories";
import { readEnv, setEnv } from "./storage/env";
import {
	createScriptTool,
	listScriptTools,
	updateScriptTool,
	deleteScriptTool,
	type ScriptToolDraft,
} from "./storage/scriptTools";
import { builtinToolMetadata } from "./tools/builtin";
import { invokeTool, isCallRunning } from "./tools/invoke";
import { sandboxDiff } from "./tools/diff";
import { mountStates } from "./tools/mountState";
import { viewSandboxPath } from "./tools/viewer";
import { cancelRuling, cancelRulings, rule } from "./turns/decisions";
import { cancelTurn, isTurnRunning, runMentionedTurns } from "./turns/run";
import { parseSlashCommand } from "../shared/slash";
import type { Entry } from "../shared/types";
import type { MemoryDraft } from "../shared/api";
import type { Agent, Memory, ScriptTool, Workflow } from "../shared/types";

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

// macOS dispatches the clipboard shortcuts through the Edit menu's roles, so with no menu at all
// there is no copy or paste. Its menu bar is the system's, not the window's, so nothing appears here.
Menu.setApplicationMenu(
	process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]) : null,
);
// The theme is dark by design, so the OS preference never gets a say.
nativeTheme.themeSource = "dark";

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		show: false,
		backgroundColor: "#0b0c0f",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
		},
	});

	window.on("ready-to-show", () => window.show());

	// A link an agent wrote opens in the browser: the window itself never navigates away.
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});
	window.webContents.on("will-navigate", (event, url) => {
		if (url === window.webContents.getURL()) return;

		event.preventDefault();
		void shell.openExternal(url);
	});

	if (rendererUrl) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

void app.whenReady().then(async () => {
	const root = app.getPath("userData");

	// Before anything can spawn a command, so tools and git hooks see the path you have in a shell.
	await adoptShellPath();

	ipcMain.handle("agents:runtime", async () => ({
		found: (await claudeCodePath()) !== undefined,
		missing: claudeCodeMissing,
	}));
	ipcMain.handle("workspaces:list", () => loadWorkspaces(root));
	ipcMain.handle("workspaces:create", (_event, name: string) => createWorkspace(root, name));
	// Deleting is never blocked: it cancels what is in flight in every conversation, as archiving would.
	ipcMain.handle("workspaces:delete", (_event, workspaceId: string) => deleteWorkspace(root, workspaceId));
	ipcMain.handle("conversations:list", (_event, workspaceId: string) => listConversations(root, workspaceId));
	ipcMain.handle("conversations:read", (_event, workspaceId: string, conversationId: string) =>
		readConversation(root, workspaceId, conversationId),
	);
	ipcMain.handle("conversations:start", async (_event, workspaceId: string, content: string) => {
		const started = await startConversation(root, workspaceId, content);
		startTurns(root, workspaceId, started.conversation.id, started.message.mentions);
		return started;
	});
	ipcMain.handle("conversations:startWithTool", async (_event, workspaceId: string, content: string) => {
		const command = parseSlashCommand(content);
		if (command === undefined) throw new Error("Not a tool call");

		const started = await startConversationWithTool(root, workspaceId, content, command, (conversationId) =>
			broadcast(workspaceId, conversationId),
		);

		return started;
	});
	ipcMain.handle("conversations:send", async (_event, workspaceId: string, conversationId: string, content: string) => {
		refuseWhileBusy(conversationId);
		const message = await sendMessage(root, workspaceId, conversationId, content);
		startTurns(root, workspaceId, conversationId, message.mentions);
		return message;
	});
	ipcMain.handle("conversations:rename", (_event, workspaceId: string, conversationId: string, title: string) =>
		renameConversation(root, workspaceId, conversationId, title),
	);
	ipcMain.handle("conversations:archive", async (_event, workspaceId: string, conversationId: string) => {
		// Archiving is never blocked: it cancels whatever is in flight, as canceling the turn would.
		cancelTurn(conversationId);
		cancelWorkflow(conversationId);
		cancelRulings(conversationId);
		// A run unwinds over several steps, and its sandbox may not go while one is still writing in it.
		await whenWorkflowSettles(conversationId);

		return archiveConversation(root, workspaceId, conversationId);
	});
	ipcMain.handle("conversations:openSandbox", async (_event, workspaceId: string, conversationId: string) => {
		const workspace = await loadWorkspace(root, workspaceId);
		const sandbox = workspace.conversations.find((candidate) => candidate.id === conversationId)?.sandbox;
		if (sandbox === undefined) throw new Error("This conversation has no sandbox yet");

		const failure = await shell.openPath(sandbox);
		if (failure.length > 0) throw new Error(failure);
	});
	ipcMain.handle("conversations:mountStates", (_event, workspaceId: string, conversationId: string) =>
		mountStates(root, workspaceId, conversationId),
	);
	ipcMain.handle("sandbox:diff", (_event, workspaceId: string, conversationId: string, path: string) =>
		sandboxDiff(root, workspaceId, conversationId, path),
	);
	ipcMain.handle("sandbox:view", (_event, workspaceId: string, conversationId: string, path: string) =>
		viewSandboxPath(root, workspaceId, conversationId, path),
	);
	ipcMain.handle("turns:cancel", (_event, conversationId: string) => {
		// One press ends a run of any length, whichever kind of run holds the thread.
		cancelTurn(conversationId);
		cancelWorkflow(conversationId);
	});
	ipcMain.handle("tools:cancel", (_event, callId: string) => cancelRuling(callId));
	ipcMain.handle("agents:list", (_event, workspaceId: string) => listAgents(root, workspaceId));
	ipcMain.handle("agents:create", (_event, workspaceId: string, draft: AgentDraft) =>
		createAgent(root, workspaceId, draft),
	);
	ipcMain.handle("agents:update", (_event, workspaceId: string, agent: Agent) =>
		updateAgent(root, workspaceId, agent),
	);
	ipcMain.handle("memories:list", (_event, workspaceId: string) => listMemories(root, workspaceId));
	ipcMain.handle("memories:create", (_event, workspaceId: string, draft: MemoryDraft) =>
		createMemory(root, workspaceId, draft),
	);
	ipcMain.handle("memories:update", (_event, workspaceId: string, memory: Memory) =>
		updateMemory(root, workspaceId, memory),
	);
	// The one thing inside a workspace that goes on its own, since a wrong memory keeps being told.
	ipcMain.handle("memories:delete", (_event, workspaceId: string, memoryId: string) =>
		deleteMemory(root, workspaceId, memoryId),
	);
	ipcMain.handle("env:read", (_event, workspaceId: string) => readEnv(root, workspaceId));
	ipcMain.handle("env:set", (_event, workspaceId: string, key: string, value?: string) =>
		setEnv(root, workspaceId, key, value),
	);
	ipcMain.handle("sources:list", (_event, workspaceId: string) => listSources(root, workspaceId));
	ipcMain.handle("sources:create", (_event, workspaceId: string, draft: SourceDraft) =>
		createSource(root, workspaceId, draft),
	);
	ipcMain.handle("sources:update", (_event, workspaceId: string, sourceId: string, description: string) =>
		updateSource(root, workspaceId, sourceId, description),
	);
	ipcMain.handle("sources:delete", (_event, workspaceId: string, sourceId: string) =>
		deleteSource(root, workspaceId, sourceId),
	);
	ipcMain.handle("tools:list", () => builtinToolMetadata());
	ipcMain.handle("workflows:list", (_event, workspaceId: string) => listWorkflows(root, workspaceId));
	ipcMain.handle(
		"workflows:start",
		(_event, workspaceId: string, conversationId: string, name: string, input: Record<string, unknown>) => {
			refuseWhileBusy(conversationId);
			void started(root, workspaceId, conversationId, name, input);
		},
	);
	ipcMain.handle(
		"workflows:startConversation",
		async (_event, workspaceId: string, content: string, name: string, input: Record<string, unknown>) => {
			const conversation = await startConversationWithWorkflow(root, workspaceId, content);
			void started(root, workspaceId, conversation.id, name, input);

			return conversation;
		},
	);
	ipcMain.handle("workflows:create", (_event, workspaceId: string, draft: WorkflowDraft) =>
		createWorkflow(root, workspaceId, draft),
	);
	ipcMain.handle("workflows:update", (_event, workspaceId: string, workflow: Workflow) =>
		updateWorkflow(root, workspaceId, workflow),
	);
	ipcMain.handle("workflows:delete", (_event, workspaceId: string, workflowId: string) =>
		deleteWorkflow(root, workspaceId, workflowId),
	);
	ipcMain.handle("tools:listScripts", (_event, workspaceId: string) => listScriptTools(root, workspaceId));
	ipcMain.handle("tools:createScript", (_event, workspaceId: string, draft: ScriptToolDraft) =>
		createScriptTool(root, workspaceId, draft),
	);
	ipcMain.handle("tools:updateScript", (_event, workspaceId: string, tool: ScriptTool) =>
		updateScriptTool(root, workspaceId, tool),
	);
	ipcMain.handle("tools:deleteScript", (_event, workspaceId: string, toolId: string) =>
		deleteScriptTool(root, workspaceId, toolId),
	);
	ipcMain.handle("tools:decide", (_event, callId: string, decision: { allowed: boolean; denyMessage?: string }) =>
		rule(callId, decision.allowed ? { type: "allowed" } : { type: "denied", denyMessage: decision.denyMessage }),
	);
	ipcMain.handle("tools:answer", (_event, callId: string, answers: Record<string, unknown>) =>
		rule(callId, { type: "answered", answers }),
	);
	ipcMain.handle(
		"tools:invoke",
		(_event, workspaceId: string, conversationId: string, toolId: string, input: Record<string, unknown>) => {
			refuseWhileBusy(conversationId);
			return invokeTool(root, workspaceId, conversationId, toolId, input, broadcast(workspaceId, conversationId));
		},
	);

	await recoverAllInterruptedTurns(root);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

/** The thread has one writer at a time: a turn or a user call occupies it until it settles. */
function refuseWhileBusy(conversationId: string): void {
	if (isTurnRunning(conversationId)) throw new Error("An agent is acting in this conversation");
	if (isCallRunning(conversationId)) throw new Error("A tool call is running in this conversation");
	if (isWorkflowRunning(conversationId)) throw new Error("A workflow is running in this conversation");
}

/** The run itself is what holds the conversation, so starting it hands the thread over. */
async function started(
	root: string,
	workspaceId: string,
	conversationId: string,
	name: string,
	input: Record<string, unknown>,
): Promise<void> {
	const workflow = (await listWorkflows(root, workspaceId)).find((candidate) => candidate.name === name);
	if (workflow === undefined) throw new Error(`No workflow ${name}`);

	await runWorkflow(root, workspaceId, conversationId, workflow, input, broadcast(workspaceId, conversationId));
}

function broadcast(workspaceId: string, conversationId: string) {
	return (entry: Entry) => {
		for (const window of BrowserWindow.getAllWindows()) {
			window.webContents.send("thread:entry", workspaceId, conversationId, entry);
		}
	};
}

function startTurns(root: string, workspaceId: string, conversationId: string, mentions?: string[]): void {
	if (mentions === undefined || mentions.length === 0) return;

	void runMentionedTurns(root, workspaceId, conversationId, mentions, broadcast(workspaceId, conversationId));
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
