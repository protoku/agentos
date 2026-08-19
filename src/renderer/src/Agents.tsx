import { useEffect, useState } from "react";
import { Bot, Code, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Nothing } from "./Nothing";
import { asTags, carriedMemories, memoryBlock } from "../../shared/memory";
import { defaultModel, models } from "../../shared/models";
import { estimateTokens } from "../../shared/transcript";
import { thousands } from "./format";
import type { Agent, Memory, Tool } from "../../shared/types";

type Draft = Pick<Agent, "name" | "model" | "systemPrompt" | "tools" | "carries">;
type Permission = "allow" | "ask" | "deny";

const emptyDraft: Draft = { name: "", model: defaultModel, systemPrompt: "", tools: {}, carries: [] };

/**
 * Agents worth offering ready-made, since both are mostly a matter of which permissions to hold
 * and how to say what the work is. Everything about them is editable the moment they exist.
 */
const templates: { label: string; icon: React.ReactNode; draft: Draft }[] = [
	{
		label: "Developer",
		icon: <Code />,
		draft: {
			name: "dev",
			model: defaultModel,
			systemPrompt: [
				"You implement changes in the repository mounted in this conversation's sandbox. You work through",
				"the tools you are given; there is no shell beyond them.",
				"",
				"Read before you write. Find the file, read what surrounds it, and match what is already there: its",
				"naming, its structure, how much it comments. A change that reads like the code around it is worth",
				"more than a clever one.",
				"",
				"Where the repository states its own conventions, in a contributing guide, a CLAUDE.md, or a docs",
				"directory describing what the software does, those rules win over your habits. Where such a",
				"document defines behaviour, it is the source of truth: change it in the same piece of work and",
				"before the code, and when it does not answer a question your change needs answered, stop and ask",
				"rather than deciding it silently in code.",
				"",
				"An isolated mount refuses every edit until it is on a branch. Create one named for the work before",
				"you touch a file, and commit as you go rather than in one heap at the end.",
				"",
				"Work in small steps. Say what you are about to do, do it, then say how it can be checked. Run the",
				"tests and whatever type or lint checks the project has, through the tools you have, before calling",
				"anything done. Report failures with their output rather than summarising them away, and say plainly",
				"when you have not verified something.",
				"",
				"Keep what you read small. Search for what you need and open only the files that matter, because",
				"everything a tool returns stays in this conversation for every later turn.",
			].join("\n"),
			tools: {
				read_file: "allow",
				list_files: "allow",
				search_files: "allow",
				write_file: "allow",
				edit_file: "allow",
				move_file: "allow",
				git_status: "allow",
				git_diff: "allow",
				git_log: "allow",
				git_create_branch: "allow",
				git_checkout: "allow",
				git_commit: "allow",
				delete_file: "ask",
				delete_directory: "ask",
				git_push: "ask",
				git_pull: "ask",
				mount: "ask",
				unmount: "ask",
			},
			carries: [],
		},
	},
	{
		label: "Tool builder",
		icon: <Wrench />,
		draft: {
			name: "builder",
			model: defaultModel,
			systemPrompt: [
				"You build the tools of this workspace, by talking to the user about what they want and then writing it.",
				"",
				"Find out before you write. Use run_command to see how a command behaves: its options, whether it needs",
				"authentication, and the exact shape of what it returns. Never guess an output format you could have looked at.",
				"",
				"A tool is one narrowly scoped capability, never a broad escape hatch. Its inputSchema is how a caller knows",
				"what to pass, and its outputSchema gives the result a known shape the thread can render, so describe every",
				"property rather than leaving an open object. Pass input values as command arguments, never interpolated into",
				"a line to be split.",
				"",
				"Say how a field reads, so a call is worth opening: a property may carry render, one of table for an array of",
				"objects, text, markdown, diff, path for a place in the sandbox, or link for an address. Declare a listing as",
				"a table and a file it touched as a path, and leave render off anything that is simply a value.",
				"",
				"A tool sees only the workspace env keys it declares. When one needs a credential, declare the key and tell",
				"the user to set it in Env; never ask them to paste a secret to you, and never put one in the code.",
				"",
				"Show the user what you are about to create and why, then create it. Afterwards, run it once on a real input",
				"and report what came back, so they see it working rather than taking your word for it.",
			].join("\n"),
			tools: {
				run_command: "ask",
				define_tool: "ask",
				update_tool: "ask",
				read_file: "allow",
				list_files: "allow",
			},
			carries: [],
		},
	},
];

export function Agents({ workspaceId, selected }: { workspaceId: string; selected?: string }) {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [tools, setTools] = useState<Tool[]>([]);
	const [memories, setMemories] = useState<Memory[]>([]);
	const [editing, setEditing] = useState<Agent>();
	const [draft, setDraft] = useState<Draft>();
	const [refused, setRefused] = useState<string>();

	useEffect(() => {
		void Promise.all([window.agentOS.listTools(), window.agentOS.listScriptTools(workspaceId)]).then(
			([builtin, scripts]) => setTools([...builtin, ...scripts]),
		);
	}, [workspaceId]);

	useEffect(() => {
		void window.agentOS.listMemories(workspaceId).then(setMemories);
		void window.agentOS.listAgents(workspaceId).then(setAgents);
		setEditing(undefined);
		setDraft(undefined);
	}, [workspaceId]);

	// Picked in the sidebar: the pane opens on it rather than on nothing.
	useEffect(() => {
		const picked = agents.find((agent) => agent.id === selected);
		if (picked !== undefined) edit(picked);
	}, [agents, selected]);

	function edit(agent: Agent) {
		setEditing(agent);
		setDraft({
			name: agent.name,
			model: agent.model,
			systemPrompt: agent.systemPrompt,
			tools: agent.tools,
			carries: agent.carries,
		});
	}

	async function save() {
		if (draft === undefined || draft.name.trim().length === 0) return;

		try {
			setRefused(undefined);
			const written = { ...draft, name: draft.name.trim(), carries: asTags(draft.carries) };
			const saved = editing
				? await window.agentOS.updateAgent(workspaceId, { ...editing, ...written })
				: await window.agentOS.createAgent(workspaceId, written);

			setAgents(await window.agentOS.listAgents(workspaceId));
			edit(saved);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Agents</span>
				<div className="flex gap-1">
					{templates.map((template) => (
						<Button
							key={template.label}
							variant="ghost"
							size="sm"
							onClick={() => {
								setEditing(undefined);
								setDraft(template.draft);
							}}
						>
							{template.icon}
							{template.label}
						</Button>
					))}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setEditing(undefined);
							setDraft(emptyDraft);
						}}
					>
						<Plus />
						New agent
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
					{agents.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No agents yet</p>}
					{agents.map((agent) => (
						<button
							key={agent.id}
							type="button"
							onClick={() => edit(agent)}
							className={cn(
								"truncate rounded-md px-2 py-1.5 text-left text-sm",
								agent.id === editing?.id
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{agent.name}
						</button>
					))}
				</nav>

				{draft === undefined ? (
					<Nothing icon={<Bot />} title="No agent selected">
						An agent is a name, a model, a system prompt, and the tools it may use. Pick one or make a new
						one.
					</Nothing>
				) : (
					<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
						<Field label="Name">
							<Input
								value={draft.name}
								placeholder="ops"
								onChange={(event) => setDraft({ ...draft, name: event.target.value })}
							/>
						</Field>

						<Field label="Model">
							<Select value={draft.model} onValueChange={(model) => setDraft({ ...draft, model })}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{models.map((model) => (
										<SelectItem key={model.id} value={model.id}>
											{model.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field label="Carries">
							<Input
								value={draft.carries.join(", ")}
								placeholder="deploy, ops"
								onChange={(event) => setDraft({ ...draft, carries: event.target.value.split(",") })}
							/>
							<span className="text-xs text-muted-foreground">{carrying(memories, draft.carries)}</span>
						</Field>

						<Field label="System prompt">
							<Textarea
								value={draft.systemPrompt}
								placeholder="What this agent is for, and how it should behave."
								className="min-h-48 resize-none"
								onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
							/>
						</Field>

						<section className="flex flex-col gap-1.5">
							<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tools</span>
							<div className="flex flex-col divide-y divide-border rounded-md border border-border">
								{tools.map((tool) => (
									<div key={tool.id} className="flex items-center justify-between gap-4 px-3 py-2">
										<div className="min-w-0">
											<p className="text-sm">{tool.name}</p>
											<p className="truncate text-xs text-muted-foreground">{tool.description}</p>
										</div>
										<PermissionPicker
											value={draft.tools[tool.id] ?? "deny"}
											onPick={(permission) =>
												setDraft({ ...draft, tools: withPermission(draft.tools, tool.id, permission) })
											}
										/>
									</div>
								))}
							</div>
						</section>

						<div className="flex items-center gap-3">
							<Button onClick={() => void save()}>{editing ? "Save" : "Create agent"}</Button>
							{refused && <p className="text-sm text-destructive">{refused}</p>}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}

const permissionColors: Record<Permission, string> = {
	allow: "border-success text-success",
	ask: "border-pending text-pending",
	deny: "border-destructive text-destructive",
};

function PermissionPicker({ value, onPick }: { value: Permission; onPick: (permission: Permission) => void }) {
	return (
		<div className="flex shrink-0 gap-1">
			{(["allow", "ask", "deny"] as const).map((permission) => (
				<button
					key={permission}
					type="button"
					onClick={() => onPick(permission)}
					className={cn(
						"rounded-md border px-2 py-0.5 text-xs capitalize",
						permission === value
							? permissionColors[permission]
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
				>
					{permission}
				</button>
			))}
		</div>
	);
}

/** Denied is the absence of a permission, so denying a tool leaves no entry behind. */
/** What naming these tags costs the agent, which it pays again on every turn it takes. */
function carrying(memories: Memory[], carries: string[]): string {
	const carried = carriedMemories(memories, tagsOrNone(carries));
	if (carried.length === 0) return "Nothing yet: memory tags this agent names arrive with every turn it takes.";

	const size = thousands(estimateTokens(memoryBlock(carried)));

	return `${carried.length} ${carried.length === 1 ? "memory" : "memories"}, about ${size} tokens every turn.`;
}

/** Typing a tag is not a refusal: what it does not understand yet simply carries nothing. */
function tagsOrNone(carries: string[]): string[] {
	try {
		return asTags(carries);
	} catch {
		return [];
	}
}

function withPermission(tools: Agent["tools"], toolId: string, permission: Permission): Agent["tools"] {
	const next = { ...tools };
	if (permission === "deny") delete next[toolId];
	else next[toolId] = permission;

	return next;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
			{children}
		</label>
	);
}
