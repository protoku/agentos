import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MountSource } from "../../shared/types";

type Draft =
	| { type: "directory"; name: string; path: string }
	| { type: "git"; name: string; remote: string; defaultBranch: string };

const emptyDrafts: Record<Draft["type"], Draft> = {
	directory: { type: "directory", name: "", path: "" },
	git: { type: "git", name: "", remote: "", defaultBranch: "main" },
};

export function Sources({ workspaceId }: { workspaceId: string }) {
	const [sources, setSources] = useState<MountSource[]>([]);
	const [draft, setDraft] = useState<Draft>();
	const [refused, setRefused] = useState<string>();

	useEffect(() => {
		void window.agentOS.listSources(workspaceId).then(setSources);
		setDraft(undefined);
	}, [workspaceId]);

	async function create() {
		if (draft === undefined) return;

		const { name, type, ...config } = draft;
		if (name.trim().length === 0 || Object.values(config).some((value) => value.trim().length === 0)) return;

		try {
			await window.agentOS.createSource(workspaceId, { name: name.trim(), type, config });
			setSources(await window.agentOS.listSources(workspaceId));
			setDraft(undefined);
			setRefused(undefined);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	function start(type: Draft["type"]) {
		setDraft(emptyDrafts[type]);
		setRefused(undefined);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Sources</span>
				<div className="flex gap-1">
					<Button variant="ghost" size="sm" onClick={() => start("directory")}>
						<Plus />
						New directory
					</Button>
					<Button variant="ghost" size="sm" onClick={() => start("git")}>
						<Plus />
						New repository
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
				{draft && (
					<div className="flex flex-col gap-2 rounded-lg border border-border p-3">
						<div className="flex items-end gap-2">
							<Field label="Name">
								<Input
									autoFocus
									value={draft.name}
									placeholder={draft.type === "git" ? "api" : "notes"}
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
								/>
							</Field>

							{draft.type === "directory" ? (
								<Field label="Directory">
									<Input
										value={draft.path}
										placeholder="/home/you/notes"
										onChange={(event) => setDraft({ ...draft, path: event.target.value })}
									/>
								</Field>
							) : (
								<>
									<Field label="Remote">
										<Input
											value={draft.remote}
											placeholder="git@github.com:you/api.git"
											onChange={(event) => setDraft({ ...draft, remote: event.target.value })}
										/>
									</Field>
									<Field label="Default branch">
										<Input
											value={draft.defaultBranch}
											onChange={(event) => setDraft({ ...draft, defaultBranch: event.target.value })}
										/>
									</Field>
								</>
							)}

							<Button onClick={() => void create()}>Add source</Button>
							<Button variant="ghost" onClick={() => setDraft(undefined)}>
								Cancel
							</Button>
						</div>

						{refused && <p className="text-sm text-destructive">{refused}</p>}
					</div>
				)}

				{sources.length === 0 && !draft && <p className="text-sm text-muted-foreground">No sources yet</p>}

				{sources.map((source) => (
					<div key={source.id} className="flex items-baseline gap-3 border-b border-border pb-3 text-sm">
						<span className="font-medium">{source.name}</span>
						<span className="text-xs text-muted-foreground">{source.type}</span>
						<span className="truncate text-xs text-muted-foreground">{describe(source)}</span>
					</div>
				))}
			</div>
		</main>
	);
}

function describe(source: MountSource): string {
	return source.type === "git"
		? `${String(source.config.remote ?? "")} on ${String(source.config.defaultBranch ?? "")}`
		: String(source.config.path ?? "");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-1 flex-col gap-1.5">
			<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
			{children}
		</label>
	);
}
