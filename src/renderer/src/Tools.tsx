import { useEffect, useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Nothing } from "./Nothing";
import type { ScriptToolDraft } from "../../shared/api";
import type { ScriptTool } from "../../shared/types";

interface Draft extends Omit<ScriptToolDraft, "env" | "inputSchema" | "outputSchema"> {
	env: string;
	inputSchema: string;
	outputSchema: string;
}

const emptyDraft: Draft = {
	name: "",
	description: "",
	code: "// input, env and the sandbox as the working directory\nreturn { ok: true };",
	env: "",
	inputSchema: JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2),
	outputSchema: JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } } }, null, 2),
};

export function Tools({ workspaceId, selected }: { workspaceId: string; selected?: string }) {
	const [tools, setTools] = useState<ScriptTool[]>([]);
	const [editing, setEditing] = useState<ScriptTool>();
	const [draft, setDraft] = useState<Draft>();
	const [refused, setRefused] = useState<string>();

	useEffect(() => {
		void window.agentOS.listScriptTools(workspaceId).then(setTools);
		setEditing(undefined);
		setDraft(undefined);
	}, [workspaceId]);

	// Picked in the sidebar: the pane opens on it rather than on nothing.
	useEffect(() => {
		const picked = tools.find((tool) => tool.id === selected);
		if (picked !== undefined) edit(picked);
	}, [tools, selected]);

	function edit(tool: ScriptTool) {
		setEditing(tool);
		setRefused(undefined);
		setDraft({
			name: tool.name,
			description: tool.description,
			code: tool.code,
			env: tool.env.join(", "),
			inputSchema: JSON.stringify(tool.inputSchema, null, 2),
			outputSchema: JSON.stringify(tool.outputSchema, null, 2),
		});
	}

	async function save() {
		if (draft === undefined) return;

		try {
			const written: ScriptToolDraft = {
				name: draft.name.trim(),
				description: draft.description.trim(),
				code: draft.code,
				env: draft.env
					.split(",")
					.map((key) => key.trim())
					.filter((key) => key.length > 0),
				inputSchema: JSON.parse(draft.inputSchema),
				outputSchema: JSON.parse(draft.outputSchema),
			};

			const saved = editing
				? await window.agentOS.updateScriptTool(workspaceId, { ...editing, ...written })
				: await window.agentOS.createScriptTool(workspaceId, written);

			setTools(await window.agentOS.listScriptTools(workspaceId));
			edit(saved);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Tools</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setEditing(undefined);
						setRefused(undefined);
						setDraft(emptyDraft);
					}}
				>
					<Plus />
					New tool
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
					{tools.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No tools yet</p>}
					{tools.map((tool) => (
						<button
							key={tool.id}
							type="button"
							onClick={() => edit(tool)}
							className={cn(
								"truncate rounded-md px-2 py-1.5 text-left text-sm",
								tool.id === editing?.id
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{tool.name}
						</button>
					))}
				</nav>

				{draft === undefined ? (
					<Nothing icon={<Wrench />} title="No tool selected">
						A script tool is a function this workspace can run, called by name from the composer or by an
						agent you grant it to.
					</Nothing>
				) : (
					<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
						<div className="flex gap-4">
							<Field label="Name">
								<Input
									value={draft.name}
									placeholder="count_lines"
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
								/>
							</Field>
							<Field label="Env keys it may see">
								<Input
									value={draft.env}
									placeholder="API_TOKEN, REGION"
									onChange={(event) => setDraft({ ...draft, env: event.target.value })}
								/>
							</Field>
						</div>

						<Field label="Description">
							<Input
								value={draft.description}
								placeholder="What this tool does, for whoever calls it."
								onChange={(event) => setDraft({ ...draft, description: event.target.value })}
							/>
						</Field>

						<Tabs defaultValue="code" className="min-h-0 flex-1">
							<TabsList>
								<TabsTrigger value="code">Code</TabsTrigger>
								<TabsTrigger value="input">Input schema</TabsTrigger>
								<TabsTrigger value="output">Output schema</TabsTrigger>
							</TabsList>

							<TabsContent value="code">
								<Textarea
									value={draft.code}
									className="min-h-80 resize-none font-mono text-xs"
									onChange={(event) => setDraft({ ...draft, code: event.target.value })}
								/>
							</TabsContent>

							<TabsContent value="input" className="flex flex-col gap-2">
								<Textarea
									value={draft.inputSchema}
									className="min-h-80 resize-none font-mono text-xs"
									onChange={(event) => setDraft({ ...draft, inputSchema: event.target.value })}
								/>
								<Declaring />
							</TabsContent>

							<TabsContent value="output" className="flex flex-col gap-2">
								<Textarea
									value={draft.outputSchema}
									className="min-h-80 resize-none font-mono text-xs"
									onChange={(event) => setDraft({ ...draft, outputSchema: event.target.value })}
								/>
								<Declaring />
							</TabsContent>
						</Tabs>

						<div className="flex items-center gap-3">
							<Button onClick={() => void save()}>{editing ? "Save" : "Create tool"}</Button>
							{refused && <p className="text-sm text-destructive">{refused}</p>}
						</div>
					</div>
				)}
			</div>
		</main>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-1 flex-col gap-1.5">
			<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
			{children}
		</label>
	);
}

/** What a schema may say beyond shape, since nothing in the editor would otherwise mention it. */
function Declaring() {
	return (
		<p className="text-xs text-muted-foreground">
			A property may carry render, one of table, text, markdown, diff, path or link, saying how the thread shows it.
			A property that declares nothing, or declares what its value does not fit, reads as what it holds.
		</p>
	);
}
