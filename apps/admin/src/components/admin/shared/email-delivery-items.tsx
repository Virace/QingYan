import type { CommentEmailDeliveryItem } from "@/api/email-delivery";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { emailDeliveryPhaseLabel } from "../content/comment-email-delivery-model";
import { formatAdminDateTime } from "./time-format";

const stateClasses = {
	accepted:
		"border-emerald-600/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
	failed:
		"border-red-600/40 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
	processing:
		"border-amber-600/40 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
	not_sent: "border-muted-foreground/30 bg-muted text-muted-foreground",
} as const;

function keyedItems(items: CommentEmailDeliveryItem[]) {
	const occurrences = new Map<string, number>();
	return items.map((item) => {
		const baseKey = [
			item.flow,
			item.recipient?.address ?? item.kind,
			item.updatedAt,
			item.phase,
		].join("-");
		const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
		occurrences.set(baseKey, occurrence);
		return { item, key: `${baseKey}-${occurrence}` };
	});
}

export function EmailDeliveryItems({
	items,
}: {
	items: CommentEmailDeliveryItem[];
}) {
	return (
		<div className="grid gap-2">
			{keyedItems(items).map(({ item, key }) => (
				<div
					key={key}
					className="grid gap-2 rounded-md border bg-background p-3"
				>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="text-sm font-medium">
								{item.recipient?.label ?? "未生成实际投递"}
							</p>
							{item.recipient ? (
								<p className="truncate text-xs text-muted-foreground">
									{item.recipient.address}
								</p>
							) : null}
						</div>
						<Badge
							variant="outline"
							className={cn(
								"whitespace-normal text-right",
								stateClasses[item.state],
							)}
						>
							{emailDeliveryPhaseLabel(item)}
						</Badge>
					</div>
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>
							尝试 {item.attemptCount}/{item.maxAttempts}
						</span>
						<span>
							{item.acceptedAt ? "服务商接受" : "最后更新"}{" "}
							{formatAdminDateTime(item.acceptedAt ?? item.updatedAt)}
						</span>
					</div>
					{item.message ? (
						<p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
							{item.message}
						</p>
					) : null}
				</div>
			))}
		</div>
	);
}
