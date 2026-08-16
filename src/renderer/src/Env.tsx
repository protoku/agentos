import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Env({ workspaceId }: { workspaceId: string }) {
	const [env, setEnv] = useState<Record<string, string>>({});
	const [draft, setDraft] = useState<{ key: string; value: string }>();

	useEffect(() => {
		void window.agentOS.readEnv(workspaceId).then(setEnv);
		setDraft(undefined);
	}, [workspaceId]);

	async function add() {
		if (draft === undefined) return;

		const key = draft.key.trim();
		if (key.length === 0) return;

		setEnv(await window.agentOS.setEnv(workspaceId, key, draft.value));
		setDraft(undefined);
	}

	async function drop(key: string) {
		setEnv(await window.agentOS.setEnv(workspaceId, key));
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Env</span>
				<Button variant="ghost" size="sm" onClick={() => setDraft({ key: "", value: "" })}>
					<Plus />
					New key
				</Button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
				<p className="text-sm text-muted-foreground">
					What the workspace's tools can be given. A tool sees only the keys it declares.
				</p>

				{draft && (
					<div className="flex items-end gap-2 rounded-lg border border-border p-3">
						<Field label="Key">
							<Input
								autoFocus
								value={draft.key}
								placeholder="API_TOKEN"
								onChange={(event) => setDraft({ ...draft, key: event.target.value })}
							/>
						</Field>
						<Field label="Value">
							<Input
								value={draft.value}
								onChange={(event) => setDraft({ ...draft, value: event.target.value })}
								onKeyDown={(event) => {
									if (event.key === "Enter") void add();
								}}
							/>
						</Field>
						<Button onClick={() => void add()}>Set</Button>
						<Button variant="ghost" onClick={() => setDraft(undefined)}>
							Cancel
						</Button>
					</div>
				)}

				{Object.keys(env).length === 0 && !draft && <p className="text-sm text-muted-foreground">Nothing set</p>}

				{Object.entries(env).map(([key, value]) => (
					<div key={key} className="flex items-center gap-3 border-b border-border pb-3 text-sm">
						<span className="w-64 shrink-0 truncate font-medium">{key}</span>
						<span className="flex-1 truncate text-muted-foreground">{value}</span>
						<Button variant="ghost" size="icon-sm" aria-label={`Remove ${key}`} onClick={() => void drop(key)}>
							<X />
						</Button>
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
