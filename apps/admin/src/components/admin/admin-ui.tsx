import type { ReactNode } from "react";

export const inputClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
export const textareaClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export function Field({
	label,
	description,
	children,
}: {
	label: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2.5">
			<div className="grid gap-1">
				<span className="text-sm font-semibold leading-none">{label}</span>
				{description ? (
					<span className="text-xs leading-5 text-muted-foreground">
						{description}
					</span>
				) : null}
			</div>
			{children}
		</div>
	);
}

export function SettingsSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4 rounded-md border bg-muted/20 p-4 md:col-span-2">
			<header className="grid gap-1">
				<h2 className="text-base font-semibold leading-none">{title}</h2>
				{description ? (
					<p className="text-sm leading-6 text-muted-foreground">
						{description}
					</p>
				) : null}
			</header>
			{children}
		</section>
	);
}

export function SettingsSubsection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-4 rounded-md border bg-background p-3 md:grid-cols-2">
			<header className="grid gap-1 md:col-span-2">
				<h3 className="text-sm font-semibold leading-none">{title}</h3>
				{description ? (
					<p className="text-xs leading-5 text-muted-foreground">
						{description}
					</p>
				) : null}
			</header>
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
