import { useEffect, useState } from "react";
import { Database, FolderOpen, GitBranch, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Nothing } from "./Nothing";
import type { MountSource } from "../../shared/types";

type Draft = { description: string } & (
	| { type: "directory"; name: string; path: string }
	| { type: "git"; name: string; remote: string; defaultBranch: string }
	| { type: "conversations"; name: string }
);

const emptyDrafts: Record<Draft["type"], Draft> = {
	directory: { type: "directory", name: "", path: "", description: "" },
	git: { type: "git", name: "", remote: "", defaultBranch: "main", description: "" },
	conversations: { type: "conversations", name: "", description: "" },
};

export function Sources({ workspaceId }: { workspaceId: string }) {
	const [sources, setSources] = useState<MountSource[]>([]);
	const [draft, setDraft] = useState<Draft>();
	const [describing, setDescribing] = useState<{ id: string; text: string }>();
	const [refused, setRefused] = useState<string>();
	const [deleting, setDeleting] = useState<MountSource>();

	useEffect(() => {
		void window.agentOS.listSources(workspaceId).then(setSources);
		setDraft(undefined);
		setDescribing(undefined);
	}, [workspaceId]);

	async function create() {
		if (draft === undefined) return;

		const { name, type, description, ...config } = draft;
		if (name.trim().length === 0 || Object.values(config).some((value) => value.trim().length === 0)) return;

		try {
			await window.agentOS.createSource(workspaceId, { name: name.trim(), type, config, description });
			setSources(await window.agentOS.listSources(workspaceId));
			setDraft(undefined);
			setRefused(undefined);
		} catch (failure) {
			setRefused(failure instanceof Error ? failure.message : String(failure));
		}
	}

	async function rewrite() {
		if (describing === undefined) return;

		await window.agentOS.updateSource(workspaceId, describing.id, describing.text);
		setSources(await window.agentOS.listSources(workspaceId));
		setDescribing(undefined);
	}

	async function forget() {
		if (deleting === undefined) return;

		try {
			await window.agentOS.deleteSource(workspaceId, deleting.id);
			setSources(await window.agentOS.listSources(workspaceId));
			setDeleting(undefined);
		} catch (failure) {
			// A source a conversation is standing on stays, and the dialog says which conversations.
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
					<Button variant="ghost" size="sm" onClick={() => start("conversations")}>
						<Plus />
						New conversations
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
									placeholder={draft.type === "git" ? "api" : draft.type === "conversations" ? "threads" : "notes"}
									onChange={(event) => setDraft({ ...draft, name: event.target.value })}
								/>
							</Field>

							{draft.type === "conversations" ? null : draft.type === "directory" ? (
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

						<Field label="Description">
							<Textarea
								value={draft.description}
								placeholder="What this is, and where in it to look."
								className="min-h-16 resize-none"
								onChange={(event) => setDraft({ ...draft, description: event.target.value })}
							/>
						</Field>

						{refused && <p className="text-sm text-destructive">{refused}</p>}
					</div>
				)}

				{sources.length === 0 && !draft && (
					<Nothing icon={<Database />} title="No sources yet">
						A source is something a conversation can mount: a directory, a repository, or this workspace's
						own threads.
					</Nothing>
				)}

				<ItemGroup>
					{sources.map((source) => (
						<Item key={source.id} variant="outline">
							<ItemMedia variant="icon">{icons[source.type]}</ItemMedia>
							<ItemContent>
								<ItemTitle>{source.name}</ItemTitle>
								<ItemDescription>{describe(source)}</ItemDescription>

								{describing?.id === source.id ? (
									<div className="flex w-full flex-col gap-2 pt-2">
										<Textarea
											autoFocus
											value={describing.text}
											placeholder="What this is, and where in it to look."
											className="min-h-16 resize-none"
											onChange={(event) =>
												setDescribing({ id: source.id, text: event.target.value })
											}
										/>
										<div className="flex gap-2">
											<Button size="sm" onClick={() => void rewrite()}>
												Save
											</Button>
											<Button size="sm" variant="ghost" onClick={() => setDescribing(undefined)}>
												Cancel
											</Button>
										</div>
									</div>
								) : (
									source.description && <p className="pt-1 text-sm">{source.description}</p>
								)}
							</ItemContent>
							<ItemActions>
								<Badge variant="outline">{source.type}</Badge>
								<Button
									variant="ghost"
									size="icon-sm"
									title="Describe this source"
									onClick={() => setDescribing({ id: source.id, text: source.description ?? "" })}
								>
									<Pencil />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									title="Delete this source"
									onClick={() => {
										setRefused(undefined);
										setDeleting(source);
									}}
								>
									<Trash2 />
								</Button>
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			</div>

			<AlertDialog open={deleting !== undefined} onOpenChange={(open) => !open && setDeleting(undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{deleting?.type === "git"
								? "This workspace's clone of the repository goes with it, and every commit in it that was never pushed. The remote is untouched."
								: "Only the source goes: what it points at is not this workspace's to remove."}{" "}
							Past mount calls stay in the threads that made them. There is no undo.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{refused && <p className="text-sm text-destructive">{refused}</p>}
					<AlertDialogFooter>
						<AlertDialogCancel>Keep it</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void forget();
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
}

const icons: Record<MountSource["type"], React.ReactNode> = {
	directory: <FolderOpen />,
	git: <GitBranch />,
	conversations: <MessagesSquare />,
};

function describe(source: MountSource): string {
	if (source.type === "git") return `${String(source.config.remote ?? "")} on ${String(source.config.defaultBranch ?? "")}`;
	if (source.type === "conversations") return "this workspace's threads, read-only";

	return String(source.config.path ?? "");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label className="flex flex-1 flex-col gap-1.5">
			<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
			{children}
		</label>
	);
}
