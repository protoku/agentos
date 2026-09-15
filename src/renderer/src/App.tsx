import { useEffect, useState } from "react";
import {
	Bot,
	Boxes,
	Brain,
	ChartColumn,
	ChevronsUpDown,
	Database,
	KeyRound,
	MessageSquare,
	MessagesSquare,
	Plus,
	Route,
	Trash2,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Nothing } from "./Nothing";
import { Run } from "./Run";
import { Sending } from "./Sending";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Agents } from "./Agents";
import { Conversations } from "./Conversations";
import { Env } from "./Env";
import { Sources } from "./Sources";
import { Tools } from "./Tools";
import { Workflows } from "./Workflows";
import { Memories } from "./Memories";
import { Usage } from "./Usage";
import { Thread } from "./Thread";
import { pathOf } from "../../shared/render";
import { Diff } from "./Diff";
import { SidePane, Viewer } from "./Viewer";
import { parseSlashCommand } from "../../shared/slash";
import type { ConversationSummary, MountState } from "../../shared/api";
import type { Agent, Entry, MountSource, Tool, ToolCall, Workflow, Workspace } from "../../shared/types";

const sections = ["conversations", "agents", "tools", "workflows", "sources", "memories", "usage", "env"] as const;

type Section = (typeof sections)[number];

const sidebarConversations = 20;

/** A workspace pane: its button opens it, and opening it again closes it back to the thread. */
function Pane({
	section,
	label,
	icon,
	open,
	onOpen,
}: {
	section: Section;
	label: string;
	icon: React.ReactNode;
	open?: Section;
	onOpen: (section?: Section) => void;
}) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton isActive={open === section} onClick={() => onOpen(open === section ? undefined : section)}>
				{icon}
				{label}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

/** A call that acted on the open path is a new version of what the viewer is showing. */
function touches(call: ToolCall, path: string, tools: Tool[]): boolean {
	return pathOf(call, tools.find((tool) => tool.id === call.toolId)) === path;
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
	const [deleting, setDeleting] = useState(false);
	const [runtime, setRuntime] = useState<{ found: boolean; missing: string }>();
	const [viewing, setViewing] = useState<{ kind: "file" | "diff" | "run" | "sending"; path: string }>();
	const [sources, setSources] = useState<MountSource[]>([]);
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const [mounts, setMounts] = useState<MountState[]>([]);
	// What was typed and not sent, kept here so leaving a thread and coming back finds it.
	const [drafts, setDrafts] = useState<Record<string, string>>({});

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
		void window.agentOS.listSources(workspaceId).then(setSources);
		void window.agentOS.listWorkflows(workspaceId).then(setWorkflows);
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
			// A rename is in the list at once, rather than waiting for the turn that did it to end.
			const renamed =
				entry.type === "toolCall" && entry.toolId === "rename_conversation" && entry.status === "success";
			if (entry.type === "turnEnd" || entry.type === "workflowEnd" || renamed) {
				void window.agentOS.listConversations(forWorkspace).then(setConversations);
			}
		});
	}, [workspaceId, conversationId]);

	useEffect(() => {
		if (workspaceId === undefined || conversationId === undefined) return setMounts([]);

		void window.agentOS.mountStates(workspaceId, conversationId).then(setMounts);
	}, [workspaceId, conversationId, entries.filter((entry) => entry.type === "toolCall").length]);

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

	async function deleteWorkspace() {
		if (workspaceId === undefined) return;

		await window.agentOS.deleteWorkspace(workspaceId);
		const remaining = workspaces.filter((candidate) => candidate.id !== workspaceId);
		setDeleting(false);
		setWorkspaces(remaining);
		setSection(undefined);
		setViewing(undefined);
		setWorkspaceId(remaining[0]?.id);
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

	async function rename(title: string) {
		if (workspaceId === undefined || conversationId === undefined) return;

		await window.agentOS.renameConversation(workspaceId, conversationId, title);
		setConversations(await window.agentOS.listConversations(workspaceId));
	}

	async function archive() {
		if (workspaceId === undefined || conversationId === undefined) return;

		await window.agentOS.archiveConversation(workspaceId, conversationId);
		setConversations(await window.agentOS.listConversations(workspaceId));
	}

	async function send(content: string) {
		if (workspaceId === undefined) return;

		const command = parseSlashCommand(content);
		const workflow = workflows.find((candidate) => candidate.name === command?.toolId);

		// A run is started rather than called: nothing holds the thread but the run itself.
		if (command && workflow && conversationId !== undefined) {
			await window.agentOS.startWorkflow(workspaceId, conversationId, workflow.name, command.input);
			return setConversations(await window.agentOS.listConversations(workspaceId));
		}

		if (command && workflow) {
			const conversation = await window.agentOS.startConversationWithWorkflow(
				workspaceId,
				content,
				workflow.name,
				command.input,
			);
			setDrafting(false);
			setConversationId(conversation.id);
			setEntries([]);
			return setConversations(await window.agentOS.listConversations(workspaceId));
		}

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
	const settled = entries.filter((entry) => entry.type === "toolCall");
	// A new conversation composes under its own key, one per workspace, until it becomes real.
	const composing = `${workspaceId}/${conversationId ?? "new"}`;

	return (
		<div className="flex h-full flex-col">
			{runtime?.found === false && (
				<Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
					<TriangleAlert />
					<AlertTitle>Claude Code was not found</AlertTitle>
					<AlertDescription>{runtime.missing}</AlertDescription>
				</Alert>
			)}

			<SidebarProvider className="min-h-0 flex-1">
				<Sidebar collapsible="offcanvas">
					<SidebarHeader>
						<SidebarMenu>
							<SidebarMenuItem>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<SidebarMenuButton size="lg">
											<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted">
												<Boxes className="size-4" />
											</div>
											<div className="flex min-w-0 flex-1 flex-col text-left leading-tight">
												<span className="truncate text-sm font-medium">
													{workspace?.name ?? "No workspace"}
												</span>
												<span className="truncate text-xs text-muted-foreground">Workspace</span>
											</div>
											<ChevronsUpDown className="ml-auto size-4" />
										</SidebarMenuButton>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-56">
										<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
										{workspaces.map((candidate) => (
											<DropdownMenuItem key={candidate.id} onClick={() => setWorkspaceId(candidate.id)}>
												{candidate.name}
											</DropdownMenuItem>
										))}
										<DropdownMenuSeparator />
										<DropdownMenuItem onClick={() => setNaming(true)}>
											<Plus />
											New workspace
										</DropdownMenuItem>
										{workspace && (
											<DropdownMenuItem onClick={() => setDeleting(true)}>
												<Trash2 />
												Delete {workspace.name}
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							</SidebarMenuItem>
						</SidebarMenu>

						{naming && (
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
						)}

						{/* Outside the picker, since deciding here would close with the menu that opened it. */}
						<AlertDialog open={deleting} onOpenChange={setDeleting}>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Delete {workspace?.name}?</AlertDialogTitle>
									<AlertDialogDescription>
										Its conversations and their threads go, with its sandboxes, clones and worktrees, and
										its agents, tools, sources and env, and whatever is running right now is canceled.
										Work that was never pushed is gone. Nothing is left to say this workspace existed.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>Keep it</AlertDialogCancel>
									<AlertDialogAction onClick={() => void deleteWorkspace()}>Delete</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</SidebarHeader>

					<SidebarContent>
						{workspace && (
							<>
								<SidebarGroup>
									<SidebarGroupLabel>Conversations</SidebarGroupLabel>
									<SidebarGroupAction aria-label="New conversation" onClick={draft}>
										<Plus />
									</SidebarGroupAction>
									<SidebarGroupContent>
										<SidebarMenu>
											{drafting && (
												<SidebarMenuItem>
													<SidebarMenuButton isActive>
														<MessageSquare />
														New conversation
													</SidebarMenuButton>
												</SidebarMenuItem>
											)}
											{listed.map((conversation) => (
												<SidebarMenuItem key={conversation.id}>
													<SidebarMenuButton
														isActive={conversation.id === conversationId && section === undefined}
														onClick={() => void openThread(conversation.id)}
													>
														<MessageSquare />
														<span className="truncate">{conversation.title}</span>
													</SidebarMenuButton>
												</SidebarMenuItem>
											))}
											<SidebarMenuItem>
												<SidebarMenuButton
													className="mt-2"
													isActive={section === "conversations"}
													onClick={() => setSection(section === "conversations" ? undefined : "conversations")}
												>
													<MessagesSquare />
													All conversations
												</SidebarMenuButton>
											</SidebarMenuItem>
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>

								<SidebarGroup>
									<SidebarGroupLabel>Workspace</SidebarGroupLabel>
									<SidebarGroupContent>
										<SidebarMenu>
											<Pane section="agents" label="Agents" icon={<Bot />} open={section} onOpen={setSection} />
											<Pane section="tools" label="Tools" icon={<Wrench />} open={section} onOpen={setSection} />
											<Pane
												section="workflows"
												label="Workflows"
												icon={<Route />}
												open={section}
												onOpen={setSection}
											/>
											<Pane section="sources" label="Sources" icon={<Database />} open={section} onOpen={setSection} />
											<Pane section="memories" label="Memories" icon={<Brain />} open={section} onOpen={setSection} />
											<Pane
												section="usage"
												label="Usage"
												icon={<ChartColumn />}
												open={section}
												onOpen={setSection}
											/>
											<Pane section="env" label="Env" icon={<KeyRound />} open={section} onOpen={setSection} />
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							</>
						)}
					</SidebarContent>

					<SidebarRail />
				</Sidebar>

				<SidebarInset className="flex min-w-0 flex-row">
			{workspace === undefined ? (
				<main className="flex flex-1">
					<Nothing icon={<Boxes />} title="No workspace">
						A workspace holds its own agents, tools, sources and conversations, and shares none of them.
						Make one to begin.
					</Nothing>
				</main>
			) : section === "conversations" ? (
				<Conversations conversations={conversations} onOpen={(id) => void openThread(id)} />
			) : section === "agents" ? (
				<Agents workspaceId={workspace.id} />
			) : section === "sources" ? (
				<Sources workspaceId={workspace.id} />
			) : section === "env" ? (
				<Env workspaceId={workspace.id} />
			) : section === "usage" ? (
				<Usage workspaceId={workspace.id} agents={agents} onOpen={(id) => void openThread(id)} />
			) : section === "memories" ? (
				<Memories workspaceId={workspace.id} />
			) : section === "tools" ? (
				<Tools workspaceId={workspace.id} />
			) : section === "workflows" ? (
				<Workflows workspaceId={workspace.id} />
			) : drafting || openConversation ? (
				<Thread
					// Each conversation composes on its own: what is typed here never follows you to another.
					key={conversationId ?? "draft"}
					title={openConversation?.title ?? "New conversation"}
					entries={entries}
					agents={agents}
					tools={tools}
					sources={sources}
					workflows={workflows}
					mounts={mounts}
					sandbox={openConversation?.sandbox}
					archivedAt={openConversation?.archivedAt}
					draft={drafts[composing] ?? ""}
					onDraft={(draft) => setDrafts((current) => ({ ...current, [composing]: draft }))}
					onSend={send}
					onCancel={cancel}
					onOpenSandbox={openSandbox}
					// Already reading the sandbox, and the button that opened it closes it again.
					onOpenFiles={() =>
						setViewing((current) => (current?.kind === "file" ? undefined : { kind: "file", path: "" }))
					}
					onOpenPath={(path) => setViewing({ kind: "file", path })}
					onOpenRun={(runId) => setViewing({ kind: "run", path: runId })}
					onOpenDiff={(path) => setViewing({ kind: "diff", path })}
					// The cost in the header opens what a turn carries, and closes it again.
					onOpenSending={() =>
						setViewing((current) => (current?.kind === "sending" ? undefined : { kind: "sending", path: "" }))
					}
					onRename={openConversation ? rename : undefined}
					onArchive={openConversation ? archive : undefined}
				/>
			) : (
				<main className="flex flex-1">
					<Nothing icon={<MessagesSquare />} title="No conversation open">
						Pick one from the sidebar, or start a new one and mention an agent by name.
					</Nothing>
				</main>
			)}

			{viewing !== undefined && workspaceId !== undefined && conversationId !== undefined && (
				<SidePane>
					{viewing.kind === "run" ? (
						<Run entries={entries} runId={viewing.path} onClose={() => setViewing(undefined)} />
					) : viewing.kind === "sending" ? (
						<Sending
							workspaceId={workspaceId}
							entries={entries}
							agents={agents}
							tools={tools}
							onClose={() => setViewing(undefined)}
						/>
					) : viewing.kind === "file" ? (
						<Viewer
							workspaceId={workspaceId}
							conversationId={conversationId}
							path={viewing.path}
							version={settled.filter((call) => touches(call, viewing.path, tools)).length}
							settled={settled.length}
							onPick={(path) => setViewing({ kind: "file", path })}
							onClose={() => setViewing(undefined)}
						/>
					) : (
						// Any settled call may have changed the tree, so the diff follows all of them.
						<Diff
							workspaceId={workspaceId}
							conversationId={conversationId}
							path={viewing.path}
							version={settled.length}
							onClose={() => setViewing(undefined)}
						/>
					)}
				</SidePane>
			)}
				</SidebarInset>
			</SidebarProvider>
		</div>
	);
}


