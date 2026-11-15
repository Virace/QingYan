import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BadgeCheckIcon,
	BookOpenIcon,
	FlagIcon,
	GlobeIcon,
	ListChecksIcon,
	LogOutIcon,
	type LucideIcon,
	MessageSquareTextIcon,
	RefreshCwIcon,
	SettingsIcon,
	ShieldIcon,
	TerminalSquareIcon,
	UserCogIcon,
	UserRoundIcon,
	UsersIcon,
} from "lucide-react";
import {
	type ComponentType,
	type Dispatch,
	lazy,
	type SetStateAction,
	Suspense,
	useCallback,
	useEffect,
	useState,
} from "react";

import { fetchAdminMe, logoutAdmin } from "@/api/session";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAdminNavigationGuard } from "../shared/admin-navigation-guard";
import { EmptyState, inputClass } from "../shared/admin-ui";
import { ThemeMenu } from "./theme-menu";
import { useAdminNavigation } from "./use-admin-navigation";

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
	commentId?: string;
	onClearCommentFilter?: () => void;
	siteKey?: string;
	search: string;
	setSearch: Dispatch<SetStateAction<string>>;
	pageKey: string;
	setPageKey: Dispatch<SetStateAction<string>>;
	openTaskRecords: (commentId: string) => void;
};

type TasksPageProps = {
	siteKey: string;
	commentId: string;
	onClearCommentFilter: () => void;
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
	{ siteKey?: string; openComments: OpenComments; canReadOps?: boolean },
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
const TasksPage = lazyAdminPage<TasksPageProps, "TasksPage">(
	() => import("../tasks/tasks-page"),
	"TasksPage",
);
const OpsPage = lazyAdminPage<
	{ siteKey?: string; canRestore?: boolean },
	"OpsPage"
>(() => import("../ops/ops-page"), "OpsPage");
const UsersPage = lazyAdminPage<
	{ isInitialAdmin: boolean; siteKey: string },
	"UsersPage"
>(() => import("../users/users-page"), "UsersPage");
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

function readView(url: URL): AdminView {
	const value = url.searchParams.get("view");
	if (value === "profile" || navItems.some((item) => item.id === value)) {
		return value as AdminView;
	}
	return "overview";
}

export function AdminShell({ onLogout }: { onLogout: () => void }) {
	const queryClient = useQueryClient();
	const { url, navigate, replaceUrl } = useAdminNavigation();
	const { confirmNavigation } = useAdminNavigationGuard();
	const view = readView(url);
	const selectedSiteKey = url.searchParams.get("siteKey") ?? "";
	const taskCommentId = url.searchParams.get("commentId") ?? "";
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

	const activeSite =
		meQuery.data?.sites.find((site) => site.siteKey === selectedSiteKey) ??
		meQuery.data?.sites[0];
	const activeSiteKey = activeSite?.siteKey ?? "";
	const setView = useCallback(
		(nextView: AdminView, siteKey = activeSiteKey) => {
			const nextUrl = new URL(window.location.href);
			nextUrl.searchParams.set("view", nextView);
			if (siteKey) nextUrl.searchParams.set("siteKey", siteKey);
			nextUrl.searchParams.delete("commentId");
			nextUrl.hash = "";
			return navigate(nextUrl);
		},
		[activeSiteKey, navigate],
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
		if (!meQuery.data) return;
		if (activeView === view && activeSiteKey === selectedSiteKey) return;
		const nextUrl = new URL(window.location.href);
		nextUrl.searchParams.set("view", activeView);
		if (activeSiteKey) nextUrl.searchParams.set("siteKey", activeSiteKey);
		else nextUrl.searchParams.delete("siteKey");
		replaceUrl(nextUrl);
	}, [
		activeSiteKey,
		activeView,
		meQuery.data,
		replaceUrl,
		selectedSiteKey,
		view,
	]);

	useEffect(() => {
		const internalLinkClick = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const anchor =
				event.target instanceof Element
					? event.target.closest("a[href]")
					: null;
			if (
				!(anchor instanceof HTMLAnchorElement) ||
				anchor.hasAttribute("download") ||
				(anchor.target && anchor.target !== "_self")
			)
				return;
			const nextUrl = new URL(anchor.href);
			if (
				nextUrl.origin !== window.location.origin ||
				nextUrl.pathname !== window.location.pathname ||
				!nextUrl.searchParams.has("view")
			)
				return;
			event.preventDefault();
			if (!nextUrl.searchParams.has("siteKey") && activeSiteKey)
				nextUrl.searchParams.set("siteKey", activeSiteKey);
			void navigate(nextUrl);
		};
		document.addEventListener("click", internalLinkClick);
		return () => document.removeEventListener("click", internalLinkClick);
	}, [activeSiteKey, navigate]);

	const openComments = async (input: { pageKey?: string; search?: string }) => {
		if (await setView("comments")) {
			setCommentPageKey(input.pageKey ?? "");
			setCommentSearch(input.search ?? "");
		}
	};
	const openSite = (siteKey: string, nextView: AdminView) => {
		void setView(nextView, siteKey);
	};
	const openTaskRecords = (commentId: string) => {
		const nextUrl = new URL(window.location.href);
		nextUrl.searchParams.set("view", "tasks");
		nextUrl.searchParams.set("commentId", commentId);
		if (activeSiteKey) nextUrl.searchParams.set("siteKey", activeSiteKey);
		void navigate(nextUrl);
	};
	const clearTaskCommentFilter = () => {
		const nextUrl = new URL(window.location.href);
		nextUrl.searchParams.delete("commentId");
		replaceUrl(nextUrl);
	};

	function renderView() {
		switch (activeView) {
			case "overview":
				return <OverviewPage />;
			case "comments":
				return (
					<CommentsPage
						commentId={taskCommentId}
						onClearCommentFilter={clearTaskCommentFilter}
						siteKey={activeSiteKey}
						search={commentSearch}
						setSearch={setCommentSearch}
						pageKey={commentPageKey}
						setPageKey={setCommentPageKey}
						openTaskRecords={openTaskRecords}
					/>
				);
			case "pages":
				return (
					<PagesPage
						siteKey={activeSiteKey}
						openComments={openComments}
						canReadOps={permissions.includes("ops.read")}
					/>
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
			case "tasks":
				return (
					<TasksPage
						siteKey={activeSiteKey}
						commentId={taskCommentId}
						onClearCommentFilter={clearTaskCommentFilter}
					/>
				);
			case "ops":
				return (
					<OpsPage
						siteKey={activeSiteKey}
						canRestore={permissions.includes("ops.restore")}
					/>
				);
			case "users":
				return (
					<UsersPage
						isInitialAdmin={Boolean(meQuery.data?.user.isInitialAdmin)}
						siteKey={activeSiteKey}
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
								className="admin-nav-item justify-start"
								aria-current={activeView === item.id ? "page" : undefined}
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
				<header className="admin-header border-b bg-background px-4 py-3 md:px-6">
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
					<div className="admin-header-selectors">
						<label className="min-w-0 md:hidden">
							<span className="mb-1 block text-xs text-muted-foreground">
								管理模块
							</span>
							<select
								className={`${inputClass} w-full min-w-0`}
								value={activeView}
								onChange={(event) => setView(event.target.value as AdminView)}
								aria-label="管理模块"
							>
								{allVisibleNavItems.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</label>
						<label className="min-w-0 md:w-44 lg:w-52">
							<span className="mb-1 block text-xs text-muted-foreground md:sr-only">
								当前站点
							</span>
							<select
								className={`${inputClass} w-full min-w-0`}
								value={activeSiteKey}
								onChange={(event) =>
									void setView(activeView, event.target.value)
								}
								aria-label="当前站点"
							>
								{meQuery.data?.sites.map((site) => (
									<option key={site.siteKey} value={site.siteKey}>
										{site.name}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="admin-header-actions flex items-center gap-2">
						<Button
							type="button"
							variant={activeView === "profile" ? "secondary" : "outline"}
							onClick={() => setView("profile")}
							aria-label="个人中心"
							className="size-9 px-0 lg:w-auto lg:px-3"
						>
							<UserRoundIcon data-icon="inline-start" />
							<span className="hidden lg:inline">
								{meQuery.data?.user.displayName ?? "个人中心"}
							</span>
						</Button>
						<ThemeMenu />
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
							onClick={async () => {
								if (await confirmNavigation()) logoutMutation.mutate();
							}}
							aria-label="退出"
							className="size-9 px-0 lg:w-auto lg:px-3"
							disabled={logoutMutation.isPending}
						>
							<LogOutIcon data-icon="inline-start" />
							<span className="hidden lg:inline">退出</span>
						</Button>
					</div>
				</header>
				<section
					key={`${activeView}:${activeSiteKey}`}
					data-testid="admin-content"
					className="admin-page-enter mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4 md:p-6"
				>
					<Suspense fallback={<EmptyState text="正在载入" />}>
						{renderView()}
					</Suspense>
				</section>
			</main>
		</div>
	);
}
