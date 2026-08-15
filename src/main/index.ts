import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from "electron";
import { join } from "node:path";
import { createWorkspace, loadWorkspaces, recoverAllInterruptedTurns } from "./storage/workspaceStore";
import { listConversations, readConversation, sendMessage, startConversation } from "./storage/conversations";

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
	ipcMain.handle("conversations:start", (_event, workspaceId: string, content: string) =>
		startConversation(root, workspaceId, content),
	);
	ipcMain.handle("conversations:send", (_event, workspaceId: string, conversationId: string, content: string) =>
		sendMessage(root, workspaceId, conversationId, content),
	);

	await recoverAllInterruptedTurns(root);
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
