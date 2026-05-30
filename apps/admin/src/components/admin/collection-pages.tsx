import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
	type AdminComment,
	type AdminPage,
	type AdminPageSortBy,
	type AdminPageSortOrder,
	approvePendingPage,
	bulkTrashComments,
	bulkUpdateComments,
	type CommentStatus,
	clearTrash,
	createBlacklist,
	createSite,
	deleteBlacklistTarget,
	deleteComment,
	deletePage,
	ignorePendingPage,
	listCommenters,
	listComments,
	listPages,
	listPendingPages,
	listSites,
	listVisitors,
	type PageRegistryStatus,
	refreshCommentMetadata,
	refreshPageTitle,
	refreshSelectedCommentMetadata,
	rejectPendingPage,
	replyToComment,
	restorePage,
	trashPage,
	updateComment,
	updateSite,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import type { AdminView } from "./admin-shell";
import { PaginationControls } from "./admin-pagination";
import { EmptyState, inputClass } from "./admin-ui";
import type { CommentActionId } from "./comment-actions";
import { CommentsList } from "./comments-list";
import { useAdminConfirmDialog } from "./confirm-dialog";
import { ExternalLinkText } from "./external-link-text";
import {
	RawRequestMetaList,
	RequestMetaAggregateBadges,
	RequestMetaSummary,
} from "./request-meta-summary";

type PageStatusFilter = "all" | PageRegistryStatus;

const pageStatusOptions: Array<{ value: PageStatusFilter; label: string }> = [
	{ value: "all", label: "全部" },
	{ value: "active", label: "正常" },
	{ value: "trash", label: "回收站" },
	{ value: "deleted", label: "已删除" },
	{ value: "ignored", label: "已忽略" },
	{ value: "stale", label: "待同步" },
	{ value: "unreachable", label: "不可达" },
	{ value: "not_found", label: "404" },
];

function pageStatusLabel(status: PageRegistryStatus) {
	const labels: Record<PageRegistryStatus, string> = {
		active: "正常",
		stale: "待同步",
		unreachable: "不可达",
		not_found: "404",
		trash: "回收站",
		deleted: "已删除",
		ignored: "已忽略",
	};
	return labels[status];
}

const pageSortOptions: Array<{ value: AdminPageSortBy; label: string }> = [
	{ value: "updatedAt", label: "最近更新" },
	{ value: "createdAt", label: "创建时间" },
	{ value: "commentCount", label: "评论数" },
	{ value: "visitorCount", label: "访客数" },
	{ value: "commenterCount", label: "评论者数" },
	{ value: "pageLikeCount", label: "点赞数" },
	{ value: "title", label: "标题" },
	{ value: "pageKey", label: "页面键" },
];

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

type PaginationState = {
	limit: number;
	offset: number;
	pageIndex: number;
	setLimit: (limit: number) => void;
	setPageIndex: (pageIndex: number) => void;
	resetPage: () => void;
};

function usePaginationState(defaultLimit = 20): PaginationState {
	const [limit, setLimitState] = useState(defaultLimit);
	const [pageIndex, setPageIndexState] = useState(0);
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndexState(0);
	};
	const setPageIndex = (nextPageIndex: number) => {
		setPageIndexState(Math.max(0, nextPageIndex));
	};

	return {
		limit,
		offset: pageIndex * limit,
		pageIndex,
		setLimit,
		setPageIndex,
		resetPage: () => setPageIndexState(0),
	};
}

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

function ResourceFilters({
	search,
	setSearch,
	pageKey,
	setPageKey,
	limit,
	setLimit,
}: {
	search: string;
	setSearch: (value: string) => void;
	pageKey?: string;
	setPageKey?: (value: string) => void;
	limit?: number;
	setLimit?: (value: number) => void;
}) {
	return (
		<div className="flex flex-col gap-3 md:flex-row">
			<Input
				placeholder="搜索"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
			/>
			{setPageKey ? (
				<Input
					placeholder="页面键"
					value={pageKey ?? ""}
					onChange={(event) => setPageKey(event.target.value)}
				/>
			) : null}
			{setLimit ? (
				<Input
					type="number"
					min={1}
					max={100}
					value={limit ?? 20}
					onChange={(event) => setLimit(Number(event.target.value) || 20)}
				/>
			) : null}
		</div>
	);
}

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

export function PagesPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<PageStatusFilter>("all");
	const [sortBy, setSortBy] = useState<AdminPageSortBy>("updatedAt");
	const [sortOrder, setSortOrder] = useState<AdminPageSortOrder>("desc");
	const pagePagination = usePaginationState(20);
	const pendingPagePagination = usePaginationState(20);
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: [
			"admin",
			"pages",
			siteKey,
			search,
			status,
			sortBy,
			sortOrder,
			pagePagination.limit,
			pagePagination.offset,
		],
		queryFn: () =>
			listPages({
				siteKey,
				search,
				status: status === "all" ? undefined : status,
				sortBy,
				sortOrder,
				limit: pagePagination.limit,
				offset: pagePagination.offset,
			}),
	});
	const pendingQuery = useQuery({
		queryKey: [
			"admin",
			"page-registry",
			"pending",
			siteKey,
			search,
			pendingPagePagination.limit,
			pendingPagePagination.offset,
		],
		queryFn: () =>
			listPendingPages({
				siteKey,
				search,
				status: "pending",
				limit: pendingPagePagination.limit,
				offset: pendingPagePagination.offset,
			}),
	});
	const invalidatePages = () => {
		void queryClient.invalidateQueries({ queryKey: ["admin", "pages"] });
		void queryClient.invalidateQueries({
			queryKey: ["admin", "page-registry", "pending"],
		});
	};
	const trashMutation = useMutation({
		mutationFn: trashPage,
		onSuccess: invalidatePages,
	});
	const restoreMutation = useMutation({
		mutationFn: restorePage,
		onSuccess: invalidatePages,
	});
	const deleteMutation = useMutation({
		mutationFn: deletePage,
		onSuccess: invalidatePages,
	});
	const refreshTitleMutation = useMutation({
		mutationFn: refreshPageTitle,
		onSuccess: invalidatePages,
	});
	const approveMutation = useMutation({
		mutationFn: approvePendingPage,
		onSuccess: invalidatePages,
	});
	const rejectMutation = useMutation({
		mutationFn: rejectPendingPage,
		onSuccess: invalidatePages,
	});
	const ignoreMutation = useMutation({
		mutationFn: ignorePendingPage,
		onSuccess: invalidatePages,
	});
	const lifecyclePending =
		trashMutation.isPending ||
		restoreMutation.isPending ||
		deleteMutation.isPending ||
		approveMutation.isPending ||
		rejectMutation.isPending ||
		ignoreMutation.isPending;
	const mutatePage = async (
		page: AdminPage,
		action: "trash" | "restore" | "delete",
	) => {
		const input = { siteKey: page.siteKey, pageKey: page.pageKey };
		if (action === "trash") {
			const confirmed = await confirm({
				title: "移入回收站",
				description:
					"页面将进入回收站，公开评论、点赞和访问统计入口会被排除。该操作可恢复，但仍会影响站点交互。",
				confirmText: "移入回收站",
				destructive: true,
			});
			if (!confirmed) {
				return;
			}
			trashMutation.mutate(input);
			return;
		}
		if (action === "restore") {
			restoreMutation.mutate(input);
			return;
		}
		const confirmed = await confirm({
			title: "标记删除",
			description:
				"页面将标记为删除状态，公开交互入口会被排除。恢复路径取决于后续后台能力，请谨慎操作。",
			confirmText: "标记删除",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(input);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">页面</CardTitle>
				<CardDescription>
					页面级评论、访客、点赞聚合与页面状态治理。
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={(value) => {
						setSearch(value);
						pagePagination.resetPage();
						pendingPagePagination.resetPage();
					}}
				/>
				<label className="grid gap-1 text-sm md:max-w-xs">
					<span className="text-muted-foreground">页面状态</span>
					<select
						className={inputClass}
						value={status}
						onChange={(event) => {
							setStatus(event.target.value as PageStatusFilter);
							pagePagination.resetPage();
						}}
					>
						{pageStatusOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<div className="flex flex-col gap-3 md:flex-row">
					<label className="grid gap-1 text-sm md:w-56">
						<span className="text-muted-foreground">排序字段</span>
						<select
							className={inputClass}
							value={sortBy}
							onChange={(event) => {
								setSortBy(event.target.value as AdminPageSortBy);
								pagePagination.resetPage();
							}}
						>
							{pageSortOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1 text-sm md:w-36">
						<span className="text-muted-foreground">排序方向</span>
						<select
							className={inputClass}
							value={sortOrder}
							onChange={(event) => {
								setSortOrder(event.target.value as AdminPageSortOrder);
								pagePagination.resetPage();
							}}
						>
							<option value="desc">降序</option>
							<option value="asc">升序</option>
						</select>
					</label>
				</div>
				<div className="grid gap-3 rounded-md border p-4">
					<div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
						<div>
							<h3 className="font-medium">待处理未知页面</h3>
							<p className="text-xs text-muted-foreground">
								来自公开访问但尚未登记的页面。
							</p>
						</div>
						<Badge variant="outline">
							{pendingQuery.data?.pagination.totalCount ?? 0}
						</Badge>
					</div>
					<PaginationControls
						limit={pendingPagePagination.limit}
						pageIndex={pendingPagePagination.pageIndex}
						totalCount={pendingQuery.data?.pagination.totalCount ?? 0}
						itemCount={pendingQuery.data?.items.length ?? 0}
						setLimit={pendingPagePagination.setLimit}
						setPageIndex={pendingPagePagination.setPageIndex}
					/>
					{pendingQuery.data?.items.map((candidate) => (
						<div
							key={candidate.pageKey}
							className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-start md:justify-between"
						>
							<div className="min-w-0">
								<p className="truncate font-medium">{candidate.pageKey}</p>
								<ExternalLinkText href={candidate.pageUrl} className="text-xs">
									{candidate.pageUrl}
								</ExternalLinkText>
								<p className="text-xs text-muted-foreground">
									访问 {candidate.hitCount} / 最近 {candidate.lastSeenAt}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										approveMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
										})
									}
								>
									放行
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										rejectMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
											reason: "admin_rejected",
										})
									}
								>
									拒绝
								</Button>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={lifecyclePending}
									onClick={() =>
										ignoreMutation.mutate({
											siteKey: candidate.siteKey,
											pageKey: candidate.pageKey,
											reason: "admin_ignored",
										})
									}
								>
									忽略
								</Button>
							</div>
						</div>
					))}
					{pendingQuery.data?.items.length === 0 ? (
						<EmptyState text="暂无待处理页面" />
					) : null}
				</div>
				<div className="grid gap-3">
					<PaginationControls
						limit={pagePagination.limit}
						pageIndex={pagePagination.pageIndex}
						totalCount={query.data?.pagination.totalCount ?? 0}
						itemCount={query.data?.items.length ?? 0}
						setLimit={pagePagination.setLimit}
						setPageIndex={pagePagination.setPageIndex}
					/>
					{query.data?.items.map((page) => (
						<div
							key={page.pageKey}
							className={`rounded-md border p-4 ${
								page.status === "stale" ||
								page.status === "unreachable" ||
								page.status === "not_found"
									? "border-amber-300 bg-amber-50"
									: ""
							}`}
						>
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="font-medium">
										{page.pageTitle ?? page.pageKey}
									</p>
									<ExternalLinkText href={page.pageUrl} className="text-xs">
										{page.pageUrl ?? page.pageKey}
									</ExternalLinkText>
									{page.titleRefreshError ? (
										<p className="mt-1 text-xs text-amber-700">
											Title 刷新错误：{page.titleRefreshError}
											{page.titleRefreshStatusCode
												? ` / HTTP ${page.titleRefreshStatusCode}`
												: ""}
										</p>
									) : null}
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">
										{pageStatusLabel(page.status)}
									</Badge>
									<Badge variant="secondary">评论 {page.commentCount}</Badge>
									<Badge variant="outline">访客 {page.visitorCount}</Badge>
									<Badge variant="outline">评论者 {page.commenterCount}</Badge>
									<Badge variant="outline">点赞 {page.pageLikeCount}</Badge>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ pageKey: page.pageKey })}
									>
										查看评论
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										title="为当前页面创建维护任务，执行状态可在任务中心查看。"
										disabled={!siteKey || refreshTitleMutation.isPending}
										onClick={() => {
											if (!siteKey) {
												return;
											}
											refreshTitleMutation.mutate({
												siteKey,
												pageKey: page.pageKey,
											});
										}}
									>
										创建 Title 任务
									</Button>
									{page.status === "active" || page.status === "stale" ? (
										<Button
											type="button"
											size="sm"
											variant="destructive"
											disabled={lifecyclePending}
											onClick={() => void mutatePage(page, "trash")}
										>
											移入回收站
										</Button>
									) : null}
									{page.status === "trash" ? (
										<>
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={lifecyclePending}
												onClick={() => mutatePage(page, "restore")}
											>
												恢复
											</Button>
											<Button
												type="button"
												size="sm"
												variant="destructive"
												disabled={lifecyclePending}
												onClick={() => void mutatePage(page, "delete")}
											>
												标记删除
											</Button>
										</>
									) : null}
								</div>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
						<EmptyState text="暂无页面" />
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

export function CommentersPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const pagination = usePaginationState(20);
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: [
			"admin",
			"commenters",
			siteKey,
			search,
			pagination.limit,
			pagination.offset,
		],
		queryFn: () =>
			listCommenters({
				siteKey,
				search,
				limit: pagination.limit,
				offset: pagination.offset,
			}),
	});
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleCommenterBlacklist = (input: {
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			void (async () => {
				const confirmed = await confirm({
					title: "解除邮箱黑名单",
					description:
						"确认删除这条邮箱黑名单规则？删除后该邮箱会恢复评论能力。",
					confirmText: "解除黑名单",
					destructive: true,
				});
				if (!confirmed) {
					return;
				}
				deleteBlacklistMutation.mutate({
					siteKey,
					targetType: "email",
					matchMode: "exact",
					targetValue: input.targetValue,
				});
			})();
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: "email",
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">评论者</CardTitle>
				<CardDescription>按评论邮箱聚合匿名评论者。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={(value) => {
						setSearch(value);
						pagination.resetPage();
					}}
				/>
				<PaginationControls
					limit={pagination.limit}
					pageIndex={pagination.pageIndex}
					totalCount={query.data?.pagination.totalCount ?? 0}
					itemCount={query.data?.items.length ?? 0}
					setLimit={pagination.setLimit}
					setPageIndex={pagination.setPageIndex}
				/>
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted/60">
							<tr>
								<th className="p-3">邮箱</th>
								<th className="p-3">昵称</th>
								<th className="p-3">评论</th>
								<th className="p-3">页面</th>
								<th className="p-3">状态</th>
								<th className="p-3">操作</th>
							</tr>
						</thead>
						<tbody>
							{query.data?.items.map((commenter) => (
								<tr key={commenter.email} className="border-t">
									<td className="p-3">{commenter.email}</td>
									<td className="p-3">
										<p>{commenter.names.join(", ")}</p>
										<div className="mt-1 grid gap-1">
											<RequestMetaAggregateBadges
												items={commenter.ipLocations}
												emptyText="地区 -"
												showDistinctIpCount
											/>
											<RequestMetaAggregateBadges
												items={commenter.devices}
												emptyText="设备 -"
											/>
											<RawRequestMetaList
												ips={commenter.ips}
												userAgents={commenter.userAgents}
											/>
										</div>
									</td>
									<td className="p-3">
										{commenter.commentCount}，待审 {commenter.pendingCount}
									</td>
									<td className="p-3">{commenter.pageCount}</td>
									<td className="p-3">
										{commenter.blacklist.email ? (
											<Badge variant="destructive">黑名单</Badge>
										) : (
											<Badge variant="secondary">正常</Badge>
										)}
									</td>
									<td className="p-3">
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													openComments({ search: commenter.email })
												}
											>
												查看评论
											</Button>
											<Button
												type="button"
												size="sm"
												variant={
													commenter.blacklist.email ? "destructive" : "outline"
												}
												disabled={
													createBlacklistMutation.isPending ||
													deleteBlacklistMutation.isPending
												}
												onClick={() =>
													toggleCommenterBlacklist({
														targetValue: commenter.email,
														isBlacklisted: commenter.blacklist.email,
													})
												}
											>
												{commenter.blacklist.email ? "解除邮箱" : "拉黑邮箱"}
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}

export function VisitorsPage({
	siteKey,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const pagination = usePaginationState(20);
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: [
			"admin",
			"visitors",
			siteKey,
			search,
			pagination.limit,
			pagination.offset,
		],
		queryFn: () =>
			listVisitors({
				siteKey,
				search,
				limit: pagination.limit,
				offset: pagination.offset,
			}),
	});
	const visitorsDisabledMessage =
		query.data?.enabled === false
			? (query.data.message ??
				"访客记录未启用。QingYan 当前不记录访客身份，也不提供访客画像。")
			: null;
	const createBlacklistMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteBlacklistMutation = useMutation({
		mutationFn: deleteBlacklistTarget,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const toggleIpBlacklist = (input: {
		targetValue: string;
		isBlacklisted: boolean;
	}) => {
		if (input.isBlacklisted) {
			void (async () => {
				const confirmed = await confirm({
					title: "解除 IP 黑名单",
					description:
						"确认删除这条 IP 黑名单规则？删除后该 IP 会恢复评论或访问能力。",
					confirmText: "解除黑名单",
					destructive: true,
				});
				if (!confirmed) {
					return;
				}
				deleteBlacklistMutation.mutate({
					siteKey,
					targetType: "ip",
					matchMode: "exact",
					targetValue: input.targetValue,
				});
			})();
			return;
		}

		createBlacklistMutation.mutate({
			siteKey,
			targetType: "ip",
			matchMode: "exact",
			targetValue: input.targetValue,
			scope: "post",
			reason: "admin_quick_action",
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">访客</CardTitle>
				<CardDescription>按 visitorKey 聚合访问与评论行为。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={(value) => {
						setSearch(value);
						pagination.resetPage();
					}}
				/>
				{visitorsDisabledMessage ? (
					<EmptyState text={visitorsDisabledMessage} />
				) : null}
				<PaginationControls
					limit={pagination.limit}
					pageIndex={pagination.pageIndex}
					totalCount={query.data?.pagination.totalCount ?? 0}
					itemCount={query.data?.items.length ?? 0}
					setLimit={pagination.setLimit}
					setPageIndex={pagination.setPageIndex}
				/>
				<div className="grid gap-3">
					{query.data?.enabled !== false &&
						query.data?.items.map((visitor) => {
							const visitTarget =
								visitor.lastSeenPageUrl ?? visitor.lastSeenPageKey ?? "-";
							const showPageKey =
								visitor.lastSeenPageKey &&
								visitor.lastSeenPageKey !== visitor.lastSeenPageUrl;
							const hasHistory =
								(visitor.ipLocations?.length ?? 0) > 1 ||
								(visitor.devices?.length ?? 0) > 1 ||
								visitor.ips.length > 1 ||
								visitor.userAgents.length > 1;

							return (
								<div key={visitor.visitorKey} className="rounded-md border p-4">
									<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
										<div className="min-w-0">
											<p className="truncate font-medium">
												{visitor.visitorKey}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												IP {visitor.lastIp ?? "-"}
											</p>
											{visitor.lastSeenPageKey || visitor.lastSeenPageUrl ? (
												<div className="mt-1 max-w-xl text-xs">
													<ExternalLinkText
														href={visitor.lastSeenPageUrl}
														className="text-xs"
													>
														{visitTarget}
													</ExternalLinkText>
													{showPageKey ? (
														<p className="truncate text-muted-foreground">
															PageKey {visitor.lastSeenPageKey}
														</p>
													) : null}
												</div>
											) : null}
											<RequestMetaSummary
												meta={visitor.lastRequestMeta}
												fallbackIp={visitor.lastIp}
												fallbackUserAgent={visitor.lastUserAgent}
												className="mt-1 max-w-xl"
											/>
											{hasHistory ? (
												<details className="mt-2 text-xs text-muted-foreground">
													<summary className="cursor-pointer select-none">
														历史摘要
													</summary>
													<div className="mt-2 grid gap-2">
														<RequestMetaAggregateBadges
															items={visitor.ipLocations}
															emptyText="地区 -"
															showDistinctIpCount
														/>
														<RequestMetaAggregateBadges
															items={visitor.devices}
															emptyText="设备 -"
														/>
														<RawRequestMetaList
															ips={visitor.ips}
															userAgents={visitor.userAgents}
															fallbackIp={visitor.lastIp}
															fallbackUserAgent={visitor.lastUserAgent}
														/>
													</div>
												</details>
											) : null}
										</div>
										<div className="flex flex-wrap gap-2">
											<Badge variant="secondary">
												评论 {visitor.commentCount}
											</Badge>
											<Badge variant="outline">页面 {visitor.pageCount}</Badge>
											{visitor.blacklist.ip ? (
												<Badge variant="destructive">IP 黑名单</Badge>
											) : null}
											{visitor.lastIp ? (
												<Button
													type="button"
													size="sm"
													variant={
														visitor.blacklist.ip ? "destructive" : "outline"
													}
													disabled={
														createBlacklistMutation.isPending ||
														deleteBlacklistMutation.isPending
													}
													onClick={() =>
														toggleIpBlacklist({
															targetValue: visitor.lastIp ?? "",
															isBlacklisted: visitor.blacklist.ip,
														})
													}
												>
													{visitor.blacklist.ip ? "解除 IP" : "拉黑 IP"}
												</Button>
											) : null}
										</div>
									</div>
								</div>
							);
						})}
					{query.data?.enabled !== false && query.data?.items.length === 0 ? (
						<EmptyState text="暂无访客" />
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

export function SitesPage({
	openSite,
}: {
	openSite: (siteKey: string, view: AdminView) => void;
}) {
	const queryClient = useQueryClient();
	const [siteKey, setSiteKey] = useState("");
	const [name, setName] = useState("");
	const [origin, setOrigin] = useState("");
	const query = useQuery({
		queryKey: ["admin", "sites"],
		queryFn: listSites,
	});
	const createMutation = useMutation({
		mutationFn: createSite,
		onSuccess: () => {
			setSiteKey("");
			setName("");
			setOrigin("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			siteKey: string;
			name: string;
			allowedOrigins: string[];
		}) =>
			updateSite(input.siteKey, {
				name: input.name,
				allowedOrigins: input.allowedOrigins,
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const allowedOrigin = origin.trim();

	return (
		<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">新增站点</CardTitle>
					<CardDescription>创建站点后可继续配置站点设置。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!siteKey.trim() || !name.trim() || !allowedOrigin) {
								return;
							}
							createMutation.mutate({
								siteKey: siteKey.trim(),
								name: name.trim(),
								allowedOrigins: [allowedOrigin],
							});
						}}
					>
						<Input
							placeholder="siteKey"
							value={siteKey}
							onChange={(event) => setSiteKey(event.target.value)}
						/>
						<Input
							placeholder="站点名称"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<Input
							placeholder="前端站点 Origin，例如 https://example.com"
							value={origin}
							onChange={(event) => setOrigin(event.target.value)}
						/>
						<Button type="submit" disabled={createMutation.isPending}>
							创建站点
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">站点</CardTitle>
					<CardDescription>配置站点和站点设置摘要。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-2">
					{query.data?.items.map((site) => {
						const draftOrigin = site.allowedOrigins[0] ?? "";
						return (
							<div key={site.siteKey} className="rounded-md border p-4">
								<p className="font-medium">{site.name}</p>
								<p className="text-xs text-muted-foreground">{site.siteKey}</p>
								<form
									className="mt-3 grid gap-2"
									onSubmit={(event) => {
										event.preventDefault();
										const form = new FormData(event.currentTarget);
										const nextName = String(form.get("name") ?? "").trim();
										const nextOrigin = String(form.get("origin") ?? "").trim();
										if (!nextName || !nextOrigin) {
											return;
										}
										updateMutation.mutate({
											siteKey: site.siteKey,
											name: nextName,
											allowedOrigins: [nextOrigin],
										});
									}}
								>
									<Input name="name" defaultValue={site.name} />
									<Input name="origin" defaultValue={draftOrigin} />
									<Button
										type="submit"
										size="sm"
										variant="outline"
										disabled={updateMutation.isPending}
									>
										保存站点
									</Button>
								</form>
								<div className="mt-3 flex flex-wrap gap-2">
									<Badge variant="secondary">页面 {site.pageCount}</Badge>
									<Badge variant="outline">评论 {site.commentCount}</Badge>
									<Badge variant="outline">评论者 {site.commenterCount}</Badge>
									<Badge variant="outline">访客 {site.visitorCount}</Badge>
								</div>
								<div className="mt-3 text-xs">
									<ExternalLinkText href={draftOrigin}>
										{draftOrigin || "-"}
									</ExternalLinkText>
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "settings")}
									>
										站点设置
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "pages")}
									>
										页面
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "commenters")}
									>
										评论者
									</Button>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openSite(site.siteKey, "visitors")}
									>
										访客
									</Button>
								</div>
							</div>
						);
					})}
				</CardContent>
			</Card>
		</div>
	);
}
