import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useState,
	type ComponentType,
	type Dispatch,
	type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BadgeCheckIcon,
	BookOpenIcon,
	DatabaseIcon,
	FlagIcon,
	GlobeIcon,
	LogOutIcon,
	MessageSquareTextIcon,
	RefreshCwIcon,
	SettingsIcon,
	ShieldIcon,
	ListChecksIcon,
	TerminalSquareIcon,
	UsersIcon,
	UserCogIcon,
	UserRoundIcon,
	type LucideIcon,
} from "lucide-react";

import {
	fetchAdminMe,
	logoutAdmin,
	type AdminSiteSummary,
} from "@/api/session";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { EmptyState, inputClass } from "../shared/admin-ui";

function lazyAdminPage<TProps extends object, TExportName extends string>(
	loader: () => Promise<Record<TExportName, ComponentType<TProps>>>,
	exportName: TExportName,
) {
	return lazy(async () => {
		const module = await loader();
		return { default: module[exportName] };
	});
}

type OpenCommentsInput = { pageKey?: string; search?: string };
type OpenComments = (input: OpenCommentsInput) => void;
type OpenSite = (siteKey: string, nextView: AdminView) => void;

type CommentsPageProps = {
	siteKey?: string;
	search: string;
	setSearch: Dispatch<SetStateAction<string>>;
	pageKey: string;
	setPageKey: Dispatch<SetStateAction<string>>;
};

const OverviewPage = lazyAdminPage<object, "OverviewPage">(
	() => import("../overview/overview-page"),
	"OverviewPage",
);
const CommentsPage = lazyAdminPage<CommentsPageProps, "CommentsPage">(
	() => import("../content/comments-page"),
	"CommentsPage",
);
const PagesPage = lazyAdminPage<
	{ siteKey?: string; openComments: OpenComments },
	"PagesPage"
>(() => import("../content/pages-page"), "PagesPage");
const CommentersPage = lazyAdminPage<
	{ siteKey?: string; openComments: OpenComments },
	"CommentersPage"
>(() => import("../content/commenters-page"), "CommentersPage");
const VisitorsPage = lazyAdminPage<
	{ siteKey?: string; openComments: OpenComments },
	"VisitorsPage"
>(() => import("../content/visitors-page"), "VisitorsPage");
const BlacklistPage = lazyAdminPage<{ siteKey?: string }, "BlacklistPage">(
	() => import("../settings/blacklist-page"),
	"BlacklistPage",
);
const SitesPage = lazyAdminPage<{ openSite: OpenSite }, "SitesPage">(
	() => import("../content/sites-page"),
	"SitesPage",
);
const DataPage = lazyAdminPage<{ site: AdminSiteSummary }, "DataPage">(
	() => import("../data/data-page"),
	"DataPage",
);
const TasksPage = lazyAdminPage<{ siteKey: string }, "TasksPage">(
	() => import("../tasks/tasks-page"),
	"TasksPage",
);
const OpsPage = lazyAdminPage<object, "OpsPage">(
	() => import("../ops/ops-page"),
	"OpsPage",
);
const UsersPage = lazyAdminPage<{ isInitialAdmin: boolean }, "UsersPage">(
	() => import("../users/users-page"),
	"UsersPage",
);
const ProfilePage = lazyAdminPage<object, "ProfilePage">(
	() => import("../profile/profile-page"),
	"ProfilePage",
);
const SiteSettingsPage = lazyAdminPage<
	{ siteKey?: string },
	"SiteSettingsPage"
>(() => import("../settings/site-settings-page"), "SiteSettingsPage");
const SystemSettingsPage = lazyAdminPage<
	{ siteKey: string },
	"SystemSettingsPage"
>(() => import("../settings/system-settings-page"), "SystemSettingsPage");

export type AdminView =
	| "overview"
	| "comments"
	| "pages"
	| "commenters"
	| "visitors"
	| "blacklist"
	| "sites"
	| "data"
	| "tasks"
	| "ops"
	| "users"
	| "profile"
	| "settings"
	| "system";

const navItems: Array<{
	id: AdminView;
	label: string;
	icon: LucideIcon;
	permission?: string;
}> = [
	{
		id: "overview",
		label: "概览",
		icon: BadgeCheckIcon,
		permission: "sites.read",
	},
	{
		id: "comments",
		label: "评论",
		icon: MessageSquareTextIcon,
		permission: "comments.read",
	},
	{ id: "pages", label: "页面", icon: BookOpenIcon, permission: "pages.read" },
	{
		id: "commenters",
		label: "评论者",
		icon: UsersIcon,
		permission: "commenters.read",
	},
	{
		id: "visitors",
		label: "访客",
		icon: BadgeCheckIcon,
		permission: "visitors.read",
	},
	{
		id: "blacklist",
		label: "黑名单",
		icon: ShieldIcon,
		permission: "blacklist.read",
	},
	{ id: "sites", label: "站点", icon: GlobeIcon, permission: "sites.read" },
	{ id: "users", label: "用户", icon: UserCogIcon, permission: "users.read" },
	{ id: "data", label: "数据", icon: DatabaseIcon, permission: "data.export" },
	{
		id: "tasks",
		label: "任务",
		icon: ListChecksIcon,
		permission: "tasks.read",
	},
	{
		id: "ops",
		label: "运维",
		icon: TerminalSquareIcon,
		permission: "ops.read",
	},
	{
		id: "settings",
		label: "站点设置",
		icon: FlagIcon,
		permission: "site_settings.read",
	},
	{
		id: "system",
		label: "系统设置",
		icon: SettingsIcon,
		permission: "system_settings.read",
	},
];

const profileNavItem = {
	id: "profile" as const,
	label: "个人中心",
	icon: UserRoundIcon,
};

function readInitialView(): AdminView {
	if (typeof window === "undefined") {
		return "overview";
	}
	const value = new URLSearchParams(window.location.search).get("view");
	if (value === "profile" || navItems.some((item) => item.id === value)) {
		return value as AdminView;
	}
	return "overview";
}

export function AdminShell({ onLogout }: { onLogout: () => void }) {
	const queryClient = useQueryClient();
	const [view, setViewState] = useState<AdminView>(() => readInitialView());
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
	const setView = useCallback((nextView: AdminView) => {
		setViewState(nextView);
		if (typeof window === "undefined") {
			return;
		}
		const url = new URL(window.location.href);
		url.searchParams.set("view", nextView);
		window.history.replaceState(null, "", url);
	}, []);

	const activeSite = meQuery.data?.sites.find(
		(site) => site.siteKey === selectedSiteKey,
	);
	const permissions = meQuery.data?.permissions ?? [];
	const visibleNavItems = navItems.filter(
		(item) => !item.permission || permissions.includes(item.permission),
	);
	const allVisibleNavItems = [...visibleNavItems, profileNavItem];
	const activeView = allVisibleNavItems.some((item) => item.id === view)
		? view
		: meQuery.data
			? (visibleNavItems[0]?.id ?? "overview")
			: view;
	useEffect(() => {
		if (meQuery.data && activeView !== view) {
			setView(activeView);
		}
	}, [activeView, meQuery.data, setView, view]);
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
		switch (activeView) {
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
			case "commenters":
				return (
					<CommentersPage siteKey={activeSiteKey} openComments={openComments} />
				);
			case "visitors":
				return (
					<VisitorsPage siteKey={activeSiteKey} openComments={openComments} />
				);
			case "blacklist":
				return <BlacklistPage siteKey={activeSiteKey} />;
			case "sites":
				return <SitesPage openSite={openSite} />;
			case "data":
				return (
					<DataPage
						site={
							activeSite ?? {
								siteKey: activeSiteKey,
								name: activeSiteKey || "未选择站点",
								allowedOrigins: [],
							}
						}
					/>
				);
			case "tasks":
				return <TasksPage siteKey={activeSiteKey} />;
			case "ops":
				return <OpsPage />;
			case "users":
				return (
					<UsersPage
						isInitialAdmin={Boolean(meQuery.data?.user.isInitialAdmin)}
					/>
				);
			case "profile":
				return <ProfilePage />;
			case "settings":
				if (!activeSiteKey) {
					return <EmptyState text="请选择站点" />;
				}
				return <SiteSettingsPage siteKey={activeSiteKey} />;
			case "system":
				return <SystemSettingsPage siteKey={activeSiteKey} />;
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
					{visibleNavItems.map((item) => {
						const Icon = item.icon;
						return (
							<Button
								key={item.id}
								type="button"
								variant={activeView === item.id ? "secondary" : "ghost"}
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
							{allVisibleNavItems.find((item) => item.id === activeView)
								?.label ?? "管理台"}
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
							{allVisibleNavItems.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</select>
						<Button
							type="button"
							variant={activeView === "profile" ? "secondary" : "outline"}
							onClick={() => setView("profile")}
						>
							<UserRoundIcon data-icon="inline-start" />
							<span className="hidden sm:inline">
								{meQuery.data?.user.displayName ?? "个人中心"}
							</span>
						</Button>
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
				<section
					data-testid="admin-content"
					className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4 md:p-6"
				>
					<Suspense fallback={<EmptyState text="正在载入" />}>
						{renderView()}
					</Suspense>
				</section>
			</main>
		</div>
	);
}
