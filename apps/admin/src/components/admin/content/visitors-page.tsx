import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
	createBlacklist,
	deleteBlacklistTarget,
	listVisitors,
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
import { PaginationControls } from "../shared/admin-pagination";
import { EmptyState, Field, inputClass } from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import { ExternalLinkText } from "../shared/external-link-text";
import {
	RawRequestMetaList,
	RequestMetaAggregateBadges,
	RequestMetaSummary,
} from "./request-meta-summary";
import { ResourceFilters, usePaginationState } from "./collection-shared";

export function VisitorsPage({
	siteKey,
}: {
	siteKey?: string;
	openComments: (input: { pageKey?: string; search?: string }) => void;
}) {
	const [search, setSearch] = useState("");
	const [ip, setIp] = useState("");
	const [userAgent, setUserAgent] = useState("");
	const [pageUrl, setPageUrl] = useState("");
	const [device, setDevice] = useState("");
	const [location, setLocation] = useState("");
	const [blacklist, setBlacklist] = useState<
		"" | "any" | "ip" | "visitor" | "none"
	>("");
	const pagination = usePaginationState(20);
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: [
			"admin",
			"visitors",
			siteKey,
			search,
			ip,
			userAgent,
			pageUrl,
			device,
			location,
			blacklist,
			pagination.limit,
			pagination.offset,
		],
		queryFn: () =>
			listVisitors({
				siteKey,
				search,
				ip,
				userAgent,
				pageUrl,
				device,
				location,
				blacklist: blacklist || undefined,
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
				<details className="rounded-md border p-3">
					<summary className="cursor-pointer select-none text-sm font-medium">
						筛选
					</summary>
					<div className="mt-3 grid gap-3 md:grid-cols-3">
						<Field label="IP">
							<Input
								aria-label="IP"
								value={ip}
								onChange={(event) => {
									setIp(event.target.value);
									pagination.resetPage();
								}}
							/>
						</Field>
						<Field label="UA">
							<Input
								aria-label="UA"
								value={userAgent}
								onChange={(event) => {
									setUserAgent(event.target.value);
									pagination.resetPage();
								}}
							/>
						</Field>
						<Field label="完整链接">
							<Input
								aria-label="完整链接"
								value={pageUrl}
								onChange={(event) => {
									setPageUrl(event.target.value);
									pagination.resetPage();
								}}
							/>
						</Field>
						<Field label="设备">
							<Input
								aria-label="设备"
								value={device}
								onChange={(event) => {
									setDevice(event.target.value);
									pagination.resetPage();
								}}
							/>
						</Field>
						<Field label="地域">
							<Input
								aria-label="地域"
								value={location}
								onChange={(event) => {
									setLocation(event.target.value);
									pagination.resetPage();
								}}
							/>
						</Field>
						<Field label="黑名单状态">
							<select
								className={inputClass}
								value={blacklist}
								onChange={(event) => {
									setBlacklist(event.target.value as typeof blacklist);
									pagination.resetPage();
								}}
								aria-label="黑名单状态"
							>
								<option value="">全部</option>
								<option value="any">任意黑名单</option>
								<option value="ip">IP 黑名单</option>
								<option value="visitor">访客黑名单</option>
								<option value="none">无黑名单</option>
							</select>
						</Field>
					</div>
				</details>
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
							const visitTarget = visitor.lastSeenPageUrl ?? "-";
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
											{visitor.lastSeenPageUrl ? (
												<div className="mt-1 max-w-xl text-xs">
													<ExternalLinkText
														href={visitor.lastSeenPageUrl}
														className="text-xs"
													>
														{visitTarget}
													</ExternalLinkText>
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
											<Badge variant="outline">站点 {visitor.siteKey}</Badge>
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
