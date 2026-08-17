import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Agents } from "./Agents";
import { Conversations } from "./Conversations";
import { Env } from "./Env";
import { Sources } from "./Sources";
import { Tools } from "./Tools";
import { pathOf, Thread } from "./Thread";
import { Viewer } from "./Viewer";
import { parseSlashCommand } from "../../shared/slash";
import type { ConversationSummary } from "../../shared/api";
import type { Agent, Entry, Tool, ToolCall, Workspace } from "../../shared/types";

const sections = ["conversations", "agents", "tools", "sources", "env"] as const;

type Section = (typeof sections)[number];

const sectionTitles: Record<Section, string> = {
	conversations: "Conversations",
	agents: "Agents",
	tools: "Tools",
	sources: "Sources",
	env: "Env",
};

const sidebarConversations = 20;

/** A call that acted on the open path is a new version of what the viewer is showing. */
function touches(call: ToolCall, path: string): boolean {
	return pathOf(call) === path;
}

export function App() {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [workspaceId, setWorkspaceId] = useState<string>();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationId, setConversationId] = useState<string>();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [agents, setAgents] = useState<Agent[]>([]);
	const [tools, setTools] = useState<Tool[]>([]);
	const [drafting, setDrafting] = useState(false);
	const [section, setSection] = useState<Section>();
	const [name, setName] = useState("");
	const [naming, setNaming] = useState(false);
	const [runtime, setRuntime] = useState<{ found: boolean; missing: string }>();
	const [viewing, setViewing] = useState<string>();

	useEffect(() => {
		void window.agentOS.listWorkspaces().then(setWorkspaces);
		void window.agentOS.agentRuntime().then(setRuntime);
	}, []);

	/**
	 * What the thread can name: agents and tools, reloaded whenever a pane that edits them is
	 * left, not only when the workspace changes. An agent created a moment ago is one the thread
	 * has to know about, or it cannot complete its @name or say who is working.
	 */
	useEffect(() => {
		if (workspaceId === undefined) return;

		void window.agentOS.listAgents(workspaceId).then(setAgents);
		void Promise.all([window.agentOS.listTools(), window.agentOS.listScriptTools(workspaceId)]).then(
			([builtin, scripts]) => setTools([...builtin, ...scripts]),
		);
	}, [workspaceId, section]);

	// Entries an acting agent adds arrive here, not from the call that started its turn.
	useEffect(() => {
		return window.agentOS.onThreadEntry((forWorkspace, forConversation, entry) => {
			if (forWorkspace !== workspaceId || forConversation !== conversationId) return;

			// A pending call settles in place: the same id arrives again, decided.
			setEntries((current) =>
				current.some((existing) => existing.id === entry.id)
					? current.map((existing) => (existing.id === entry.id ? entry : existing))
					: [...current, entry],
			);
			if (entry.type === "turnEnd") void window.agentOS.listConversations(forWorkspace).then(setConversations);
		});
	}, [workspaceId, conversationId]);

	useEffect(() => {
		setConversationId(undefined);
		setDrafting(false);
		setEntries([]);
		if (workspaceId === undefined) {
			setAgents([]);
			return setConversations([]);
		}

		void window.agentOS.listConversations(workspaceId).then(setConversations);
	}, [workspaceId]);

	function stopNaming() {
		setNaming(false);
		setName("");
	}

	async function createWorkspace() {
		const trimmed = name.trim();
		if (trimmed.length === 0) return stopNaming();

		const workspace = await window.agentOS.createWorkspace(trimmed);
		setWorkspaces((current) => [...current, workspace]);
		setWorkspaceId(workspace.id);
		stopNaming();
	}

	async function openThread(id: string) {
		if (workspaceId === undefined) return;

		setViewing(undefined);
		setDrafting(false);
		setSection(undefined);
		setConversationId(id);
		setEntries(await window.agentOS.readConversation(workspaceId, id));
	}

	function draft() {
		setViewing(undefined);
		setDrafting(true);
		setSection(undefined);
		setConversationId(undefined);
		setEntries([]);
	}

	async function cancel() {
		if (conversationId === undefined) return;

		await window.agentOS.cancelTurn(conversationId);
	}

	async function openSandbox() {
		if (workspaceId === undefined || conversationId === undefined) return;

		await window.agentOS.openSandbox(workspaceId, conversationId);
	}

	async function archive() {
		if (workspaceId === undefined || conversationId === undefined) return;

		await window.agentOS.archiveConversation(workspaceId, conversationId);
		setConversations(await window.agentOS.listConversations(workspaceId));
	}

	async function send(content: string) {
		if (workspaceId === undefined) return;

		const command = parseSlashCommand(content);
		if (command && conversationId !== undefined) {
			// The call reaches the thread as it runs and again once final, so it is not added here.
			await window.agentOS.invokeTool(workspaceId, conversationId, command.toolId, command.input);
			return setConversations(await window.agentOS.listConversations(workspaceId));
		}

		if (command) {
			const { conversation, call } = await window.agentOS.startConversationWithTool(workspaceId, content);
			setDrafting(false);
			setConversationId(conversation.id);
			setEntries([call]);
			return setConversations(await window.agentOS.listConversations(workspaceId));
		}

		if (conversationId === undefined) {
			const { conversation, message } = await window.agentOS.startConversation(workspaceId, content);
			setDrafting(false);
			setConversationId(conversation.id);
			setEntries([message]);
		} else {
			const message = await window.agentOS.sendMessage(workspaceId, conversationId, content);
			setEntries((current) => [...current, message]);
		}

		setConversations(await window.agentOS.listConversations(workspaceId));
	}

	const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
	const listed = conversations.filter((conversation) => !conversation.archivedAt).slice(0, sidebarConversations);
	const openConversation = conversations.find((conversation) => conversation.id === conversationId);

	return (
		<div className="flex h-full flex-col">
			{runtime?.found === false && (
				<p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
					{runtime.missing}
				</p>
			)}

			<div className="flex min-h-0 flex-1">
			<aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
				<div className="flex items-center gap-1 border-b border-border p-2">
					<Select value={workspaceId ?? ""} onValueChange={setWorkspaceId}>
						<SelectTrigger className="w-full border-transparent">
							<SelectValue placeholder="No workspace" />
						</SelectTrigger>
						<SelectContent>
							{workspaces.map((candidate) => (
								<SelectItem key={candidate.id} value={candidate.id}>
									{candidate.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Button variant="ghost" size="icon-sm" aria-label="New workspace" onClick={() => setNaming(true)}>
						<Plus />
					</Button>
				</div>

				{naming && (
					<div className="p-2">
						<Input
							autoFocus
							value={name}
							placeholder="Workspace name"
							onChange={(event) => setName(event.target.value)}
							onBlur={() => void createWorkspace()}
							onKeyDown={(event) => {
								if (event.key === "Enter") void createWorkspace();
								if (event.key === "Escape") stopNaming();
							}}
						/>
					</div>
				)}

				{workspace && (
					<div className="flex items-center justify-between py-1 pr-2 pl-4">
						<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Conversations
						</span>
						<Button variant="ghost" size="icon-sm" aria-label="New conversation" onClick={draft}>
							<Plus />
						</Button>
					</div>
				)}

				<div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 pt-0">
					{drafting && <SidebarItem selected>New conversation</SidebarItem>}
					{listed.map((conversation) => (
						<SidebarItem
							key={conversation.id}
							selected={conversation.id === conversationId}
							onClick={() => void openThread(conversation.id)}
						>
							{conversation.title}
						</SidebarItem>
					))}
				</div>

				<nav className="flex flex-col gap-0.5 border-t border-border p-2">
					{sections.map((current) => (
						<button
							key={current}
							type="button"
							disabled={workspace === undefined}
							onClick={() => setSection(current === section ? undefined : current)}
							className={cn(
								"rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-40",
								current === section
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
							)}
						>
							{sectionTitles[current]}
						</button>
					))}
				</nav>
			</aside>

			{workspace === undefined ? (
				<main className="grid flex-1 place-items-center text-sm text-muted-foreground">
					No workspace selected
				</main>
			) : section === "conversations" ? (
				<Conversations conversations={conversations} onOpen={(id) => void openThread(id)} />
			) : section === "agents" ? (
				<Agents workspaceId={workspace.id} />
			) : section === "sources" ? (
				<Sources workspaceId={workspace.id} />
			) : section === "env" ? (
				<Env workspaceId={workspace.id} />
			) : section === "tools" ? (
				<Tools workspaceId={workspace.id} />
			) : drafting || openConversation ? (
				<Thread
					// Each conversation composes on its own: a draft here never follows you to another.
					key={conversationId ?? "draft"}
					title={openConversation?.title ?? "New conversation"}
					entries={entries}
					agents={agents}
					tools={tools}
					mounts={openConversation?.mounts ?? []}
					sandbox={openConversation?.sandbox}
					archivedAt={openConversation?.archivedAt}
					onSend={send}
					onCancel={cancel}
					onOpenSandbox={openSandbox}
					onOpenPath={setViewing}
					onArchive={openConversation ? archive : undefined}
				/>
			) : (
				<main className="grid flex-1 place-items-center text-sm text-muted-foreground">
					No conversation selected
				</main>
			)}

			{viewing !== undefined && workspaceId !== undefined && conversationId !== undefined && (
				<Viewer
					workspaceId={workspaceId}
					conversationId={conversationId}
					path={viewing}
					version={entries.filter((entry) => entry.type === "toolCall" && touches(entry, viewing)).length}
					onClose={() => setViewing(undefined)}
				/>
			)}
			</div>
		</div>
	);
}

function SidebarItem({
	selected,
	onClick,
	children,
}: {
	selected: boolean;
	onClick?: () => void;
	children: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"truncate rounded-md px-2 py-1.5 text-left text-sm",
				selected
					? "bg-accent text-accent-foreground"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

