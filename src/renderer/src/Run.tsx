import { Check, CircleSlash, Clock, Route, SkipForward, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Entry, WorkflowEnd, WorkflowStart, WorkflowStep } from "../../shared/types";

type Standing = "done" | "running" | "skipped" | "failed" | "canceled";

const marks: Record<Standing, { icon: React.ReactNode; color: string }> = {
	done: { icon: <Check />, color: "text-success" },
	running: { icon: <Clock />, color: "text-pending" },
	skipped: { icon: <SkipForward />, color: "text-muted-foreground" },
	failed: { icon: <X />, color: "text-destructive" },
	canceled: { icon: <CircleSlash />, color: "text-muted-foreground" },
};

/** A run as its steps, beside the thread that holds them: what is done, what is going, what is left. */
export function Run({ entries, runId, onClose }: { entries: Entry[]; runId: string; onClose: () => void }) {
	const start = entries.find((entry): entry is WorkflowStart => entry.type === "workflowStart" && entry.id === runId);
	const steps = entries.filter(
		(entry): entry is WorkflowStep => entry.type === "workflowStep" && entry.runId === runId,
	);
	const end = entries.find((entry): entry is WorkflowEnd => entry.type === "workflowEnd" && entry.runId === runId);

	return (
		<>
			<header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
				<Route className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{start?.name ?? "Workflow"}</span>
				<Button variant="ghost" size="icon-sm" aria-label="Close the run" onClick={onClose}>
					<X />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{start === undefined ? (
					<p className="text-sm text-muted-foreground">That run is not in this conversation.</p>
				) : (
					<ol className="flex flex-col gap-2">
						{steps.map((step, index) => {
							const standing = standingOf(step, index === steps.length - 1, end);

							return (
								<li key={step.id} className="flex items-baseline gap-2 text-sm">
									<span className={cn("shrink-0 [&_svg]:size-3.5", marks[standing].color)}>
										{marks[standing].icon}
									</span>
									<span className="min-w-0 flex-1 truncate">{step.stepId}</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										{step.tool ?? `@${step.agent ?? ""}`}
									</span>
								</li>
							);
						})}
					</ol>
				)}

				{end?.error !== undefined && <p className="pt-3 text-sm text-destructive">{end.error}</p>}
			</div>
		</>
	);
}

/** The last step is the one the run is on, unless something has already said how the run ended. */
function standingOf(step: WorkflowStep, last: boolean, end?: WorkflowEnd): Standing {
	if (step.skipped) return "skipped";
	if (end !== undefined && end.stepId === step.stepId && end.status !== "done") return end.status;
	if (!last) return "done";

	return end === undefined ? "running" : end.status === "done" ? "done" : end.status;
}
