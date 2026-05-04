import type { ReactNode } from "react";

export const inputClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
export const textareaClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium">{label}</span>
			{children}
		</div>
	);
}

export function EmptyState({ text }: { text: string }) {
	return (
		<div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
			{text}
		</div>
	);
}
