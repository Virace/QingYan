import type { AdminComment, CommentStatus } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { textareaClass } from "./admin-ui";
import {
	type CommentActionId,
	commentActionsForStatus,
} from "./comment-actions";
import { CommentActionButton } from "./comment-row-actions";
import { formatAdminCommentTime } from "./time-format";

function rowTone(status: CommentStatus) {
	if (status === "pending") {
		return "border-l-4 border-l-amber-500 bg-amber-50/70";
	}
	if (status === "spam") {
		return "border-l-4 border-l-destructive bg-red-50/70";
	}
	if (status === "trash") {
		return "border-l-4 border-l-muted-foreground bg-muted/50 opacity-85";
	}
	return "border-l-4 border-l-transparent bg-background";
}

function statusLabel(status: CommentStatus) {
	if (status === "pending") {
		return "待审";
	}
	if (status === "spam") {
		return "垃圾";
	}
	if (status === "trash") {
		return "回收站";
	}
	return null;
}

function authorInitial(name: string) {
	return name.trim().slice(0, 1).toUpperCase() || "?";
}

function formatIpLocation(location: AdminComment["authorIpLocation"]) {
	if (location.error) {
		return `地址 ${location.error}`;
	}
	return (
		[location.country, location.region, location.city, location.isp]
			.filter(Boolean)
			.join(" / ") || "地址 -"
	);
}

export interface CommentsListProps {
	comments: AdminComment[];
	selectedCommentIds: string[];
	allVisibleSelected: boolean;
	activeReplyId: string | null;
	replyDrafts: Record<string, string>;
	mutationPending: boolean;
	onToggleAll: (checked: boolean) => void;
	onToggleOne: (commentId: string, checked: boolean) => void;
	onAction: (comment: AdminComment, action: CommentActionId) => void;
	onTogglePinned: (comment: AdminComment) => void;
	onToggleFolded: (comment: AdminComment) => void;
	onReplyOpen: (commentId: string) => void;
	onReplyCancel: () => void;
	onReplyDraftChange: (commentId: string, value: string) => void;
	onReplySubmit: (commentId: string) => void;
	onRefreshMetadata: (commentId: string) => void;
	onToggleEmailBlacklist: (comment: AdminComment) => void;
	onToggleIpBlacklist: (comment: AdminComment) => void;
}

export function CommentsList(props: CommentsListProps) {
	return (
		<div className="rounded-md border">
			<div className="grid grid-cols-[2.5rem_minmax(12rem,18rem)_minmax(18rem,1fr)_minmax(12rem,18rem)] gap-3 border-b bg-muted/60 p-3 text-sm font-medium max-xl:hidden">
				<input
					type="checkbox"
					aria-label="选择当前页评论"
					checked={props.allVisibleSelected}
					onChange={(event) => props.onToggleAll(event.target.checked)}
				/>
				<span>作者</span>
				<span>评论</span>
				<span>页面</span>
			</div>
			<div>
				{props.comments.map((comment) => {
					const label = statusLabel(comment.status);

					return (
						<div
							key={comment.id}
							data-comment-id={comment.id}
							className={cn(
								"group grid gap-3 border-b p-3 last:border-b-0 xl:grid-cols-[2.5rem_minmax(12rem,18rem)_minmax(18rem,1fr)_minmax(12rem,18rem)]",
								rowTone(comment.status),
							)}
						>
							<div>
								<input
									type="checkbox"
									aria-label={`选择评论 ${comment.id}`}
									checked={props.selectedCommentIds.includes(comment.id)}
									onChange={(event) =>
										props.onToggleOne(comment.id, event.target.checked)
									}
								/>
							</div>
							<div className="flex min-w-0 gap-3">
								{comment.authorAvatarUrl ? (
									<img
										className="size-10 shrink-0 rounded-full border object-cover"
										src={comment.authorAvatarUrl}
										alt={`${comment.authorName} 头像`}
										loading="lazy"
									/>
								) : (
									<div
										className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium text-muted-foreground"
										aria-hidden="true"
									>
										{authorInitial(comment.authorName)}
									</div>
								)}
								<div className="min-w-0">
									<p className="truncate font-medium">{comment.authorName}</p>
									<p className="truncate text-xs text-muted-foreground">
										{comment.authorEmail ?? "-"}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										IP {comment.authorIp ?? "-"}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{formatIpLocation(comment.authorIpLocation)}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										UA {comment.authorUserAgent ?? "-"}
									</p>
									<div className="mt-2 flex flex-wrap gap-1">
										{comment.blacklist.email ? (
											<Badge variant="destructive">邮箱黑名单</Badge>
										) : null}
										{comment.blacklist.ip ? (
											<Badge variant="destructive">IP 黑名单</Badge>
										) : null}
									</div>
								</div>
							</div>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									{label ? (
										<Badge variant="outline">{label}</Badge>
									) : (
										<span className="sr-only">已通过</span>
									)}
									{comment.isPinned ? (
										<Badge variant="secondary">置顶</Badge>
									) : null}
									{comment.isFolded ? (
										<Badge variant="secondary">折叠</Badge>
									) : null}
								</div>
								<p className="mt-2 line-clamp-3 text-sm">
									{comment.contentRaw}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									赞 {comment.voteUpCount} / 回复 {comment.replyCount}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									时间 {formatAdminCommentTime(comment.createdAt)}
								</p>
								<div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 opacity-100 xl:opacity-0 xl:transition-opacity xl:group-hover:opacity-100 xl:group-focus-within:opacity-100">
									{commentActionsForStatus(comment.status).map((action) => (
										<CommentActionButton
											key={action.id}
											tone={action.tone}
											disabled={props.mutationPending}
											onClick={() => props.onAction(comment, action.id)}
										>
											{action.label}
										</CommentActionButton>
									))}
									{comment.status !== "trash" ? (
										<CommentActionButton
											onClick={() => props.onReplyOpen(comment.id)}
										>
											回复
										</CommentActionButton>
									) : null}
									<CommentActionButton
										onClick={() => props.onTogglePinned(comment)}
									>
										{comment.isPinned ? "取消置顶" : "置顶"}
									</CommentActionButton>
									<CommentActionButton
										onClick={() => props.onToggleFolded(comment)}
									>
										{comment.isFolded ? "展开" : "折叠"}
									</CommentActionButton>
									{comment.authorIp ? (
										<CommentActionButton
											onClick={() => props.onRefreshMetadata(comment.id)}
										>
											刷新地址
										</CommentActionButton>
									) : null}
									{comment.authorIp ? (
										<CommentActionButton
											tone="danger"
											onClick={() => props.onToggleIpBlacklist(comment)}
										>
											{comment.blacklist.ip ? "解除 IP" : "拉黑 IP"}
										</CommentActionButton>
									) : null}
									{comment.authorEmail ? (
										<CommentActionButton
											tone="danger"
											onClick={() => props.onToggleEmailBlacklist(comment)}
										>
											{comment.blacklist.email ? "解除邮箱" : "拉黑邮箱"}
										</CommentActionButton>
									) : null}
								</div>
								{props.activeReplyId === comment.id ? (
									<form
										className="mt-3 grid gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											props.onReplySubmit(comment.id);
										}}
									>
										<textarea
											className={textareaClass}
											rows={3}
											placeholder="快速回复"
											value={props.replyDrafts[comment.id] ?? ""}
											onChange={(event) =>
												props.onReplyDraftChange(comment.id, event.target.value)
											}
										/>
										<div className="flex gap-2">
											<Button type="submit" size="sm">
												回复
											</Button>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={props.onReplyCancel}
											>
												取消
											</Button>
										</div>
									</form>
								) : null}
							</div>
							<div className="min-w-0 text-sm">
								<p className="truncate">{comment.pageTitle ?? "-"}</p>
								<p className="truncate text-xs text-muted-foreground">
									{comment.pageKey}
								</p>
								{comment.pageUrl ? (
									<p className="truncate text-xs text-muted-foreground">
										{comment.pageUrl}
									</p>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
