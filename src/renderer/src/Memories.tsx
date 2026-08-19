import { useEffect, useState } from "react";
import { Brain, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Nothing } from "./Nothing";
import { moment } from "./Conversations";
import { asTags } from "../../shared/memory";
import type { Agent, Memory } from "../../shared/types";

type Draft = { title: string; tags: string; body: string };

const emptyDraft: Draft = { title: "", tags: "", body: "" };

/** What the workspace knows, where the user can read every word of it and correct any of it. */
export function Memories({ workspaceId, selected }: { workspaceId: string; selected?: string }) {
	const [memories, setMemories] = useState<Memory[]>([]);
	const [agents, setAgents] = useState<Agent[]>([]);
	const [editing, setEditing] = useState<Memory>();
	const [draft, setDraft] = useState<Draft>();
	const [refused, setRefused] = useState<string>();
	const [forgetting, setForgetting] = useState(false);

	useEffect(() => {
		void window.agentOS.listMemories(workspaceId).then(setMemories);
		void window.agentOS.listAgents(workspaceId).then(setAgents);
		setEditing(undefined);
		setDraft(undefined);
	}, [workspaceId]);

	// Picked in the sidebar: the pane opens on it rather than on nothing.
	useEffect(() => {
		const picked = memories.find((memory) => memory.id === selected);
		if (picked !== undefined) edit(picked);
	}, [memories, selected]);

	function edit(memory: Memory) {
		setEditing(memory);
		setRefused(undefined);
		setDraft({ title: memory.title, tags: memory.tags.join(", "), body: memory.body });
	}

	function start() {
		setEditing(undefined);
		setRefused(undefined);
		setDraft(emptyDraft);
	}

	async function save() {
		if (draft === undefined) return;

		try {
			setRefused(undefined);
			const written = { title: draft.title, body: draft.body, tags: asTags(draft.tags.split(",")) };
			const saved = editing
				? await window.agentOS.updateMemory(workspaceId, { ...editing, ...written })
				: await window.agentOS.createMemory(workspaceId, written);

			setMemories(await window.agentOS.listMemories(workspaceId));
			edit(saved);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	async function forget() {
		if (editing === undefined) return;

		await window.agentOS.deleteMemory(workspaceId, editing.id);
		setMemories(await window.agentOS.listMemories(workspaceId));
		setForgetting(false);
		setEditing(undefined);
		setDraft(undefined);
	}

	// Newest change first, so what nobody has touched in months sinks to where it is noticed.
	const listed = [...memories].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Memories</span>
				<Button variant="ghost" size="sm" onClick={start}>
					<Plus />
					New memory
				</Button>
			</header>

			{memories.length === 0 && draft === undefined ? (
				<div className="flex min-h-0 flex-1 flex-col p-6">
					<Nothing icon={<Brain />} title="Nothing remembered yet">
						What agents work out, and what you tell them, is kept here and carried into the turns of the agents
						that name its tags.
					</Nothing>
				</div>
			) : (
				<div className="flex min-h-0 flex-1">
					<nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
						{listed.map((memory) => (
							<button
								key={memory.id}
								type="button"
								onClick={() => edit(memory)}
								className={cn(
									"truncate rounded-md px-2 py-1.5 text-left text-sm",
									memory.id === editing?.id
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{memory.title}
							</button>
						))}
					</nav>

					{draft === undefined ? (
						<div className="flex flex-1 items-center justify-center p-6">
							<Nothing icon={<Brain />} title="Nothing open">
								Pick a memory to read it, or write a new one.
							</Nothing>
						</div>
					) : (
						<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
							{editing && <Written memory={editing} agents={agents} />}

							<Field label="Title">
								<Input
									value={draft.title}
									placeholder="What this memory is about"
									onChange={(event) => setDraft({ ...draft, title: event.target.value })}
								/>
							</Field>

							<Field label="Tags">
								<Input
									value={draft.tags}
									placeholder="deploy, ops"
									onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
								/>
							</Field>

							<Field label="What is worth knowing">
								<Textarea
									value={draft.body}
									placeholder="In full, but no longer than a paragraph or two."
									className="min-h-64 resize-none"
									onChange={(event) => setDraft({ ...draft, body: event.target.value })}
								/>
							</Field>

							<div className="flex items-center gap-3">
								<Button onClick={() => void save()}>{editing ? "Save" : "Remember it"}</Button>
								{editing && (
									<Button variant="ghost" size="sm" onClick={() => setForgetting(true)}>
										<Trash2 />
										Forget it
									</Button>
								)}
								{refused && <p className="text-sm text-destructive">{refused}</p>}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Nothing is left afterwards to say the workspace ever knew it, so it asks first. */}
			<AlertDialog open={forgetting} onOpenChange={setForgetting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Forget {editing?.title}?</AlertDialogTitle>
						<AlertDialogDescription>
							It goes for good, and every agent carrying its tags stops being told it. The calls that wrote it
							stay in their threads, but nothing else is left to say the workspace knew this.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it</AlertDialogCancel>
						<AlertDialogAction onClick={() => void forget()}>Forget</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
}

/**
 * Where a memory came from and whose turns it joins. A memory an agent wrote that nobody can see
 * would be standing instructions nobody agreed to, so both lines are part of reading one.
 */
function Written({ memory, agents }: { memory: Memory; agents: Agent[] }) {
	const wrote = agents.find((agent) => agent.id === memory.agentId);
	const carrying = agents.filter((agent) => agent.carries.some((tag) => memory.tags.includes(tag)));

	return (
		<div className="flex flex-col gap-1 text-xs text-muted-foreground">
			<span>
				{memory.agentId === undefined ? "Written here" : `Written by @${wrote?.name ?? "an agent since gone"}`} on{" "}
				<time dateTime={memory.createdAt}>{moment(memory.createdAt)}</time>
				{memory.updatedAt !== memory.createdAt && (
					<>
						, last changed <time dateTime={memory.updatedAt}>{moment(memory.updatedAt)}</time>
					</>
				)}
			</span>

			{carrying.length === 0 ? (
				<span>Carried by nobody, so it is found only by searching.</span>
			) : (
				<span className="flex flex-wrap items-center gap-1">
					Carried by
					{carrying.map((agent) => (
						<Badge key={agent.id} variant="outline">
							@{agent.name}
						</Badge>
					))}
				</span>
			)}
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
			{children}
		</label>
	);
}
