import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
	type AdminComment,
	bulkTrashComments,
	bulkUpdateComments,
	type CommentStatus,
	clearTrash,
	createBlacklist,
	deleteBlacklistTarget,
	deleteComment,
	listComments,
	refreshCommentMetadata,
	refreshSelectedCommentMetadata,
	replyToComment,
	updateComment,
} from "@/api/admin";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { PaginationControls } from "../shared/admin-pagination";
import { EmptyState, inputClass } from "../shared/admin-ui";
import type { CommentActionId } from "./comment-actions";
import { CommentsList } from "./comments-list";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import { ResourceFilters, usePaginationState } from "./collection-shared";

type CommentView = "all" | "pending" | "approved" | "spam" | "trash";
type BulkCommentAction =
	| "approve"
	| "pending"
	| "spam"
	| "trash"
	| "restore"
	| "delete"
	| "pin"
	| "unpin"
	| "fold"
	| "unfold"
	| "refreshMetadata";

const commentViews: Array<{
	id: CommentView;
	label: string;
	status?: CommentStatus;
}> = [
	{ id: "all", label: "全部" },
	{ id: "pending", label: "待审", status: "pending" },
	{ id: "approved", label: "已通过", status: "approved" },
	{ id: "spam", label: "垃圾", status: "spam" },
	{ id: "trash", label: "回收站", status: "trash" },
];
export function CommentsPage({
	siteKey,
	search,
	setSearch,
	pageKey,
	setPageKey,
}: {
	siteKey?: string;
	search: string;
	setSearch: (value: string) => void;
	pageKey: string;
	setPageKey: (value: string) => void;
}) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [view, setView] = useState<CommentView>("all");
	const pagination = usePaginationState(20);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [selectedCommentIds, setSelectedCommentIds] = useState<string[]>([]);
	const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
	const [bulkAction, setBulkAction] = useState<BulkCommentAction>("approve");
	const currentView =
		commentViews.find((item) => item.id === view) ?? commentViews[0];
	const commentsQuery = useQuery({
		queryKey: [
			"admin",
			"comments",
			siteKey,
			search,
			pageKey,
			view,
			pagination.limit,
			pagination.offset,
		],
		queryFn: () =>
			listComments({
				siteKey,
				pageKey,
				search,
				status: currentView.status,
				limit: pagination.limit,
				offset: pagination.offset,
			}),
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			id: string;
			status?: CommentStatus;
			isPinned?: boolean;
			isFolded?: boolean;
		}) => updateComment(input.id, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteComment,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const refreshMetadataMutation = useMutation({
		mutationFn: refreshCommentMetadata,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const bulkTrashMutation = useMutation({
		mutationFn: bulkTrashComments,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const bulkUpdateMutation = useMutation({
		mutationFn: bulkUpdateComments,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const bulkRefreshMetadataMutation = useMutation({
		mutationFn: refreshSelectedCommentMetadata,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const clearTrashMutation = useMutation({
		mutationFn: clearTrash,
		onSuccess: () => {
			setSelectedCommentIds([]);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const replyMutation = useMutation({
		mutationFn: (input: { commentId: string; raw: string }) =>
			replyToComment(input.commentId, { content: { raw: input.raw } }),
		onSuccess: (_data, variables) => {
			setReplyDrafts((current) => ({
				...current,
				[variables.commentId]: "",
			}));
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleCommentBlacklist = (input: {
		targetType: "email" | "ip";
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			void (async () => {
				const confirmed = await confirm({
					title: "解除黑名单",
					description:
						"确认删除这条黑名单规则？删除后该目标会恢复评论或访问能力。",
					confirmText: "解除黑名单",
					destructive: true,
				});
				if (!confirmed) {
					return;
				}
				deleteBlacklistMutation.mutate({
					siteKey,
					targetType: input.targetType,
					matchMode: "exact",
					targetValue: input.targetValue,
				});
			})();
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: input.targetType,
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};
	const blacklistMutationPending =
		createBlacklistMutation.isPending || deleteBlacklistMutation.isPending;
	const isTrashView = view === "trash";
	const visibleCommentIds =
		commentsQuery.data?.items.map((comment) => comment.id) ?? [];
	const selectedVisibleIds = selectedCommentIds.filter((commentId) =>
		visibleCommentIds.includes(commentId),
	);
	const allVisibleSelected =
		visibleCommentIds.length > 0 &&
		visibleCommentIds.every((commentId) =>
			selectedCommentIds.includes(commentId),
		);

	const toggleSelectedComment = (commentId: string, checked: boolean) => {
		setSelectedCommentIds((current) =>
			checked
				? Array.from(new Set([...current, commentId]))
				: current.filter((value) => value !== commentId),
		);
	};
	const toggleAllVisibleComments = (checked: boolean) => {
		setSelectedCommentIds((current) =>
			checked
				? Array.from(new Set([...current, ...visibleCommentIds]))
				: current.filter((commentId) => !visibleCommentIds.includes(commentId)),
		);
	};
	const moveCommentsToTrash = async (commentIds: string[]) => {
		if (commentIds.length === 0) {
			return;
		}
		const confirmed = await confirm({
			title: "移入回收站",
			description: `确认将 ${commentIds.length} 条评论移入回收站？可在回收站中恢复。`,
			confirmText: "移入回收站",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		bulkTrashMutation.mutate(commentIds);
	};
	const permanentlyDeleteComment = async (commentId: string) => {
		const confirmed = await confirm({
			title: "永久删除评论",
			description: "确认永久删除这条回收站评论？此操作不可恢复。",
			confirmText: "永久删除",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(commentId);
	};
	const clearCurrentTrash = async () => {
		const confirmed = await confirm({
			title: "清空回收站",
			description: "确认清空当前站点回收站？此操作不可恢复。",
			confirmText: "清空回收站",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		clearTrashMutation.mutate({ siteKey });
	};
	const handleCommentAction = (
		comment: AdminComment,
		action: CommentActionId,
	) => {
		if (action === "approve") {
			updateMutation.mutate({ id: comment.id, status: "approved" });
			return;
		}
		if (action === "pending") {
			updateMutation.mutate({ id: comment.id, status: "pending" });
			return;
		}
		if (action === "spam") {
			updateMutation.mutate({ id: comment.id, status: "spam" });
			return;
		}
		if (action === "trash") {
			void moveCommentsToTrash([comment.id]);
			return;
		}
		if (action === "restore") {
			updateMutation.mutate({ id: comment.id, status: "pending" });
			return;
		}
		if (action === "delete") {
			void permanentlyDeleteComment(comment.id);
		}
	};
	const applyBulkAction = async () => {
		const ids = selectedVisibleIds;
		if (ids.length === 0) {
			return;
		}
		if (bulkAction === "delete") {
			const confirmed = await confirm({
				title: "永久删除评论",
				description: `确认永久删除 ${ids.length} 条评论？此操作不可恢复。`,
				confirmText: "永久删除",
				destructive: true,
			});
			if (!confirmed) {
				return;
			}
			for (const commentId of ids) {
				deleteMutation.mutate(commentId);
			}
			setSelectedCommentIds([]);
			return;
		}
		if (bulkAction === "refreshMetadata") {
			bulkRefreshMetadataMutation.mutate(ids);
			return;
		}
		if (bulkAction === "trash") {
			await moveCommentsToTrash(ids);
			return;
		}

		const patchByAction: Record<
			Exclude<BulkCommentAction, "delete" | "refreshMetadata" | "trash">,
			{ status?: CommentStatus; isPinned?: boolean; isFolded?: boolean }
		> = {
			approve: { status: "approved" },
			pending: { status: "pending" },
			spam: { status: "spam" },
			restore: { status: "pending" },
			pin: { isPinned: true },
			unpin: { isPinned: false },
			fold: { isFolded: true },
			unfold: { isFolded: false },
		};
		bulkUpdateMutation.mutate({
			commentIds: ids,
			patch: patchByAction[bulkAction],
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">评论</CardTitle>
				<CardDescription>审核、置顶、折叠或删除评论。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-wrap gap-2 text-sm">
					{commentViews.map((item) => (
						<Button
							key={item.id}
							type="button"
							size="sm"
							variant={view === item.id ? "secondary" : "ghost"}
							onClick={() => {
								setView(item.id);
								setSelectedCommentIds([]);
								pagination.resetPage();
							}}
						>
							{item.label}
						</Button>
					))}
				</div>
				<ResourceFilters
					search={search}
					setSearch={(value) => {
						setSearch(value);
						pagination.resetPage();
					}}
					pageKey={pageKey}
					setPageKey={(value) => {
						setPageKey(value);
						pagination.resetPage();
					}}
				/>
				<PaginationControls
					limit={pagination.limit}
					pageIndex={pagination.pageIndex}
					totalCount={commentsQuery.data?.pagination.totalCount ?? 0}
					itemCount={commentsQuery.data?.items.length ?? 0}
					setLimit={pagination.setLimit}
					setPageIndex={(value) => {
						setSelectedCommentIds([]);
						pagination.setPageIndex(value);
					}}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm text-muted-foreground">
						已选择 {selectedVisibleIds.length} 条
					</span>
					<select
						className={inputClass}
						value={bulkAction}
						onChange={(event) =>
							setBulkAction(event.target.value as BulkCommentAction)
						}
					>
						<option value="approve">批准</option>
						<option value="pending">设为待审</option>
						<option value="spam">标记为垃圾</option>
						<option value="trash">移入回收站</option>
						<option value="restore">恢复为待审</option>
						<option value="pin">置顶</option>
						<option value="unpin">取消置顶</option>
						<option value="fold">折叠</option>
						<option value="unfold">展开</option>
						<option value="refreshMetadata">刷新 IP 地址信息</option>
						<option value="delete">永久删除</option>
					</select>
					<Button
						type="button"
						size="sm"
						variant={
							bulkAction === "delete" || bulkAction === "trash"
								? "destructive"
								: "outline"
						}
						disabled={
							selectedVisibleIds.length === 0 ||
							bulkUpdateMutation.isPending ||
							bulkRefreshMetadataMutation.isPending ||
							bulkTrashMutation.isPending ||
							deleteMutation.isPending
						}
						onClick={applyBulkAction}
					>
						应用
					</Button>
					{isTrashView ? (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							disabled={clearTrashMutation.isPending}
							onClick={clearCurrentTrash}
						>
							清空回收站
						</Button>
					) : null}
				</div>
				{commentsQuery.data?.items.length ? (
					<CommentsList
						comments={commentsQuery.data.items}
						selectedCommentIds={selectedCommentIds}
						allVisibleSelected={allVisibleSelected}
						activeReplyId={activeReplyId}
						replyDrafts={replyDrafts}
						mutationPending={
							updateMutation.isPending ||
							deleteMutation.isPending ||
							bulkTrashMutation.isPending ||
							bulkUpdateMutation.isPending ||
							bulkRefreshMetadataMutation.isPending ||
							refreshMetadataMutation.isPending ||
							blacklistMutationPending
						}
						onToggleAll={toggleAllVisibleComments}
						onToggleOne={toggleSelectedComment}
						onAction={handleCommentAction}
						onTogglePinned={(comment) =>
							updateMutation.mutate({
								id: comment.id,
								isPinned: !comment.isPinned,
							})
						}
						onToggleFolded={(comment) =>
							updateMutation.mutate({
								id: comment.id,
								isFolded: !comment.isFolded,
							})
						}
						onReplyOpen={setActiveReplyId}
						onReplyCancel={() => setActiveReplyId(null)}
						onReplyDraftChange={(commentId, value) =>
							setReplyDrafts((current) => ({
								...current,
								[commentId]: value,
							}))
						}
						onReplySubmit={(commentId) => {
							const raw = (replyDrafts[commentId] ?? "").trim();
							if (!raw) {
								return;
							}
							replyMutation.mutate({ commentId, raw });
							setActiveReplyId(null);
						}}
						onFilterPage={(nextPageKey) => {
							setPageKey(nextPageKey);
							pagination.resetPage();
						}}
						onRefreshMetadata={(commentId) =>
							refreshMetadataMutation.mutate(commentId)
						}
						onToggleEmailBlacklist={(comment) =>
							toggleCommentBlacklist({
								targetType: "email",
								targetValue: comment.authorEmail ?? "",
								isBlacklisted: comment.blacklist.email,
							})
						}
						onToggleIpBlacklist={(comment) =>
							toggleCommentBlacklist({
								targetType: "ip",
								targetValue: comment.authorIp ?? "",
								isBlacklisted: comment.blacklist.ip,
							})
						}
					/>
				) : (
					<EmptyState text={commentsQuery.isLoading ? "加载中" : "暂无评论"} />
				)}
			</CardContent>
		</Card>
	);
}
