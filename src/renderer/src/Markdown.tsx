import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** How a model writes: rendered as a React tree, so nothing an agent says becomes markup. */
export function Markdown({ content, className }: { content: string; className?: string }) {
	return (
		<div className={cn("flex flex-col gap-2 break-words", className ?? "text-sm")}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children }) => <h1 className="text-base font-medium">{children}</h1>,
					h2: ({ children }) => <h2 className="text-sm font-medium">{children}</h2>,
					h3: ({ children }) => <h3 className="text-sm font-medium">{children}</h3>,
					p: ({ children }) => <p>{children}</p>,
					ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
					ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
					li: ({ children }) => <li>{children}</li>,
					strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
					em: ({ children }) => <em className="italic">{children}</em>,
					a: ({ href, children }) => (
						<a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
							{children}
						</a>
					),
					blockquote: ({ children }) => (
						<blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
					),
					hr: () => <hr className="border-border" />,
					code: ({ className, children }) =>
						// A fenced block carries a language class; anything else is an inline span.
						className === undefined ? (
							<code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
						) : (
							<code className={className}>{children}</code>
						),
					pre: ({ children }) => (
						<pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{children}</pre>
					),
					table: ({ children }) => (
						<div className="overflow-x-auto">
							<table className="w-full border-collapse text-xs">{children}</table>
						</div>
					),
					th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>,
					td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
