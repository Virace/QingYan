import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	deleteComment,
	listComments,
	listPages,
	listSites,
	listUsers,
	listVisitors,
	updateComment,
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
import { EmptyState, inputClass } from "./admin-ui";

function ResourceFilters({
	search,
	setSearch,
	status,
	setStatus,
	pageKey,
	setPageKey,
	limit,
	setLimit,
}: {
	search: string;
	setSearch: (value: string) => void;
	status?: string;
	setStatus?: (value: string) => void;
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
			{setStatus ? (
				<select
					className={inputClass}
					value={status ?? ""}
					onChange={(event) => setStatus(event.target.value)}
				>
					<option value="">全部状态</option>
					<option value="pending">待审</option>
					<option value="approved">已通过</option>
				</select>
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
	const [status, setStatus] = useState("");
	const [limit, setLimit] = useState(20);
	const commentsQuery = useQuery({
		queryKey: ["admin", "comments", siteKey, search, pageKey, status, limit],
		queryFn: () =>
			listComments({
				siteKey,
				pageKey,
				search,
				status: status || undefined,
				limit,
				offset: 0,
			}),
	});
	const updateMutation = useMutation({
		mutationFn: (input: {
			id: string;
			status?: "pending" | "approved";
			isPinned?: boolean;
			isFolded?: boolean;
		}) => updateComment(input.id, input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteComment,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">评论</CardTitle>
				<CardDescription>审核、置顶、折叠或删除评论。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters
					search={search}
					setSearch={setSearch}
					status={status}
					setStatus={setStatus}
					pageKey={pageKey}
					setPageKey={setPageKey}
					limit={limit}
					setLimit={setLimit}
				/>
				<p className="text-xs text-muted-foreground">
					共 {commentsQuery.data?.pagination.totalCount ?? "-"} 条，当前显示{" "}
					{commentsQuery.data?.items.length ?? 0} 条。
				</p>
				{commentsQuery.data?.items.length ? (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-left text-sm">
							<thead className="bg-muted/60">
								<tr>
									<th className="p-3">状态</th>
									<th className="p-3">作者</th>
									<th className="p-3">页面</th>
									<th className="p-3">内容</th>
									<th className="p-3">操作</th>
								</tr>
							</thead>
							<tbody>
								{commentsQuery.data.items.map((comment) => (
									<tr key={comment.id} className="border-t">
										<td className="p-3">
											<Badge
												variant={
													comment.status === "approved"
														? "secondary"
														: "outline"
												}
											>
												{comment.status === "approved" ? "已通过" : "待审"}
											</Badge>
										</td>
										<td className="p-3">
											<p className="font-medium">{comment.authorName}</p>
											<p className="text-xs text-muted-foreground">
												{comment.authorEmail ?? "-"}
											</p>
										</td>
										<td className="max-w-56 p-3">
											<p className="truncate">{comment.pageTitle ?? "-"}</p>
											<p className="truncate text-xs text-muted-foreground">
												{comment.pageKey}
											</p>
										</td>
										<td className="max-w-80 p-3">
											<p className="line-clamp-2">{comment.contentRaw}</p>
											<p className="text-xs text-muted-foreground">
												赞 {comment.voteUpCount} / 回复 {comment.replyCount}
											</p>
										</td>
										<td className="p-3">
											<div className="flex flex-wrap gap-2">
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															status:
																comment.status === "approved"
																	? "pending"
																	: "approved",
														})
													}
												>
													{comment.status === "approved" ? "待审" : "通过"}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															isPinned: !comment.isPinned,
														})
													}
												>
													{comment.isPinned ? "取消置顶" : "置顶"}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() =>
														updateMutation.mutate({
															id: comment.id,
															isFolded: !comment.isFolded,
														})
													}
												>
													{comment.isFolded ? "展开" : "折叠"}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="destructive"
													onClick={() => deleteMutation.mutate(comment.id)}
												>
													删除
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
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
	const query = useQuery({
		queryKey: ["admin", "pages", siteKey, search],
		queryFn: () => listPages({ siteKey, search, limit: 50, offset: 0 }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">页面</CardTitle>
				<CardDescription>页面级评论、访客和点赞聚合。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
				<div className="grid gap-3">
					{query.data?.items.map((page) => (
						<div key={page.pageKey} className="rounded-md border p-4">
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="font-medium">
										{page.pageTitle ?? page.pageKey}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{page.pageUrl ?? page.pageKey}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">评论 {page.commentCount}</Badge>
									<Badge variant="outline">访客 {page.visitorCount}</Badge>
									<Badge variant="outline">用户 {page.userCount}</Badge>
									<Badge variant="outline">点赞 {page.pageLikeCount}</Badge>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ pageKey: page.pageKey })}
									>
										查看评论
									</Button>
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

export function UsersPage({
	siteKey,
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const query = useQuery({
		queryKey: ["admin", "users", siteKey, search],
		queryFn: () => listUsers({ siteKey, search, limit: 50, offset: 0 }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">用户</CardTitle>
				<CardDescription>按邮箱聚合评论用户。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
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
							{query.data?.items.map((user) => (
								<tr key={user.email} className="border-t">
									<td className="p-3">{user.email}</td>
									<td className="p-3">{user.names.join(", ")}</td>
									<td className="p-3">
										{user.commentCount}，待审 {user.pendingCount}
									</td>
									<td className="p-3">{user.pageCount}</td>
									<td className="p-3">
										{user.isBlacklisted ? (
											<Badge variant="destructive">黑名单</Badge>
										) : (
											<Badge variant="secondary">正常</Badge>
										)}
									</td>
									<td className="p-3">
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => openComments({ search: user.email })}
										>
											查看评论
										</Button>
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
	openComments,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const query = useQuery({
		queryKey: ["admin", "visitors", siteKey, search],
		queryFn: () => listVisitors({ siteKey, search, limit: 50, offset: 0 }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">访客</CardTitle>
				<CardDescription>按 visitorKey 聚合访问与评论行为。</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ResourceFilters search={search} setSearch={setSearch} />
				<div className="grid gap-3">
					{query.data?.items.map((visitor) => (
						<div key={visitor.visitorKey} className="rounded-md border p-4">
							<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0">
									<p className="truncate font-medium">{visitor.visitorKey}</p>
									<p className="text-xs text-muted-foreground">
										{visitor.emails.join(", ") || "无邮箱"}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge variant="secondary">评论 {visitor.commentCount}</Badge>
									<Badge variant="outline">页面 {visitor.pageCount}</Badge>
									{visitor.blacklist.visitor ? (
										<Badge variant="destructive">黑名单</Badge>
									) : null}
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => openComments({ search: visitor.visitorKey })}
									>
										查看评论
									</Button>
								</div>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
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
	const query = useQuery({
		queryKey: ["admin", "sites"],
		queryFn: listSites,
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">站点</CardTitle>
				<CardDescription>配置站点和运行时摘要。</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 md:grid-cols-2">
				{query.data?.items.map((site) => (
					<div key={site.siteKey} className="rounded-md border p-4">
						<p className="font-medium">{site.name}</p>
						<p className="text-xs text-muted-foreground">{site.siteKey}</p>
						<div className="mt-3 flex flex-wrap gap-2">
							<Badge variant="secondary">页面 {site.pageCount}</Badge>
							<Badge variant="outline">评论 {site.commentCount}</Badge>
							<Badge variant="outline">用户 {site.userCount}</Badge>
							<Badge variant="outline">访客 {site.visitorCount}</Badge>
						</div>
						<p className="mt-3 text-xs text-muted-foreground">
							{site.allowedOrigins.join(", ")}
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => openSite(site.siteKey, "settings")}
							>
								运行时设置
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
								onClick={() => openSite(site.siteKey, "users")}
							>
								用户
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
				))}
			</CardContent>
		</Card>
	);
}
