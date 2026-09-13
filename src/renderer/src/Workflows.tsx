import { useEffect, useState } from "react";
import { Plus, Route, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Code } from "./Code";
import { Nothing } from "./Nothing";
import type { WorkflowDraft } from "../../shared/api";
import type { Workflow } from "../../shared/types";

const emptyDraft: WorkflowDraft = {
	name: "",
	description: "",
	definition: `input:
  request:
    type: string
    description: What came in

steps:
  - id: read
    agent: analyst
    ask: |
      Read what the request needs, and ask me whatever is missing.
`,
};

export function Workflows({ workspaceId }: { workspaceId: string }) {
	const [workflows, setWorkflows] = useState<Workflow[]>([]);
	const [editing, setEditing] = useState<Workflow>();
	const [draft, setDraft] = useState<WorkflowDraft>();
	const [deleting, setDeleting] = useState(false);
	const [refused, setRefused] = useState<string>();

	useEffect(() => {
		void window.agentOS.listWorkflows(workspaceId).then(setWorkflows);
		setEditing(undefined);
		setDraft(undefined);
	}, [workspaceId]);

	function edit(workflow: Workflow) {
		setEditing(workflow);
		setRefused(undefined);
		setDraft({ name: workflow.name, description: workflow.description, definition: workflow.definition });
	}

	async function save() {
		if (draft === undefined) return;

		try {
			const written = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
			const saved = editing
				? await window.agentOS.updateWorkflow(workspaceId, { ...editing, ...written })
				: await window.agentOS.createWorkflow(workspaceId, written);

			setWorkflows(await window.agentOS.listWorkflows(workspaceId));
			edit(saved);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	async function forget() {
		if (editing === undefined) return;

		await window.agentOS.deleteWorkflow(workspaceId, editing.id);
		setWorkflows(await window.agentOS.listWorkflows(workspaceId));
		setDeleting(false);
		setEditing(undefined);
		setDraft(undefined);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Workflows</span>
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
					New workflow
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<nav className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
					{workflows.length === 0 && (
						<p className="px-2 py-1.5 text-sm text-muted-foreground">No workflows yet</p>
					)}
					{workflows.map((workflow) => (
						<button
							key={workflow.id}
							type="button"
							onClick={() => edit(workflow)}
							className={cn(
								"truncate rounded-md px-2 py-1.5 text-left text-sm",
								workflow.id === editing?.id
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
						>
							{workflow.name}
						</button>
					))}
				</nav>

				{draft === undefined ? (
					<Nothing icon={<Route />} title="No workflow selected">
						A workflow is a run written down: the steps it takes, in order, each one a tool or an agent.
						You start it from the composer by its name.
					</Nothing>
				) : (
					<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
						<Field label="Name">
							<Input
								value={draft.name}
								placeholder="intake"
								onChange={(event) => setDraft({ ...draft, name: event.target.value })}
							/>
						</Field>

						<Field label="Description">
							<Textarea
								value={draft.description}
								placeholder="What this workflow is for, and when to run it."
								className="min-h-20 resize-none"
								onChange={(event) => setDraft({ ...draft, description: event.target.value })}
							/>
						</Field>

						<Field label="Steps">
							<Code
								value={draft.definition}
								language="yaml"
								onChange={(definition) => setDraft({ ...draft, definition })}
							/>
						</Field>

						<div className="flex items-center gap-3">
							<Button onClick={() => void save()}>{editing ? "Save" : "Create workflow"}</Button>
							{editing && (
								<Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
									<Trash2 />
									Delete it
								</Button>
							)}
							{refused && <p className="text-sm text-destructive">{refused}</p>}
						</div>
					</div>
				)}
			</div>

			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {editing?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							The workflow goes and nothing else does: every run it has already taken stays in the thread
							it ran in. There is no undo.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it</AlertDialogCancel>
						<AlertDialogAction onClick={() => void forget()}>Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
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
