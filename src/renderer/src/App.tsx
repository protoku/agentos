import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Workspace } from "../../shared/types";

export function App() {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [name, setName] = useState("");
	const [naming, setNaming] = useState(false);

	useEffect(() => {
		void window.agentOS.listWorkspaces().then(setWorkspaces);
	}, []);

	function stopNaming() {
		setNaming(false);
		setName("");
	}

	async function create() {
		const trimmed = name.trim();
		if (trimmed.length === 0) return stopNaming();

		const workspace = await window.agentOS.createWorkspace(trimmed);
		setWorkspaces((current) => [...current, workspace]);
		setSelectedId(workspace.id);
		stopNaming();
	}

	const selected = workspaces.find((workspace) => workspace.id === selectedId);

	return (
		<div className="flex h-full">
			<aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
				<div className="flex items-center gap-1 border-b border-border p-2">
					<Select value={selectedId ?? ""} onValueChange={setSelectedId}>
						<SelectTrigger className="w-full border-transparent">
							<SelectValue placeholder="No workspace" />
						</SelectTrigger>
						<SelectContent>
							{workspaces.map((workspace) => (
								<SelectItem key={workspace.id} value={workspace.id}>
									{workspace.name}
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
							onBlur={() => void create()}
							onKeyDown={(event) => {
								if (event.key === "Enter") void create();
								if (event.key === "Escape") stopNaming();
							}}
						/>
					</div>
				)}
			</aside>

			<main className="flex-1">
				{selected === undefined && (
					<div className="grid h-full place-items-center text-sm text-muted-foreground">
						No workspace selected
					</div>
				)}
			</main>
		</div>
	);
}
