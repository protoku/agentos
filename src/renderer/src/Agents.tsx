import { useEffect, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Nothing } from "./Nothing";
import { defaultModel, models } from "../../shared/models";
import type { Agent, Tool } from "../../shared/types";

type Draft = Pick<Agent, "name" | "model" | "systemPrompt" | "tools">;
type Permission = "allow" | "ask" | "deny";

const emptyDraft: Draft = { name: "", model: defaultModel, systemPrompt: "", tools: {} };

export function Agents({ workspaceId, selected }: { workspaceId: string; selected?: string }) {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [tools, setTools] = useState<Tool[]>([]);
	const [editing, setEditing] = useState<Agent>();
	const [draft, setDraft] = useState<Draft>();

	useEffect(() => {
		void Promise.all([window.agentOS.listTools(), window.agentOS.listScriptTools(workspaceId)]).then(
			([builtin, scripts]) => setTools([...builtin, ...scripts]),
		);
	}, [workspaceId]);

	useEffect(() => {
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
		});
	}

	async function save() {
		if (draft === undefined || draft.name.trim().length === 0) return;

		const saved = editing
			? await window.agentOS.updateAgent(workspaceId, { ...editing, ...draft, name: draft.name.trim() })
			: await window.agentOS.createAgent(workspaceId, { ...draft, name: draft.name.trim() });

		setAgents(await window.agentOS.listAgents(workspaceId));
		edit(saved);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Agents</span>
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

						<div>
							<Button onClick={() => void save()}>{editing ? "Save" : "Create agent"}</Button>
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
