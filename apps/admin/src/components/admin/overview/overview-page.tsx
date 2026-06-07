import { useQuery } from "@tanstack/react-query";

import { fetchAdminOverview } from "@/api/overview";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { EmptyState } from "../shared/admin-ui";

export function OverviewPage() {
	const overviewQuery = useQuery({
		queryKey: ["admin", "overview"],
		queryFn: fetchAdminOverview,
	});

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">后台概览</CardTitle>
					<CardDescription>管理端运行状态和全局资源统计。</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{overviewQuery.data
						? [
								["站点", overviewQuery.data.stats.siteCount],
								["页面", overviewQuery.data.stats.pageCount],
								["评论", overviewQuery.data.stats.commentCount],
								["待审", overviewQuery.data.stats.pendingCommentCount],
								["评论者", overviewQuery.data.stats.commenterCount],
								["访客", overviewQuery.data.stats.visitorCount],
								["黑名单", overviewQuery.data.stats.blacklistRuleCount],
								["日志", overviewQuery.data.logging.level.toUpperCase()],
							].map(([label, value]) => (
								<div key={label} className="rounded-md border p-3">
									<p className="text-xs text-muted-foreground">{label}</p>
									<p className="mt-1 text-2xl font-semibold">{value}</p>
								</div>
							))
						: null}
					{overviewQuery.isLoading ? <EmptyState text="加载中" /> : null}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">运行状态</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3 md:grid-cols-3">
					<div className="rounded-md border p-3">
						<p className="text-xs text-muted-foreground">后台入口</p>
						<p className="mt-1 text-sm font-medium">
							{overviewQuery.data?.console.path ?? "-"}
						</p>
					</div>
					<div className="rounded-md border p-3">
						<p className="text-xs text-muted-foreground">开发模式</p>
						<p className="mt-1 text-sm font-medium">
							{overviewQuery.data?.runtime.devMode ? "已启用" : "未启用"}
						</p>
					</div>
					<div className="rounded-md border p-3">
						<p className="text-xs text-muted-foreground">日志保留</p>
						<p className="mt-1 text-sm font-medium">
							{overviewQuery.data?.logging.retentionDays ?? "-"} 天
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
