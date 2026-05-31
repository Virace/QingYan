import type * as React from "react";

import { cn } from "@/lib/utils";

function Switch({
	className,
	checked,
	onCheckedChange,
	disabled,
	...props
}: Omit<React.ComponentProps<"button">, "onChange"> & {
	checked: boolean;
	onCheckedChange?: (checked: boolean) => void;
}) {
	return (
		<button
			{...props}
			type="button"
			role="switch"
			aria-checked={checked}
			data-state={checked ? "checked" : "unchecked"}
			disabled={disabled}
			className={cn(
				"focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-primary" : "bg-input",
				className,
			)}
			onClick={(event) => {
				props.onClick?.(event);
				if (!event.defaultPrevented) {
					onCheckedChange?.(!checked);
				}
			}}
			onKeyDown={(event) => {
				props.onKeyDown?.(event);
				if (event.defaultPrevented) {
					return;
				}
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onCheckedChange?.(!checked);
				}
			}}
		>
			<span
				data-state={checked ? "checked" : "unchecked"}
				className={cn(
					"pointer-events-none block size-5 rounded-full bg-background shadow-sm ring-0 transition-transform",
					checked ? "translate-x-5" : "translate-x-0",
				)}
			/>
		</button>
	);
}

export { Switch };
