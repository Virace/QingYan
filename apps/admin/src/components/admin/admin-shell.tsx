import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BadgeCheckIcon,
	BookOpenIcon,
	FlagIcon,
	GlobeIcon,
	LogOutIcon,
	MessageSquareTextIcon,
	RefreshCwIcon,
	SettingsIcon,
	ShieldIcon,
	UsersIcon,
	type LucideIcon,
} from "lucide-react";

import { fetchAdminMe, logoutAdmin } from "@/api/session";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import {
	BlacklistPage,
	CommentsPage,
	OverviewPage,
	PagesPage,
	RuntimeSettingsPage,
	SitesPage,
	SystemSettingsPage,
	UsersPage,
	VisitorsPage,
} from "./admin-pages";
import { inputClass } from "./admin-ui";

export type AdminView =
	| "overview"
	| "comments"
	| "pages"
	| "users"
	| "visitors"
	| "blacklist"
	| "sites"
	| "settings"
	| "system";

const navItems: Array<{
	id: AdminView;
	label: string;
	icon: LucideIcon;
}> = [
	{ id: "overview", label: "概览", icon: BadgeCheckIcon },
	{ id: "comments", label: "评论", icon: MessageSquareTextIcon },
	{ id: "pages", label: "页面", icon: BookOpenIcon },
	{ id: "users", label: "用户", icon: UsersIcon },
	{ id: "visitors", label: "访客", icon: BadgeCheckIcon },
	{ id: "blacklist", label: "黑名单", icon: ShieldIcon },
	{ id: "sites", label: "站点", icon: GlobeIcon },
	{ id: "settings", label: "运行时设置", icon: FlagIcon },
	{ id: "system", label: "系统设置", icon: SettingsIcon },
];

export function AdminShell({ onLogout }: { onLogout: () => void }) {
	const queryClient = useQueryClient();
	const [view, setView] = useState<AdminView>("overview");
	const [selectedSiteKey, setSelectedSiteKey] = useState("");
	const [commentSearch, setCommentSearch] = useState("");
	const [commentPageKey, setCommentPageKey] = useState("");
	const meQuery = useQuery({
		queryKey: ["admin", "me"],
		queryFn: fetchAdminMe,
	});
	const logoutMutation = useMutation({
		mutationFn: logoutAdmin,
		onSuccess() {
			onLogout();
		},
	});

	useEffect(() => {
		if (!selectedSiteKey && meQuery.data?.sites[0]?.siteKey) {
			setSelectedSiteKey(meQuery.data.sites[0].siteKey);
		}
	}, [meQuery.data, selectedSiteKey]);

	const activeSite = meQuery.data?.sites.find(
		(site) => site.siteKey === selectedSiteKey,
	);
	const activeSiteKey =
		selectedSiteKey || meQuery.data?.sites[0]?.siteKey || "";
	const openComments = (input: { pageKey?: string; search?: string }) => {
		setCommentPageKey(input.pageKey ?? "");
		setCommentSearch(input.search ?? "");
		setView("comments");
	};
	const openSite = (siteKey: string, nextView: AdminView) => {
		setSelectedSiteKey(siteKey);
		setView(nextView);
	};

	function renderView() {
		switch (view) {
			case "overview":
				return <OverviewPage />;
			case "comments":
				return (
					<CommentsPage
						siteKey={activeSiteKey}
						search={commentSearch}
						setSearch={setCommentSearch}
						pageKey={commentPageKey}
						setPageKey={setCommentPageKey}
					/>
				);
			case "pages":
				return (
					<PagesPage siteKey={activeSiteKey} openComments={openComments} />
				);
			case "users":
				return (
					<UsersPage siteKey={activeSiteKey} openComments={openComments} />
				);
			case "visitors":
				return (
					<VisitorsPage siteKey={activeSiteKey} openComments={openComments} />
				);
			case "blacklist":
				return <BlacklistPage siteKey={activeSiteKey} />;
			case "sites":
				return <SitesPage openSite={openSite} />;
			case "settings":
				return <RuntimeSettingsPage siteKey={activeSiteKey} />;
			case "system":
				return <SystemSettingsPage />;
		}
	}

	return (
		<div className="flex min-h-dvh bg-muted/30">
			<aside className="hidden w-64 shrink-0 border-r bg-background md:flex md:flex-col">
				<div className="flex h-16 items-center px-5">
					<div>
						<p className="text-sm font-semibold">QingYan</p>
						<p className="text-xs text-muted-foreground">Admin Console</p>
					</div>
				</div>
				<Separator />
				<nav className="flex flex-1 flex-col gap-1 p-3">
					{navItems.map((item) => {
						const Icon = item.icon;
						return (
							<Button
								key={item.id}
								type="button"
								variant={view === item.id ? "secondary" : "ghost"}
								className="justify-start"
								onClick={() => setView(item.id)}
							>
								<Icon data-icon="inline-start" />
								{item.label}
							</Button>
						);
					})}
				</nav>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
					<div className="min-w-0">
						<h1 className="truncate text-base font-semibold">
							{navItems.find((item) => item.id === view)?.label ?? "管理台"}
						</h1>
						<p className="truncate text-sm text-muted-foreground">
							{activeSite
								? `${activeSite.name} / ${activeSite.siteKey}`
								: "未选择站点"}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<select
							className={`${inputClass} md:hidden`}
							value={view}
							onChange={(event) => setView(event.target.value as AdminView)}
							aria-label="管理模块"
						>
							{navItems.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
						<select
							className={inputClass}
							value={activeSiteKey}
							onChange={(event) => setSelectedSiteKey(event.target.value)}
						>
							{meQuery.data?.sites.map((site) => (
								<option key={site.siteKey} value={site.siteKey}>
									{site.name}
								</option>
							))}
						</select>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={() => queryClient.invalidateQueries()}
							aria-label="刷新"
						>
							<RefreshCwIcon data-icon="inline-start" />
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => logoutMutation.mutate()}
							disabled={logoutMutation.isPending}
						>
							<LogOutIcon data-icon="inline-start" />
							退出
						</Button>
					</div>
				</header>
				<section className="flex flex-1 flex-col gap-4 p-4 md:p-6">
					{renderView()}
				</section>
			</main>
		</div>
	);
}
