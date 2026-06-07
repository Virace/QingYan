import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function isHttpUrl(value: string) {
	return value.startsWith("https://") || value.startsWith("http://");
}

export function ExternalLinkText({
	href,
	children,
	className,
	muted = true,
}: {
	href?: string | null;
	children?: ReactNode;
	className?: string;
	muted?: boolean;
}) {
	const label = children ?? href ?? "-";
	if (!href || !isHttpUrl(href)) {
		return (
			<span
				className={cn(
					"break-all",
					muted ? "text-muted-foreground" : undefined,
					className,
				)}
			>
				{label}
			</span>
		);
	}

	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className={cn(
				"inline-flex max-w-full items-center gap-1 break-all text-primary underline-offset-4 hover:underline",
				muted ? "text-muted-foreground hover:text-foreground" : undefined,
				className,
			)}
		>
			<span className="min-w-0 break-all">{label}</span>
			<ExternalLinkIcon className="size-3 shrink-0" aria-hidden="true" />
		</a>
	);
}
