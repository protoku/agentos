import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** What every blank middle says: what is missing, and what to do about it. */
export function Nothing({ icon, title, children }: { icon: React.ReactNode; title: string; children: string }) {
	return (
		<Empty className="flex-1">
			<EmptyHeader>
				<EmptyMedia variant="icon">{icon}</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{children}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
