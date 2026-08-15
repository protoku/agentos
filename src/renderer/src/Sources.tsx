import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MountSource } from "../../shared/types";

interface Draft {
	name: string;
	path: string;
}

const emptyDraft: Draft = { name: "", path: "" };

export function Sources({ workspaceId }: { workspaceId: string }) {
	const [sources, setSources] = useState<MountSource[]>([]);
	const [draft, setDraft] = useState<Draft>();

	useEffect(() => {
		void window.agentOS.listSources(workspaceId).then(setSources);
		setDraft(undefined);
	}, [workspaceId]);

	async function create() {
		if (draft === undefined) return;

		const name = draft.name.trim();
		const path = draft.path.trim();
		if (name.length === 0 || path.length === 0) return;

		await window.agentOS.createSource(workspaceId, { name, type: "directory", config: { path } });
		setSources(await window.agentOS.listSources(workspaceId));
		setDraft(undefined);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Sources</span>
				<Button variant="ghost" size="sm" onClick={() => setDraft(emptyDraft)}>
					<Plus />
					New directory
				</Button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
				{draft && (
					<div className="flex items-end gap-2 rounded-lg border border-border p-3">
						<Field label="Name">
							<Input
								autoFocus
								value={draft.name}
								placeholder="notes"
								onChange={(event) => setDraft({ ...draft, name: event.target.value })}
							/>
						</Field>
						<Field label="Directory">
							<Input
								value={draft.path}
								placeholder="/home/you/notes"
								onChange={(event) => setDraft({ ...draft, path: event.target.value })}
							/>
						</Field>
						<Button onClick={() => void create()}>Add source</Button>
						<Button variant="ghost" onClick={() => setDraft(undefined)}>
							Cancel
						</Button>
					</div>
				)}

				{sources.length === 0 && !draft && <p className="text-sm text-muted-foreground">No sources yet</p>}

				{sources.map((source) => (
					<div key={source.id} className="flex items-baseline gap-3 border-b border-border pb-3 text-sm">
						<span className="font-medium">{source.name}</span>
						<span className="text-xs text-muted-foreground">{source.type}</span>
						<span className="truncate text-xs text-muted-foreground">{String(source.config.path ?? "")}</span>
					</div>
				))}
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
