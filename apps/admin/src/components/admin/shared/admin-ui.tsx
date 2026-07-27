import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const inputClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
export const textareaClass =
	"border-input bg-background ring-offset-background focus-visible:ring-ring flex min-h-24 w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export function Field({
	label,
	description,
	error,
	children,
}: {
	label: string;
	description?: string;
	error?: string;
	children: ReactNode;
}) {
	const hasDescription = Boolean(description);

	return (
		<div className="flex flex-col gap-2" data-field-label={label}>
			<div
				className={cn(
					"grid min-h-[2.375rem]",
					hasDescription ? "content-start gap-1" : "content-end",
				)}
			>
				<span className="text-sm font-semibold leading-none">{label}</span>
				{description ? (
					<span className="text-xs leading-5 text-muted-foreground">
						{description}
					</span>
				) : null}
			</div>
			{children}
			{error ? (
				<p className="text-xs font-medium leading-5 text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

export function BooleanField({
	label,
	description,
	checked,
	onCheckedChange,
	error,
	disabled = false,
}: {
	label: string;
	description?: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	error?: string;
	disabled?: boolean;
}) {
	return (
		<Field label={label} description={description} error={error}>
			<div
				className={`flex min-h-9 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm ${
					disabled ? "opacity-60" : ""
				}`}
			>
				<span className="text-muted-foreground">
					{checked ? "开启" : "关闭"}
				</span>
				<Switch
					aria-label={label}
					checked={checked}
					disabled={disabled}
					onCheckedChange={onCheckedChange}
				/>
			</div>
		</Field>
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

export function SettingsToggleGroup({
	title,
	description,
	checked,
	onCheckedChange,
	switchLabel,
	disabledSummary,
	error,
	children,
	testId,
}: {
	title: string;
	description?: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	switchLabel?: string;
	disabledSummary: ReactNode;
	error?: string;
	children: ReactNode;
	testId?: string;
}) {
	const label = switchLabel ?? title;
	return (
		<section
			data-testid={testId}
			className="flex flex-col gap-4 rounded-md border bg-muted/20 p-4 md:col-span-2"
		>
			<header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="grid gap-1">
					<h2 className="text-base font-semibold leading-none">{title}</h2>
					{description ? (
						<p className="text-sm leading-6 text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				<div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm md:min-w-36">
					<span className="text-muted-foreground">
						{checked ? "开启" : "关闭"}
					</span>
					<Switch
						aria-label={label}
						checked={checked}
						onCheckedChange={onCheckedChange}
					/>
				</div>
			</header>
			{error ? (
				<p className="text-xs font-medium leading-5 text-destructive">
					{error}
				</p>
			) : null}
			{checked ? (
				children
			) : (
				<div className="rounded-md border bg-background p-3 text-sm leading-6 text-muted-foreground">
					{disabledSummary}
				</div>
			)}
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

export function StatTile({
	label,
	value,
	help,
}: {
	label: string;
	value: ReactNode;
	help?: ReactNode;
}) {
	return (
		<div className="rounded-md border p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<div className="mt-1 text-sm font-medium">{value}</div>
			{help ? (
				<p className="mt-1 text-xs text-muted-foreground">{help}</p>
			) : null}
		</div>
	);
}
