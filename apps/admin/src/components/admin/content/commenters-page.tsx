import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
	createBlacklist,
	deleteBlacklistTarget,
	listCommenters,
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
import { PaginationControls } from "../shared/admin-pagination";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	RawRequestMetaList,
	RequestMetaAggregateBadges,
} from "./request-meta-summary";
import { summarizeCommenterNotifications } from "./notification-ui-model";
import { ResourceFilters, usePaginationState } from "./collection-shared";

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
							{query.data?.items.map((commenter) => {
								const notificationView =
									summarizeCommenterNotifications(commenter);
								return (
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
											<div className="flex flex-col gap-2">
												<div className="flex flex-wrap gap-2">
													{commenter.blacklist.email ? (
														<Badge variant="destructive">黑名单</Badge>
													) : (
														<Badge variant="secondary">正常</Badge>
													)}
													{notificationView.badges.map((badge) => (
														<Badge
															key={badge}
															variant={
																notificationView.state === "api_missing"
																	? "outline"
																	: "secondary"
															}
														>
															{badge}
														</Badge>
													))}
												</div>
												<div className="grid gap-1 text-xs text-muted-foreground">
													{notificationView.details.map((detail) => (
														<p key={detail}>{detail}</p>
													))}
												</div>
											</div>
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
														commenter.blacklist.email
															? "destructive"
															: "outline"
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
								);
							})}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}
