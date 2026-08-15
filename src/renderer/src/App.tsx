import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Agents } from "./Agents";
import { Conversations } from "./Conversations";
import { Thread } from "./Thread";
import { parseSlashCommand } from "../../shared/slash";
import type { ConversationSummary } from "../../shared/api";
import type { Agent, Entry, Workspace } from "../../shared/types";

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

export function App() {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [workspaceId, setWorkspaceId] = useState<string>();
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationId, setConversationId] = useState<string>();
	const [entries, setEntries] = useState<Entry[]>([]);
	const [agents, setAgents] = useState<Agent[]>([]);
	const [drafting, setDrafting] = useState(false);
	const [section, setSection] = useState<Section>();
	const [name, setName] = useState("");
	const [naming, setNaming] = useState(false);

	useEffect(() => {
		void window.agentOS.listWorkspaces().then(setWorkspaces);
	}, []);

	useEffect(() => {
		setConversationId(undefined);
		setDrafting(false);
		setEntries([]);
		if (workspaceId === undefined) {
			setAgents([]);
			return setConversations([]);
		}

		void window.agentOS.listConversations(workspaceId).then(setConversations);
		void window.agentOS.listAgents(workspaceId).then(setAgents);
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

		setDrafting(false);
		setSection(undefined);
		setConversationId(id);
		setEntries(await window.agentOS.readConversation(workspaceId, id));
	}

	function draft() {
		setDrafting(true);
		setSection(undefined);
		setConversationId(undefined);
		setEntries([]);
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
			const call = await window.agentOS.invokeTool(workspaceId, conversationId, command.toolId, command.input);
			setEntries((current) => [...current, call]);
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
		<div className="flex h-full">
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
			) : section ? (
				<main className="flex-1">
					<header className="border-b border-border px-6 py-3 text-sm font-medium">
						{sectionTitles[section]}
					</header>
				</main>
			) : drafting || openConversation ? (
				<>
					<Thread
						title={openConversation?.title ?? "New conversation"}
						entries={entries}
						agents={agents}
						toolsEnabled={openConversation !== undefined}
						archivedAt={openConversation?.archivedAt}
						onSend={send}
						onArchive={openConversation ? archive : undefined}
					/>
					<ContextPanel sandbox={openConversation?.sandbox} />
				</>
			) : (
				<>
					<main className="grid flex-1 place-items-center text-sm text-muted-foreground">
						No conversation selected
					</main>
					<ContextPanel />
				</>
			)}
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

function ContextPanel({ sandbox }: { sandbox?: string }) {
	return (
		<aside className="flex w-72 shrink-0 flex-col gap-6 border-l border-border bg-surface p-4">
			<ContextSection title="Mounts">Nothing mounted</ContextSection>
			<ContextSection title="Sandbox">{sandbox ?? "Not created yet"}</ContextSection>
			<ContextSection title="Agents">Nobody in the thread</ContextSection>
		</aside>
	);
}

function ContextSection({ title, children }: { title: string; children: string }) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
			<p className="text-sm break-all text-muted-foreground">{children}</p>
		</section>
	);
}
