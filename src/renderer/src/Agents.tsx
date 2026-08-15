import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { defaultModel, models } from "../../shared/models";
import type { Agent } from "../../shared/types";

type Draft = Pick<Agent, "name" | "model" | "systemPrompt">;

const emptyDraft: Draft = { name: "", model: defaultModel, systemPrompt: "" };

export function Agents({ workspaceId }: { workspaceId: string }) {
	const [agents, setAgents] = useState<Agent[]>([]);
	const [editing, setEditing] = useState<Agent>();
	const [draft, setDraft] = useState<Draft>();

	useEffect(() => {
		void window.agentOS.listAgents(workspaceId).then(setAgents);
		setEditing(undefined);
		setDraft(undefined);
	}, [workspaceId]);

	function edit(agent: Agent) {
		setEditing(agent);
		setDraft({ name: agent.name, model: agent.model, systemPrompt: agent.systemPrompt });
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
					<div className="grid flex-1 place-items-center text-sm text-muted-foreground">No agent selected</div>
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

						<div>
							<Button onClick={() => void save()}>{editing ? "Save" : "Create agent"}</Button>
						</div>
					</div>
				)}
			</div>
		</main>
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
