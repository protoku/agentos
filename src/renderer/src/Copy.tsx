import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Takes what it is given to the clipboard, and says for a moment that it did. */
export function CopyButton({ label, text, className }: { label: string; text: string; className?: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				"rounded-md p-0.5 text-muted-foreground transition-opacity hover:text-foreground",
				className,
				copied && "text-success opacity-100",
			)}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</button>
	);
}
