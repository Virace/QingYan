import { Tooltip } from "@radix-ui/themes";
import {
	MailCheckIcon,
	MailMinusIcon,
	MailQuestionMarkIcon,
	MailWarningIcon,
	MailXIcon,
} from "lucide-react";

import type { CommentEmailDeliverySummary } from "@/api/email-delivery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { emailDeliveryStatePresentation } from "./comment-email-delivery-model";

const toneClasses = {
	success:
		"text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200",
	danger:
		"text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40 dark:hover:text-red-200",
	warning:
		"text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40 dark:hover:text-amber-200",
	muted: "text-muted-foreground hover:bg-muted hover:text-foreground",
	unknown: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

function StateIcon({ state }: { state: CommentEmailDeliverySummary["state"] }) {
	if (state === "accepted") {
		return <MailCheckIcon aria-hidden="true" />;
	}
	if (state === "failed") {
		return <MailXIcon aria-hidden="true" />;
	}
	if (state === "processing") {
		return <MailWarningIcon aria-hidden="true" />;
	}
	if (state === "not_sent") {
		return <MailMinusIcon aria-hidden="true" />;
	}
	return <MailQuestionMarkIcon aria-hidden="true" />;
}

export function CommentEmailDeliveryButton({
	summary,
	onClick,
}: {
	summary: CommentEmailDeliverySummary;
	onClick: () => void;
}) {
	const presentation = emailDeliveryStatePresentation(summary);
	return (
		<Tooltip content={presentation.accessibleLabel}>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className={cn(
					"h-6 gap-1 px-1 text-xs font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-3.5",
					toneClasses[presentation.tone],
				)}
				aria-label={presentation.accessibleLabel}
				data-email-delivery-state={summary.state}
				onClick={onClick}
			>
				<StateIcon state={summary.state} />
				<span>{presentation.label}</span>
			</Button>
		</Tooltip>
	);
}
