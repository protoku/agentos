import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** What ask_user was called with, as the thread reads it back off the call's input. */
export interface Question {
	id: string;
	question: string;
	header?: string;
	options: { label: string; description?: string }[];
	multiple?: boolean;
}

/** A call that asks is answered where it stands: the prepared answers, or one of your own. */
export function Questions({
	questions,
	onAnswer,
}: {
	questions: Question[];
	onAnswer: (answers: Record<string, unknown>) => void;
}) {
	const [picked, setPicked] = useState<Record<string, string[]>>({});
	const [written, setWritten] = useState<Record<string, string>>({});

	function answersOf(): Record<string, unknown> {
		return Object.fromEntries(
			questions.map((question) => {
				const own = written[question.id]?.trim() ?? "";
				const answers = picked[question.id] ?? [];
				const chosen = own.length > 0 ? [...answers, own] : answers;

				return [question.id, question.multiple ? chosen : chosen[0]];
			}),
		);
	}

	function choose(question: Question, label: string) {
		setPicked((current) => {
			const chosen = current[question.id] ?? [];
			if (!question.multiple) return { ...current, [question.id]: [label] };

			return {
				...current,
				[question.id]: chosen.includes(label) ? chosen.filter((one) => one !== label) : [...chosen, label],
			};
		});
	}

	// Nothing picked and nothing written is not an answer, so there is nothing to send yet.
	const answerable = questions.every((question) => {
		const answer = answersOf()[question.id];

		return Array.isArray(answer) ? answer.length > 0 : answer !== undefined;
	});

	return (
		<div className="ml-7 flex flex-col gap-4 rounded-lg border border-pending/40 bg-elevated p-3">
			{questions.map((question) => (
				<div key={question.id} className="flex flex-col gap-2">
					<div className="flex items-baseline gap-2">
						{question.header && (
							<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
								{question.header}
							</span>
						)}
						<p className="text-sm">{question.question}</p>
					</div>

					<div className="flex flex-col gap-1">
						{question.options.map((option) => (
							<button
								key={option.label}
								type="button"
								onClick={() => choose(question, option.label)}
								className={cn(
									"rounded-md border px-2 py-1.5 text-left text-sm",
									(picked[question.id] ?? []).includes(option.label)
										? "border-success text-success"
										: "border-border text-muted-foreground hover:text-foreground",
								)}
							>
								{option.label}
								{option.description && (
									<span className="block text-xs text-muted-foreground">{option.description}</span>
								)}
							</button>
						))}
					</div>

					<Input
						value={written[question.id] ?? ""}
						placeholder="Or answer in your own words"
						className="h-8 text-xs"
						onChange={(event) => setWritten((current) => ({ ...current, [question.id]: event.target.value }))}
					/>
				</div>
			))}

			<div>
				<Button size="sm" variant="outline" disabled={!answerable} onClick={() => onAnswer(answersOf())}>
					Answer
				</Button>
			</div>
		</div>
	);
}

/** What the call was asked with, when it is a question at all and reads as one. */
export function questionsOf(input: Record<string, unknown>): Question[] | undefined {
	const asked = input.questions;
	if (!Array.isArray(asked)) return undefined;

	const questions = asked.filter((question): question is Question => reads(question));

	return questions.length === 0 ? undefined : questions;
}

function reads(question: unknown): boolean {
	const asked = question as Question;

	return (
		typeof question === "object" &&
		question !== null &&
		typeof asked.id === "string" &&
		typeof asked.question === "string" &&
		Array.isArray(asked.options)
	);
}
