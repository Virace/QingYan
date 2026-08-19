import { Dialog } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { getCommentEmailDeliveryStatus } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { EmptyState } from "../shared/admin-ui";
import { EmailDeliveryItems } from "../shared/email-delivery-items";
import { formatAdminDateTime } from "../shared/time-format";
import {
	emailDeliveryRecoveryTarget,
	emailDeliveryStatePresentation,
	emailDeliverySummaryText,
	shouldPollEmailDelivery,
} from "./comment-email-delivery-model";

export function CommentEmailDeliveryDialog({
	commentId,
	open,
	onOpenChange,
	onOpenTaskRecords,
}: {
	commentId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOpenTaskRecords: (commentId: string) => void;
}) {
	const [pollCount, setPollCount] = useState(0);
	const statusQuery = useQuery({
		queryKey: ["admin", "comment-email-delivery", commentId],
		queryFn: () => getCommentEmailDeliveryStatus(commentId ?? ""),
		enabled: open && Boolean(commentId),
		refetchInterval: (query) =>
			shouldPollEmailDelivery(
				query.state.data?.summary,
				pollCount,
				typeof document === "undefined" ||
					document.visibilityState === "visible",
			)
				? 2000
				: false,
		refetchIntervalInBackground: false,
	});

	useEffect(() => {
		if (open && commentId) {
			setPollCount(0);
		}
	}, [commentId, open]);

	useEffect(() => {
		if (
			statusQuery.dataUpdatedAt > 0 &&
			statusQuery.data?.summary.state === "processing"
		) {
			setPollCount((current) => current + 1);
		}
	}, [statusQuery.data?.summary.state, statusQuery.dataUpdatedAt]);

	const recoveryTargets = useMemo(
		() =>
			new Set(
				(statusQuery.data?.groups ?? [])
					.flatMap((group) => group.items)
					.map(emailDeliveryRecoveryTarget)
					.filter((target) => target !== null),
			),
		[statusQuery.data?.groups],
	);
	const presentation = statusQuery.data
		? emailDeliveryStatePresentation(statusQuery.data.summary)
		: null;

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="760px">
				<Dialog.Title>邮件投递状态</Dialog.Title>
				<Dialog.Description size="2">
					查看这条评论相关的邮件流程和服务商接受结果。
				</Dialog.Description>
				{statusQuery.data && presentation ? (
					<div className="mt-4 grid gap-4">
						<div
							className="grid gap-2 rounded-md border bg-muted/20 p-3"
							aria-live="polite"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<p className="font-semibold">{presentation.label}</p>
									<p className="text-sm text-muted-foreground">
										{emailDeliverySummaryText(statusQuery.data.summary)}
									</p>
								</div>
								<Badge variant="outline">
									实际投递 {statusQuery.data.summary.deliveryCount}
								</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								最后更新{" "}
								{formatAdminDateTime(statusQuery.data.summary.lastUpdatedAt)}
							</p>
						</div>

						{statusQuery.data.groups.length > 0 ? (
							<div className="grid gap-4">
								{statusQuery.data.groups.map((group) => (
									<section key={group.flow} className="grid gap-2">
										<div className="flex items-center justify-between gap-2">
											<h3 className="text-sm font-semibold">{group.label}</h3>
											<Badge variant="secondary">{group.items.length}</Badge>
										</div>
										<EmailDeliveryItems items={group.items} />
									</section>
								))}
							</div>
						) : (
							<EmptyState text="没有找到可验证的邮件投递或未发送记录。" />
						)}

						<div className="flex flex-wrap justify-between gap-2 border-t pt-3">
							<div className="flex flex-wrap gap-2">
								{recoveryTargets.has("system_mail") ? (
									<Button asChild size="sm" variant="outline">
										<a href="?view=system&systemTab=mail">打开系统邮件设置</a>
									</Button>
								) : null}
								{recoveryTargets.has("site_notifications") ? (
									<Button asChild size="sm" variant="outline">
										<a href="?view=settings&siteTab=notifications">
											打开站点通知设置
										</a>
									</Button>
								) : null}
								{statusQuery.data.canViewTaskRecords && commentId ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => {
											onOpenChange(false);
											onOpenTaskRecords(commentId);
										}}
									>
										查看任务记录
									</Button>
								) : null}
							</div>
							<Dialog.Close>
								<Button type="button" size="sm" variant="outline">
									关闭
								</Button>
							</Dialog.Close>
						</div>
					</div>
				) : statusQuery.isError ? (
					<div className="mt-4 grid gap-3">
						<EmptyState text="无法加载邮件投递状态，请重试。" />
						<div className="flex justify-end">
							<Button
								type="button"
								variant="outline"
								onClick={() => statusQuery.refetch()}
							>
								重试
							</Button>
						</div>
					</div>
				) : (
					<div className="mt-4">
						<EmptyState text="正在加载邮件投递状态" />
					</div>
				)}
			</Dialog.Content>
		</Dialog.Root>
	);
}
