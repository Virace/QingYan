import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { CommentActionDefinition } from "./comment-actions";

export function CommentActionButton({
	children,
	tone = "default",
	onClick,
	disabled,
}: {
	children: ReactNode;
	tone?: CommentActionDefinition["tone"];
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"inline text-sm underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50",
				tone === "success" && "text-emerald-700 dark:text-emerald-300",
				tone === "warning" && "text-amber-700 dark:text-amber-300",
				tone === "danger" && "text-destructive",
				tone === "default" && "text-primary",
			)}
		>
			{children}
		</button>
	);
}
