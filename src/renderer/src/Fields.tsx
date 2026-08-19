import { Markdown } from "./Markdown";
import { thousands } from "./format";
import { cell, type Field } from "../../shared/render";

/** Enough rows to read what came back, few enough that a listing never becomes the thread. */
const rowLimit = 20;

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
		case "table":
			return <Rows columns={field.columns} rows={field.rows} />;
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

/** Rows of the same kind of thing. A table wider than the thread scrolls inside its own box. */
function Rows({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
	const shown = rows.slice(0, rowLimit);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="min-w-0 overflow-x-auto rounded-md border border-border bg-background">
				<table className="w-full border-collapse text-xs">
					<thead>
						<tr className="border-b border-border">
							{columns.map((column) => (
								<th key={column} className="px-2 py-1 text-left font-medium text-muted-foreground">
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{shown.map((row, index) => (
							<tr key={index} className="border-t border-border first:border-t-0">
								{columns.map((column) => (
									<td key={column} className="px-2 py-1 align-top wrap-anywhere">
										{cell(row[column])}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{rows.length > shown.length && (
				<span className="block text-right text-muted-foreground">
					{`${shown.length} of ${thousands(rows.length)} rows`}
				</span>
			)}
		</div>
	);
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
