import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Workspace } from "../../shared/types";

const sections = ["agents", "tools", "sources", "env"] as const;

type Section = (typeof sections)[number];

const sectionTitles: Record<Section, string> = {
	agents: "Agents",
	tools: "Tools",
	sources: "Sources",
	env: "Env",
};

export function App() {
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [section, setSection] = useState<Section>();
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

				<div className="flex-1 overflow-y-auto p-2 text-sm text-muted-foreground">
					{selected ? "No conversations" : null}
				</div>

				<nav className="flex flex-col gap-0.5 border-t border-border p-2">
					{sections.map((current) => (
						<button
							key={current}
							type="button"
							disabled={selected === undefined}
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

			{selected === undefined ? (
				<main className="grid flex-1 place-items-center text-sm text-muted-foreground">
					No workspace selected
				</main>
			) : section ? (
				<main className="flex-1">
					<header className="border-b border-border px-6 py-3 text-sm font-medium">
						{sectionTitles[section]}
					</header>
				</main>
			) : (
				<>
					<main className="grid flex-1 place-items-center text-sm text-muted-foreground">
						No conversation selected
					</main>

					<aside className="flex w-72 shrink-0 flex-col gap-6 border-l border-border bg-surface p-4">
						<ContextSection title="Mounts">Nothing mounted</ContextSection>
						<ContextSection title="Sandbox">Not created yet</ContextSection>
						<ContextSection title="Agents">Nobody in the thread</ContextSection>
					</aside>
				</>
			)}
		</div>
	);
}

function ContextSection({ title, children }: { title: string; children: string }) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
			<p className="text-sm text-muted-foreground">{children}</p>
		</section>
	);
}
