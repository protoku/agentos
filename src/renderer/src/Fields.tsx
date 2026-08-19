import { Markdown } from "./Markdown";
import { thousands } from "./format";
import type { Field } from "../../shared/render";

/** One column for names and one for what they hold, whatever kind the schema says that is. */
export function FieldRow({ field }: { field: Field }) {
	return (
		<div className="flex min-w-0 items-baseline gap-3 text-xs">
			<span className="w-24 shrink-0 truncate text-right text-muted-foreground" title={field.name}>
				{field.name}
			</span>

			<div className="min-w-0 flex-1">
				<Held field={field} />
			</div>
		</div>
	);
}

function Held({ field }: { field: Field }) {
	switch (field.kind) {
		case "markdown":
			return <Markdown content={field.value} className="text-xs" />;
		case "text":
			return <Written text={field.value} />;
		case "block":
			return <Written text={field.written} />;
		case "inline":
			return <span className="wrap-anywhere">{field.written}</span>;
	}
}

/**
 * Read as written rather than dumped: lines are kept instead of shown as \n, and nothing scrolls
 * sideways, since a command line or a path is exactly what you came to read.
 */
function Written({ text }: { text: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<pre className="min-w-0 rounded-md border border-border bg-background p-2 wrap-anywhere whitespace-pre-wrap">
				{text}
			</pre>
			{text.length > 2000 && (
				<span className="block text-right text-muted-foreground">{`${thousands(text.length)} characters`}</span>
			)}
		</div>
	);
}
