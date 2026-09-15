import { useEffect, useMemo, useState } from "react";
import { ChartColumn } from "lucide-react";
import { cn } from "@/lib/utils";
import { Nothing } from "./Nothing";
import { money, thousands } from "./format";
import { cachedShare, perDay, tally, unknown, type Day, type Tally } from "../../shared/usage";
import type { TurnUsage } from "../../shared/api";
import type { Agent } from "../../shared/types";

/** How far back the chart looks, which is far enough to see a week's shape and a month's drift. */
const lastDays = 30;

type Measure = "money" | "tokens";

export function Usage({
	workspaceId,
	agents,
	onOpen,
}: {
	workspaceId: string;
	agents: Agent[];
	onOpen: (conversationId: string) => void;
}) {
	const [turns, setTurns] = useState<TurnUsage[]>();
	const [measure, setMeasure] = useState<Measure>("money");

	useEffect(() => {
		setTurns(undefined);
		void window.agentOS.readUsage(workspaceId).then(setTurns);
	}, [workspaceId]);

	const days = useMemo(() => perDay(turns ?? [], lastDays), [turns]);
	const byModel = useMemo(
		() => tally(turns ?? [], (turn) => ({ key: turn.model ?? unknown, name: turn.model ?? unknown })),
		[turns],
	);
	const byAgent = useMemo(
		() =>
			tally(turns ?? [], (turn) => ({
				key: turn.agentId ?? unknown,
				name: agents.find((agent) => agent.id === turn.agentId)?.name ?? unknown,
			})),
		[turns, agents],
	);
	const byConversation = useMemo(
		() => tally(turns ?? [], (turn) => ({ key: turn.conversationId, name: turn.title })),
		[turns],
	);

	const whole = byModel.reduce(
		(total, row) => ({
			turns: total.turns + row.turns,
			sent: total.sent + row.sent,
			cached: total.cached + row.cached,
			usd: total.usd + row.usd,
		}),
		{ turns: 0, sent: 0, cached: 0, usd: 0 },
	);

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="text-sm font-medium">Usage</span>
				{turns !== undefined && turns.length > 0 && (
					<span className="text-xs text-muted-foreground">
						{`${thousands(whole.turns)} ${whole.turns === 1 ? "turn" : "turns"}, ${thousands(whole.sent)} sent, ${Math.round(cachedShare(whole) * 100)}% of it cached, ${money(whole.usd)}`}
					</span>
				)}
			</header>

			{turns === undefined ? (
				<p className="p-6 text-sm text-muted-foreground">Reading what this workspace has spent.</p>
			) : turns.length === 0 ? (
				<Nothing icon={<ChartColumn />} title="Nothing spent yet">
					What a turn costs is recorded when it ends. Mention an agent, and what it spends is counted here.
				</Nothing>
			) : (
				<div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
					<Chart days={days} measure={measure} onMeasure={setMeasure} />
					<Table title="By model" rows={byModel} />
					<Table title="By agent" rows={byAgent} />
					<Table title="By conversation" rows={byConversation} onPick={onOpen} />
				</div>
			)}
		</main>
	);
}

function Chart({
	days,
	measure,
	onMeasure,
}: {
	days: Day[];
	measure: Measure;
	onMeasure: (measure: Measure) => void;
}) {
	const of = (day: Day) => (measure === "money" ? day.usd : day.sent);
	const tallest = Math.max(...days.map(of), 1);
	const total = days.reduce((sum, day) => sum + of(day), 0);

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-4">
				<h2 className="text-sm font-medium">{`The last ${days.length} days`}</h2>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{measure === "money" ? money(total) : `${thousands(total)} sent`}
					</span>
					<div className="flex gap-1">
						{(["money", "tokens"] as const).map((one) => (
							<button
								key={one}
								type="button"
								onClick={() => onMeasure(one)}
								className={cn(
									"rounded-md px-2 py-1 text-xs",
									one === measure
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{one === "money" ? "Money" : "Tokens"}
							</button>
						))}
					</div>
				</div>
			</div>

			<div className="flex h-24 items-end gap-1">
				{days.map((day) => (
					<div
						key={day.day}
						title={`${day.day}: ${measure === "money" ? money(day.usd) : `${thousands(day.sent)} sent`}, ${day.turns} ${day.turns === 1 ? "turn" : "turns"}`}
						className="flex h-full flex-1 items-end"
					>
						<div
							className={cn("w-full rounded-sm", of(day) > 0 ? "bg-muted-foreground" : "bg-muted")}
							style={{ height: `${of(day) > 0 ? Math.max((of(day) / tallest) * 100, 4) : 2}%` }}
						/>
					</div>
				))}
			</div>

			<div className="flex justify-between text-xs text-muted-foreground">
				<span>{days[0]?.day}</span>
				<span>{days.at(-1)?.day}</span>
			</div>
		</section>
	);
}

function Table({ title, rows, onPick }: { title: string; rows: Tally[]; onPick?: (key: string) => void }) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="text-sm font-medium">{title}</h2>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="text-xs text-muted-foreground">
						<tr className="border-b border-border">
							<th className="py-1.5 text-left font-medium">Name</th>
							<th className="py-1.5 text-right font-medium">Turns</th>
							<th className="py-1.5 text-right font-medium">Sent</th>
							<th className="py-1.5 text-right font-medium">Cached</th>
							<th className="py-1.5 text-right font-medium">Back</th>
							<th className="py-1.5 text-right font-medium">Cost</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key} className="border-b border-border/50">
								<td className="max-w-0 truncate py-1.5">
									{onPick === undefined ? (
										row.name
									) : (
										<button
											type="button"
											onClick={() => onPick(row.key)}
											className="truncate underline-offset-4 hover:underline"
										>
											{row.name}
										</button>
									)}
								</td>
								<td className="py-1.5 text-right tabular-nums">{row.turns}</td>
								<td className="py-1.5 text-right tabular-nums">{thousands(row.sent)}</td>
								<td className="py-1.5 text-right tabular-nums text-muted-foreground">
									{`${Math.round(cachedShare(row) * 100)}%`}
								</td>
								<td className="py-1.5 text-right tabular-nums">{thousands(row.received)}</td>
								<td className="py-1.5 text-right tabular-nums">{money(row.usd)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
