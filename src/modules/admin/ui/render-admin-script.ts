export function renderAdminScript(): string {
	return `
const ENDPOINTS = {
	me: "/api/admin/session/me",
	captcha: "/api/admin/session/captcha",
	login: "/api/admin/session/login",
	logout: "/api/admin/session/logout",
	comments: "/api/admin/comments",
	pages: "/api/admin/pages",
	users: "/api/admin/users",
	visitors: "/api/admin/visitors",
	blacklist: "/api/admin/blacklist",
	sites: "/api/admin/sites",
	settings: "/api/admin/settings",
	systemSettings: "/api/admin/system-settings",
};

const COMMENT_REQUIRE_FIELDS = ["nickname", "email", "website"];

const state = {
	authenticated: false,
	activeTab: "comments",
	comments: null,
	pages: null,
	users: null,
	visitors: null,
	blacklist: null,
	sitesSummary: null,
	settings: null,
	systemSettings: null,
	commentFilters: {
		limit: 20,
		offset: 0,
		pageKey: "",
		search: "",
		status: "",
	},
	currentSiteKey: "",
	loginChallenge: null,
	loginChallengeLoading: false,
	loginMessage: "",
	shellMessage: "",
	sites: [],
	tabLoading: false,
};

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
	return escapeHtml(value);
}

async function request(path, init = {}) {
	const response = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.includes("application/json")
		? await response.json()
		: await response.text();

	if (!response.ok) {
		const error = new Error(
			contentType.includes("application/json")
				? payload?.error?.message ?? "请求失败。"
				: "请求失败。",
		);
		error.code = contentType.includes("application/json")
			? payload?.error?.code
			: "HTTP_ERROR";
		error.payload = payload;
		error.statusCode = response.status;
		throw error;
	}

	return payload;
}

function buildQuery(params) {
	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") {
			continue;
		}

		searchParams.set(key, String(value));
	}

	const query = searchParams.toString();
	return query ? "?" + query : "";
}

function resetCollections() {
	state.comments = null;
	state.pages = null;
	state.users = null;
	state.visitors = null;
	state.blacklist = null;
	state.sitesSummary = null;
	state.settings = null;
	state.systemSettings = null;
}

function setLoginState(message) {
	state.authenticated = false;
	state.currentSiteKey = "";
	state.sites = [];
	resetCollections();
	state.loginMessage = message ?? "";
	render();
	if (!state.loginChallenge && !state.loginChallengeLoading) {
		void loadCaptcha();
	}
}

async function loadCaptcha() {
	state.loginChallengeLoading = true;
	render();

	try {
		const payload = await request(ENDPOINTS.captcha);
		state.loginChallenge = payload.challenge;
	} catch (error) {
		state.loginChallenge = null;
		state.loginMessage = error.message;
	} finally {
		state.loginChallengeLoading = false;
		render();
	}
}

async function bootstrap() {
	try {
		const payload = await request(ENDPOINTS.me);
		state.authenticated = true;
		state.loginChallenge = null;
		state.loginMessage = "";
		state.sites = payload.sites ?? [];
		if (!state.currentSiteKey) {
			state.currentSiteKey = state.sites[0]?.siteKey ?? "";
		}
		render();
		await loadActiveTab();
	} catch (error) {
		if (error.statusCode === 401) {
			setLoginState("");
			return;
		}

		setLoginState(error.message);
	}
}

async function login(token, captchaValue) {
	if (!token.trim()) {
		state.loginMessage = "请输入 Admin Token。";
		render();
		return;
	}

	if (!captchaValue.trim()) {
		state.loginMessage = "请先填写管理员登录验证码。";
		render();
		return;
	}

	try {
		await request(ENDPOINTS.login, {
			method: "POST",
			body: JSON.stringify({
				token,
				challengeId: state.loginChallenge?.challengeId,
				captchaValue,
			}),
		});
		await bootstrap();
	} catch (error) {
		state.loginMessage = error.message;
		state.loginChallenge = null;
		render();
		if (error.code !== "ADMIN_BLACKLISTED") {
			await loadCaptcha();
		}
	}
}

async function logout() {
	try {
		await request(ENDPOINTS.logout, {
			method: "POST",
			body: "{}",
		});
	} finally {
		state.loginChallenge = null;
		setLoginState("");
	}
}

async function loadActiveTab() {
	if (!state.authenticated) {
		render();
		return;
	}

	if (
		state.activeTab !== "sites" &&
		!state.currentSiteKey &&
		state.sites.length > 0
	) {
		state.currentSiteKey = state.sites[0].siteKey;
	}

	state.tabLoading = true;
	state.shellMessage = "";
	render();

	try {
		if (state.activeTab === "comments") {
			state.comments = await request(
				ENDPOINTS.comments +
					buildQuery({
						siteKey: state.currentSiteKey,
						pageKey: state.commentFilters.pageKey,
						search: state.commentFilters.search,
						status: state.commentFilters.status,
						limit: state.commentFilters.limit,
						offset: state.commentFilters.offset,
					}),
			);
		} else if (state.activeTab === "pages") {
			state.pages = await request(
				ENDPOINTS.pages +
					buildQuery({
						siteKey: state.currentSiteKey,
						limit: 20,
						offset: 0,
					}),
			);
		} else if (state.activeTab === "users") {
			state.users = await request(
				ENDPOINTS.users +
					buildQuery({
						siteKey: state.currentSiteKey,
						limit: 20,
						offset: 0,
					}),
			);
		} else if (state.activeTab === "visitors") {
			state.visitors = await request(
				ENDPOINTS.visitors +
					buildQuery({
						siteKey: state.currentSiteKey,
						limit: 20,
						offset: 0,
					}),
			);
		} else if (state.activeTab === "blacklist") {
			state.blacklist = await request(
				ENDPOINTS.blacklist +
					buildQuery({
						siteKey: state.currentSiteKey,
					}),
			);
		} else if (state.activeTab === "sites") {
			state.sitesSummary = await request(ENDPOINTS.sites);
		} else if (state.activeTab === "system") {
			state.systemSettings = await request(ENDPOINTS.systemSettings);
		} else {
			state.settings = await request(
				ENDPOINTS.settings +
					buildQuery({
						siteKey: state.currentSiteKey,
					}),
			);
		}
	} catch (error) {
		if (error.statusCode === 401) {
			setLoginState("登录已过期，请重新登录。");
			return;
		}

		state.shellMessage = error.message;
	} finally {
		state.tabLoading = false;
		render();
	}
}

async function updateComment(commentId, payload) {
	await request(ENDPOINTS.comments + "/" + encodeURIComponent(commentId), {
		method: "PATCH",
		body: JSON.stringify(payload),
	});
	await loadActiveTab();
}

async function removeComment(commentId) {
	await request(ENDPOINTS.comments + "/" + encodeURIComponent(commentId), {
		method: "DELETE",
		body: "{}",
	});
	await loadActiveTab();
}

async function createBlacklist(formData) {
	await request(ENDPOINTS.blacklist, {
		method: "POST",
		body: JSON.stringify({
			siteKey: state.currentSiteKey,
			targetType: formData.get("targetType"),
			matchMode: formData.get("matchMode"),
			targetValue: formData.get("targetValue"),
			scope: formData.get("scope"),
			reason: formData.get("reason") || undefined,
		}),
	});
	await loadActiveTab();
}

async function removeBlacklistRule(ruleId) {
	await request(ENDPOINTS.blacklist + "/" + encodeURIComponent(ruleId), {
		method: "DELETE",
		body: "{}",
	});
	await loadActiveTab();
}

function normalizeRequireList(values) {
	return COMMENT_REQUIRE_FIELDS.filter(function (field) {
		return values.includes(field);
	});
}

async function saveSettings(formData) {
	const commentRequire = normalizeRequireList(
		formData.getAll("commentRequire").map(function (value) {
			return String(value);
		}),
	);

	await request(
		ENDPOINTS.settings +
			buildQuery({
				siteKey: state.currentSiteKey,
			}),
		{
			method: "PUT",
			body: JSON.stringify({
				comments: {
					enabled: formData.get("commentsEnabled") === "on",
					defaultStatus: String(formData.get("defaultStatus") ?? "pending"),
					maxDepth: Number(formData.get("maxDepth") ?? 1),
					rootLimit: Number(formData.get("rootLimit") ?? 20),
					allowWebsite: formData.get("allowWebsite") === "on",
					identity: {
						require: commentRequire,
					},
					captcha: {
						mode: String(formData.get("captchaMode") ?? "threshold"),
						thresholdWindowSec: Number(
							formData.get("thresholdWindowSec") ?? 60,
						),
						thresholdMaxActions: Number(
							formData.get("thresholdMaxActions") ?? 3,
						),
					},
					abuseGuard: {
						enabled: formData.get("abuseGuardEnabled") === "on",
						windowSec: Number(formData.get("abuseGuardWindowSec") ?? 600),
						maxWriteActions: Number(
							formData.get("abuseGuardMaxWriteActions") ?? 100,
						),
						autoBlacklist: {
							enabled: formData.get("autoBlacklistEnabled") === "on",
							scope: String(formData.get("autoBlacklistScope") ?? "post"),
							ttlSec: Number(formData.get("autoBlacklistTtlSec") ?? 1800),
						},
					},
				},
				pageFeedback: {
					allowLike: formData.get("allowLike") === "on",
				},
				notifications: {
					emailEnabled: formData.get("emailEnabled") === "on",
				},
			}),
		},
	);
	await loadActiveTab();
}

async function saveSystemSettings(formData) {
	await request(ENDPOINTS.systemSettings, {
		method: "PUT",
		body: JSON.stringify({
			logging: {
				level: String(formData.get("level") ?? "info"),
				retentionDays: Number(formData.get("retentionDays") ?? 7),
			},
		}),
	});
	await loadActiveTab();
}

function renderMessage(message, type) {
	if (!message) {
		return "";
	}

	return (
		'<p class="admin-message admin-message-' +
		type +
		'">' +
		escapeHtml(message) +
		"</p>"
	);
}

function renderLogin() {
	const challengeImage = state.loginChallenge
		? '<img class="admin-captcha-image" alt="管理员登录验证码" src="' +
			state.loginChallenge.imageData +
			'" />'
		: '<div class="admin-captcha-image"></div>';

	return (
		'<main class="admin-login">' +
		'<section class="admin-login-panel">' +
		"<h1>QingYan Admin</h1>" +
		'<p class="admin-subtitle">管理员登录每次都需要验证码。连续 5 次错误会直接永久封禁当前 IP。</p>' +
		renderMessage(state.loginMessage, "error") +
		'<div class="admin-form-grid">' +
		'<div class="admin-form-field">' +
		'<label for="admin-token">Admin Token</label>' +
		'<input id="admin-token" name="token" type="password" autocomplete="current-password" />' +
		"</div>" +
		'<div class="admin-form-field">' +
		"<label>管理员登录验证码</label>" +
		challengeImage +
		"</div>" +
		'<div class="admin-form-field">' +
		'<label for="admin-captcha-value">验证码答案</label>' +
		'<input id="admin-captcha-value" name="captchaValue" type="text" inputmode="numeric" />' +
		"</div>" +
		'<div class="admin-login-actions">' +
		'<button class="admin-button-primary" id="admin-login-button" type="button">登录后台</button>' +
		'<button class="admin-button-secondary" id="admin-refresh-captcha" type="button">' +
		(state.loginChallengeLoading ? "加载中..." : "刷新验证码") +
		"</button>" +
		"</div>" +
		"</div>" +
		"</section>" +
		"</main>"
	);
}

function renderCommentsSection() {
	if (state.tabLoading && !state.comments) {
		return '<section class="admin-panel"><p class="admin-empty">评论列表加载中...</p></section>';
	}

	const items = state.comments?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					const pageLabel = item.pageTitle ?? item.pageKey;
					const pageLink = item.pageUrl
						? '<a href="' +
							escapeAttribute(item.pageUrl) +
							'" target="_blank" rel="noreferrer">' +
							escapeHtml(pageLabel) +
							"</a>"
						: escapeHtml(pageLabel);

					return (
						"<tr>" +
						"<td><strong>" +
						escapeHtml(item.authorName) +
						'</strong><div class="admin-meta">' +
						escapeHtml(item.authorEmail ?? "") +
						"</div></td>" +
						"<td>" +
						pageLink +
						'<div class="admin-meta">' +
						escapeHtml(item.pageKey) +
						'</div><div class="admin-meta">pageUrl: ' +
						escapeHtml(item.pageUrl ?? "未提供") +
						"</div></td>" +
						"<td>" +
						escapeHtml(item.contentRaw) +
						"</td>" +
						'<td><span class="admin-chip">' +
						escapeHtml(item.status) +
						"</span></td>" +
						"<td>" +
						'<div class="admin-toolbar-actions">' +
						'<button class="admin-button-secondary" type="button" data-comment-action="status" data-comment-id="' +
						escapeAttribute(item.id) +
						'" data-comment-status="' +
						(item.status === "pending" ? "approved" : "pending") +
						'">' +
						(item.status === "pending" ? "审核通过" : "设为待审") +
						"</button>" +
						'<button class="admin-button-secondary" type="button" data-comment-action="pin" data-comment-id="' +
						escapeAttribute(item.id) +
						'" data-comment-value="' +
						String(!item.isPinned) +
						'">' +
						(item.isPinned ? "取消置顶" : "置顶") +
						"</button>" +
						'<button class="admin-button-secondary" type="button" data-comment-action="fold" data-comment-id="' +
						escapeAttribute(item.id) +
						'" data-comment-value="' +
						String(!item.isFolded) +
						'">' +
						(item.isFolded ? "展开" : "折叠") +
						"</button>" +
						'<button class="admin-button-danger" type="button" data-comment-action="delete" data-comment-id="' +
						escapeAttribute(item.id) +
						'">删除</button>' +
						"</div>" +
						"</td>" +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="5"><p class="admin-empty">当前没有评论数据。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<form class="admin-filter-grid" id="comments-filter-form">' +
		'<div class="admin-form-field"><label for="comments-status">状态</label><select id="comments-status" name="status"><option value="">全部</option><option value="pending"' +
		(state.commentFilters.status === "pending" ? " selected" : "") +
		'>pending</option><option value="approved"' +
		(state.commentFilters.status === "approved" ? " selected" : "") +
		">approved</option></select></div>" +
		'<div class="admin-form-field"><label for="comments-page-key">页面键</label><input id="comments-page-key" name="pageKey" value="' +
		escapeAttribute(state.commentFilters.pageKey) +
		'" /></div>' +
		'<div class="admin-form-field"><label for="comments-search">搜索</label><input id="comments-search" name="search" value="' +
		escapeAttribute(state.commentFilters.search) +
		'" /></div>' +
		'<div class="admin-form-field"><label for="comments-limit">每页条数</label><input id="comments-limit" name="limit" type="number" min="1" max="100" value="' +
		escapeAttribute(state.commentFilters.limit) +
		'" /></div>' +
		'<div class="admin-toolbar-actions"><button class="admin-button-primary" type="submit">应用筛选</button></div>' +
		"</form>" +
		'<table class="admin-table"><thead><tr><th>作者</th><th>页面</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderPagesSection() {
	if (state.tabLoading && !state.pages) {
		return '<section class="admin-panel"><p class="admin-empty">页面列表加载中...</p></section>';
	}

	const items = state.pages?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					return (
						"<tr>" +
						"<td>" +
						(item.pageUrl
							? '<a href="' +
								escapeAttribute(item.pageUrl) +
								'" target="_blank" rel="noreferrer">' +
								escapeHtml(item.pageTitle ?? item.pageKey) +
								"</a>"
							: escapeHtml(item.pageTitle ?? item.pageKey)) +
						'<div class="admin-meta">' +
						escapeHtml(item.pageKey) +
						'</div><div class="admin-meta">pageUrl: ' +
						escapeHtml(item.pageUrl ?? "未提供") +
						"</div></td>" +
						"<td>" +
						escapeHtml(item.commentCount) +
						"</td>" +
						"<td>" +
						escapeHtml(item.userCount) +
						"</td>" +
						"<td>" +
						escapeHtml(item.visitorCount) +
						"</td>" +
						"<td>" +
						'<button class="admin-button-secondary" type="button" data-open-comments-page="' +
						escapeAttribute(item.pageKey) +
						'">查看评论</button>' +
						"</td>" +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="5"><p class="admin-empty">当前没有页面数据。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<table class="admin-table"><thead><tr><th>页面</th><th>评论数</th><th>用户数</th><th>访客数</th><th>操作</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderUsersSection() {
	if (state.tabLoading && !state.users) {
		return '<section class="admin-panel"><p class="admin-empty">用户列表加载中...</p></section>';
	}

	const items = state.users?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					return (
						"<tr>" +
						"<td>" +
						escapeHtml(item.email) +
						"</td>" +
						"<td>" +
						escapeHtml((item.names ?? []).join(", ")) +
						"</td>" +
						"<td>" +
						escapeHtml(item.commentCount) +
						"</td>" +
						"<td>" +
						escapeHtml(item.pageCount) +
						"</td>" +
						"<td>" +
						(item.isBlacklisted ? "已命中邮箱黑名单" : "正常") +
						"</td>" +
						"<td>" +
						'<button class="admin-button-secondary" type="button" data-open-comments-search="' +
						escapeAttribute(item.email) +
						'">查看评论</button>' +
						"</td>" +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="6"><p class="admin-empty">当前没有用户数据。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<table class="admin-table"><thead><tr><th>邮箱</th><th>昵称集合</th><th>评论数</th><th>页面数</th><th>黑名单</th><th>操作</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderVisitorsSection() {
	if (state.tabLoading && !state.visitors) {
		return '<section class="admin-panel"><p class="admin-empty">访客列表加载中...</p></section>';
	}

	const items = state.visitors?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					return (
						"<tr>" +
						"<td>" +
						escapeHtml(item.visitorKey) +
						'<div class="admin-meta">' +
						escapeHtml(item.siteKey) +
						"</div></td>" +
						"<td>" +
						escapeHtml(item.commentCount) +
						"</td>" +
						"<td>" +
						escapeHtml(item.pageCount) +
						"</td>" +
						"<td>" +
						escapeHtml((item.emails ?? []).join(", ")) +
						"</td>" +
						"<td>" +
						(item.blacklist?.visitor ? "访客黑名单" : "正常") +
						(item.blacklist?.ip === null ? " / IP 未关联" : "") +
						"</td>" +
						"<td>" +
						'<button class="admin-button-secondary" type="button" data-open-comments-search="' +
						escapeAttribute(item.visitorKey) +
						'">按访客查看评论</button>' +
						"</td>" +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="6"><p class="admin-empty">当前没有访客数据。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<table class="admin-table"><thead><tr><th>访客</th><th>评论数</th><th>页面数</th><th>邮箱</th><th>黑名单</th><th>操作</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderBlacklistSection() {
	if (state.tabLoading && !state.blacklist) {
		return '<section class="admin-panel"><p class="admin-empty">黑名单列表加载中...</p></section>';
	}

	const items = state.blacklist?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					return (
						"<tr>" +
						"<td>" +
						escapeHtml(item.targetType) +
						"</td>" +
						"<td>" +
						escapeHtml(item.targetValue) +
						"</td>" +
						"<td>" +
						escapeHtml(item.matchMode) +
						"</td>" +
						"<td>" +
						escapeHtml(item.scope) +
						"</td>" +
						'<td><button class="admin-button-danger" type="button" data-blacklist-delete="' +
						escapeAttribute(item.id) +
						'">删除</button></td>' +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="5"><p class="admin-empty">当前没有黑名单规则。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<form class="admin-filter-grid" id="blacklist-form">' +
		'<div class="admin-form-field"><label for="blacklist-target-type">目标类型</label><select id="blacklist-target-type" name="targetType"><option value="ip">ip</option><option value="email">email</option><option value="visitor">visitor</option></select></div>' +
		'<div class="admin-form-field"><label for="blacklist-match-mode">匹配方式</label><select id="blacklist-match-mode" name="matchMode"><option value="exact">exact</option><option value="cidr">cidr</option><option value="wildcard">wildcard</option></select></div>' +
		'<div class="admin-form-field"><label for="blacklist-target-value">目标值</label><input id="blacklist-target-value" name="targetValue" /></div>' +
		'<div class="admin-form-field"><label for="blacklist-scope">作用域</label><select id="blacklist-scope" name="scope"><option value="post">post</option><option value="all">all</option></select></div>' +
		'<div class="admin-form-field"><label for="blacklist-reason">原因</label><input id="blacklist-reason" name="reason" /></div>' +
		'<div class="admin-toolbar-actions"><button class="admin-button-primary" type="submit">新增规则</button></div>' +
		"</form>" +
		'<table class="admin-table"><thead><tr><th>类型</th><th>目标</th><th>匹配</th><th>作用域</th><th>操作</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderSitesSection() {
	if (state.tabLoading && !state.sitesSummary) {
		return '<section class="admin-panel"><p class="admin-empty">站点总览加载中...</p></section>';
	}

	const items = state.sitesSummary?.items ?? [];
	const rows = items.length
		? items
				.map(function (item) {
					return (
						"<tr>" +
						"<td>" +
						escapeHtml(item.name) +
						'<div class="admin-meta">' +
						escapeHtml(item.siteKey) +
						"</div></td>" +
						"<td>" +
						escapeHtml(item.allowedOrigins.join(", ")) +
						"</td>" +
						"<td>" +
						escapeHtml(item.pageCount) +
						" / " +
						escapeHtml(item.commentCount) +
						" / " +
						escapeHtml(item.userCount) +
						" / " +
						escapeHtml(item.visitorCount) +
						"</td>" +
						"<td>" +
						escapeHtml(item.comments.defaultStatus) +
						'<div class="admin-meta">identity.require: ' +
						escapeHtml((item.comments.identity.require ?? []).join(", ")) +
						"</div></td>" +
						"<td>" +
						'<div class="admin-toolbar-actions">' +
						'<button class="admin-button-secondary" type="button" data-open-site-tab="settings" data-open-site-key="' +
						escapeAttribute(item.siteKey) +
						'">运行时设置</button>' +
						'<button class="admin-button-secondary" type="button" data-open-site-tab="pages" data-open-site-key="' +
						escapeAttribute(item.siteKey) +
						'">页面管理</button>' +
						'<button class="admin-button-secondary" type="button" data-open-site-tab="users" data-open-site-key="' +
						escapeAttribute(item.siteKey) +
						'">用户管理</button>' +
						'<button class="admin-button-secondary" type="button" data-open-site-tab="visitors" data-open-site-key="' +
						escapeAttribute(item.siteKey) +
						'">访客管理</button>' +
						"</div>" +
						"</td>" +
						"</tr>"
					);
				})
				.join("")
		: '<tr><td colspan="5"><p class="admin-empty">当前没有站点数据。</p></td></tr>';

	return (
		'<section class="admin-panel">' +
		'<table class="admin-table"><thead><tr><th>站点</th><th>Allowed Origins</th><th>页面/评论/用户/访客</th><th>运行时摘要</th><th>入口</th></tr></thead><tbody>' +
		rows +
		"</tbody></table>" +
		"</section>"
	);
}

function renderRequireCheckbox(field, currentRequire, allowWebsite) {
	const disabled = field === "website" && !allowWebsite;
	const labels = {
		nickname: {
			title: "昵称",
			description: "没有传统登录时，用来标识评论作者。",
		},
		email: {
			title: "邮箱",
			description: "用于通知、回访和用户聚合。",
		},
		website: {
			title: "站点",
			description: "允许作者附带个人主页或站点链接。",
		},
	};
	const label = labels[field];
	return (
		'<label class="admin-check-option">' +
		'<span class="admin-check-option-copy">' +
		'<span class="admin-check-option-title">' +
		label.title +
		"</span>" +
		'<span class="admin-check-option-description">' +
		label.description +
		"</span>" +
		"</span>" +
		'<input type="checkbox" name="commentRequire" value="' +
		field +
		'"' +
		(currentRequire.includes(field) ? " checked" : "") +
		(disabled ? " disabled" : "") +
		" />" +
		"</label>"
	);
}

function renderToggleField(input) {
	return (
		'<div class="admin-form-field admin-toggle-field">' +
		'<div class="admin-toggle-copy">' +
		'<label class="admin-toggle-title" for="' +
		input.id +
		'">' +
		input.title +
		"</label>" +
		'<div class="admin-toggle-key">' +
		input.key +
		"</div>" +
		'<p class="admin-toggle-description">' +
		input.description +
		"</p>" +
		"</div>" +
		'<label class="admin-switch" for="' +
		input.id +
		'">' +
		'<input id="' +
		input.id +
		'" name="' +
		input.name +
		'" type="checkbox"' +
		(input.checked ? " checked" : "") +
		" />" +
		'<span class="admin-switch-text">' +
		(input.checked ? "已开启" : "已关闭") +
		"</span>" +
		"</label>" +
		"</div>"
	);
}

function renderSettingsSection() {
	const settings = state.settings;
	if (state.tabLoading && !settings) {
		return '<section class="admin-panel"><p class="admin-empty">运行时设置加载中...</p></section>';
	}

	if (!settings) {
		return '<section class="admin-panel"><p class="admin-empty">未加载到运行时设置。</p></section>';
	}

	const allowWebsite = settings.comments.allowWebsite;
	const currentRequire = settings.comments.identity?.require ?? [];

	return (
		'<section class="admin-panel">' +
		'<form class="admin-settings-grid" id="settings-form">' +
		renderToggleField({
			id: "settings-comments-enabled",
			name: "commentsEnabled",
			checked: settings.comments.enabled,
			title: "开启评论功能",
			key: "comments.enabled",
			description: "控制前台评论列表、评论写入和相关管理能力是否可用。",
		}) +
		'<div class="admin-form-field"><label for="settings-default-status">评论默认状态</label><select id="settings-default-status" name="defaultStatus"><option value="pending"' +
		(settings.comments.defaultStatus === "pending" ? " selected" : "") +
		'>pending</option><option value="approved"' +
		(settings.comments.defaultStatus === "approved" ? " selected" : "") +
		">approved</option></select></div>" +
		'<div class="admin-form-field"><label for="settings-max-depth">最大嵌套层级</label><input id="settings-max-depth" name="maxDepth" type="number" min="1" value="' +
		escapeAttribute(settings.comments.maxDepth) +
		'" /></div>' +
		'<div class="admin-form-field"><label for="settings-root-limit">首层分页条数</label><input id="settings-root-limit" name="rootLimit" type="number" min="1" value="' +
		escapeAttribute(settings.comments.rootLimit) +
		'" /></div>' +
		renderToggleField({
			id: "settings-allow-website",
			name: "allowWebsite",
			checked: allowWebsite,
			title: "允许作者提交站点链接",
			key: "comments.allowWebsite",
			description: "关闭后前台不再接收 website 字段，相关必填项也会自动失效。",
		}) +
		'<div class="admin-form-field">' +
		'<label for="settings-comment-require">评论身份必填项</label>' +
		'<div class="admin-field-help">identity.require：决定昵称、邮箱、站点哪些字段在评论提交时必须填写。</div>' +
		'<div id="settings-comment-require" class="admin-checkbox-list">' +
		renderRequireCheckbox("nickname", currentRequire, allowWebsite) +
		renderRequireCheckbox("email", currentRequire, allowWebsite) +
		renderRequireCheckbox("website", currentRequire, allowWebsite) +
		"</div></div>" +
		'<div class="admin-form-field"><label for="settings-captcha-mode">验证码模式</label><select id="settings-captcha-mode" name="captchaMode"><option value="never"' +
		(settings.comments.captcha.mode === "never" ? " selected" : "") +
		'>never</option><option value="always"' +
		(settings.comments.captcha.mode === "always" ? " selected" : "") +
		'>always</option><option value="threshold"' +
		(settings.comments.captcha.mode === "threshold" ? " selected" : "") +
		">threshold</option></select></div>" +
		'<div class="admin-form-field"><label for="settings-threshold-window">阈值窗口（秒）</label><input id="settings-threshold-window" name="thresholdWindowSec" type="number" min="1" value="' +
		escapeAttribute(settings.comments.captcha.thresholdWindowSec) +
		'" /></div>' +
		'<div class="admin-form-field"><label for="settings-threshold-actions">从第 N 次写操作开始要求验证码</label><input id="settings-threshold-actions" name="thresholdMaxActions" type="number" min="1" value="' +
		escapeAttribute(settings.comments.captcha.thresholdMaxActions) +
		'" /></div>' +
		renderToggleField({
			id: "settings-abuse-guard-enabled",
			name: "abuseGuardEnabled",
			checked: settings.comments.abuseGuard.enabled,
			title: "开启滥用防护",
			key: "abuseGuard.enabled",
			description: "按时间窗口统计写入行为，超限后进入自动拉黑判定。",
		}) +
		'<div class="admin-form-field"><label for="settings-abuse-window">滥用窗口（秒）</label><input id="settings-abuse-window" name="abuseGuardWindowSec" type="number" min="1" value="' +
		escapeAttribute(settings.comments.abuseGuard.windowSec) +
		'" /></div>' +
		'<div class="admin-form-field"><label for="settings-abuse-max">窗口内最大写入</label><input id="settings-abuse-max" name="abuseGuardMaxWriteActions" type="number" min="1" value="' +
		escapeAttribute(settings.comments.abuseGuard.maxWriteActions) +
		'" /></div>' +
		renderToggleField({
			id: "settings-auto-blacklist-enabled",
			name: "autoBlacklistEnabled",
			checked: settings.comments.abuseGuard.autoBlacklist.enabled,
			title: "开启自动拉黑",
			key: "autoBlacklist.enabled",
			description: "写入行为超过滥用阈值后，自动生成黑名单规则拦截后续请求。",
		}) +
		'<div class="admin-form-field"><label for="settings-auto-blacklist-scope">autoBlacklist.scope</label><select id="settings-auto-blacklist-scope" name="autoBlacklistScope"><option value="post"' +
		(settings.comments.abuseGuard.autoBlacklist.scope === "post"
			? " selected"
			: "") +
		'>post</option><option value="all"' +
		(settings.comments.abuseGuard.autoBlacklist.scope === "all"
			? " selected"
			: "") +
		">all</option></select></div>" +
		'<div class="admin-form-field"><label for="settings-auto-blacklist-ttl">autoBlacklist.ttlSec</label><input id="settings-auto-blacklist-ttl" name="autoBlacklistTtlSec" type="number" min="1" value="' +
		escapeAttribute(settings.comments.abuseGuard.autoBlacklist.ttlSec) +
		'" /></div>' +
		renderToggleField({
			id: "settings-allow-like",
			name: "allowLike",
			checked: settings.pageFeedback.allowLike,
			title: "开启页面点赞",
			key: "pageFeedback.allowLike",
			description: "控制页面级点赞按钮是否显示，以及是否接收点赞请求。",
		}) +
		renderToggleField({
			id: "settings-email-enabled",
			name: "emailEnabled",
			checked: settings.notifications.emailEnabled,
			title: "开启邮件通知",
			key: "notifications.emailEnabled",
			description: "为后续回复通知和站点通知能力保留统一开关。",
		}) +
		'<div class="admin-toolbar-actions"><button class="admin-button-primary" type="submit">保存设置</button></div>' +
		"</form>" +
		"</section>"
	);
}

function renderSystemSettingsSection() {
	const settings = state.systemSettings;
	if (state.tabLoading && !settings) {
		return '<section class="admin-panel"><p class="admin-empty">系统设置加载中...</p></section>';
	}

	if (!settings) {
		return '<section class="admin-panel"><p class="admin-empty">未加载到系统设置。</p></section>';
	}

	return (
		'<section class="admin-panel">' +
		'<form class="admin-settings-grid" id="system-settings-form">' +
		'<div class="admin-form-field"><label for="system-logging-level">日志等级</label><select id="system-logging-level" name="level"><option value="error"' +
		(settings.logging.level === "error" ? " selected" : "") +
		'>error</option><option value="warn"' +
		(settings.logging.level === "warn" ? " selected" : "") +
		'>warn</option><option value="info"' +
		(settings.logging.level === "info" ? " selected" : "") +
		'>info</option><option value="debug"' +
		(settings.logging.level === "debug" ? " selected" : "") +
		">debug</option></select></div>" +
		'<div class="admin-form-field"><label for="system-retention-days">日志保留天数</label><input id="system-retention-days" name="retentionDays" type="number" min="1" max="3650" value="' +
		escapeAttribute(settings.logging.retentionDays) +
		'" /></div>' +
		'<div class="admin-form-field"><label>日志目录</label><div class="admin-meta">' +
		escapeHtml(settings.logging.directory) +
		"</div></div>" +
		'<div class="admin-toolbar-actions"><button class="admin-button-primary" type="submit">保存并立即生效</button></div>' +
		"</form>" +
		"</section>"
	);
}

function buildStats() {
	if (state.activeTab === "system") {
		return [
			{
				label: "日志等级",
				value: state.systemSettings?.logging?.level ?? "-",
			},
			{
				label: "保留天数",
				value: state.systemSettings?.logging?.retentionDays ?? "-",
			},
			{
				label: "日志目录",
				value: state.systemSettings?.logging?.directory ?? "-",
			},
		];
	}

	if (state.activeTab === "sites") {
		return [
			{ label: "站点数", value: state.sitesSummary?.items?.length ?? "-" },
			{ label: "当前站点", value: state.currentSiteKey || "-" },
			{
				label: "验证码阈值",
				value: state.settings?.comments?.captcha?.thresholdMaxActions ?? "-",
			},
		];
	}

	return [
		{ label: "评论条目", value: state.comments?.pagination?.totalCount ?? "-" },
		{ label: "黑名单规则", value: state.blacklist?.items?.length ?? "-" },
		{
			label: "验证码阈值",
			value: state.settings?.comments?.captcha?.thresholdMaxActions ?? "-",
		},
	];
}

function renderShell() {
	const statsHtml = buildStats()
		.map(function (item) {
			return (
				'<section class="admin-stat"><span>' +
				escapeHtml(item.label) +
				"</span><strong>" +
				escapeHtml(item.value) +
				"</strong></section>"
			);
		})
		.join("");

	let sectionHtml = "";
	if (state.activeTab === "comments") {
		sectionHtml = renderCommentsSection();
	} else if (state.activeTab === "pages") {
		sectionHtml = renderPagesSection();
	} else if (state.activeTab === "users") {
		sectionHtml = renderUsersSection();
	} else if (state.activeTab === "visitors") {
		sectionHtml = renderVisitorsSection();
	} else if (state.activeTab === "blacklist") {
		sectionHtml = renderBlacklistSection();
	} else if (state.activeTab === "sites") {
		sectionHtml = renderSitesSection();
	} else if (state.activeTab === "system") {
		sectionHtml = renderSystemSettingsSection();
	} else {
		sectionHtml = renderSettingsSection();
	}

	const tabButton = function (key, label) {
		return (
			'<button class="admin-tab" type="button" data-tab="' +
			key +
			'" aria-current="' +
			(state.activeTab === key ? "page" : "false") +
			'">' +
			label +
			"</button>"
		);
	};

	const siteOptions = (state.sites ?? [])
		.map(function (site) {
			return (
				'<option value="' +
				escapeAttribute(site.siteKey) +
				'"' +
				(site.siteKey === state.currentSiteKey ? " selected" : "") +
				">" +
				escapeHtml(site.name) +
				"</option>"
			);
		})
		.join("");

	return (
		'<div class="admin-shell">' +
		'<aside class="admin-sidebar">' +
		'<div><h1>QingYan Admin</h1><p>管理员登录每次都需要验证码。连续 5 次错误会直接永久封禁当前 IP。</p></div>' +
		'<div class="admin-tab-list">' +
		tabButton("comments", "评论管理") +
		tabButton("pages", "页面管理") +
		tabButton("users", "用户管理") +
		tabButton("visitors", "访客管理") +
		tabButton("blacklist", "黑名单") +
		tabButton("sites", "站点管理") +
		tabButton("settings", "运行时设置") +
		tabButton("system", "系统设置") +
		"</div>" +
		"</aside>" +
		'<main class="admin-shell-main">' +
		'<header class="admin-topbar">' +
		'<div><h2>管理后台</h2><p>当前站点：' +
		escapeHtml(state.currentSiteKey || "未选择") +
		"</p></div>" +
		'<div class="admin-toolbar-actions">' +
		'<select id="admin-site-select">' +
		siteOptions +
		"</select>" +
		'<button class="admin-button-secondary" id="admin-refresh-tab" type="button">刷新当前页</button>' +
		'<button class="admin-button-danger" id="admin-logout-button" type="button">退出登录</button>' +
		"</div>" +
		"</header>" +
		renderMessage(state.shellMessage, "error") +
		'<section class="admin-stat-grid">' +
		statsHtml +
		"</section>" +
		sectionHtml +
		"</main>" +
		"</div>"
	);
}

function render() {
	const root = document.getElementById("admin-root");
	if (!root) {
		return;
	}

	root.innerHTML = state.authenticated ? renderShell() : renderLogin();

	if (!state.authenticated) {
		document
			.getElementById("admin-login-button")
			?.addEventListener("click", async function () {
				const tokenInput = document.getElementById("admin-token");
				const captchaInput = document.getElementById("admin-captcha-value");
				await login(tokenInput?.value ?? "", captchaInput?.value ?? "");
			});
		document
			.getElementById("admin-refresh-captcha")
			?.addEventListener("click", async function () {
				state.loginChallenge = null;
				await loadCaptcha();
			});
		return;
	}

	document.querySelectorAll("[data-tab]").forEach(function (button) {
		button.addEventListener("click", async function () {
			state.activeTab = button.getAttribute("data-tab");
			await loadActiveTab();
		});
	});

	document
		.getElementById("admin-site-select")
		?.addEventListener("change", async function (event) {
			state.currentSiteKey = event.target.value;
			await loadActiveTab();
		});

	document
		.getElementById("admin-refresh-tab")
		?.addEventListener("click", async function () {
			await loadActiveTab();
		});

	document
		.getElementById("admin-logout-button")
		?.addEventListener("click", async function () {
			await logout();
		});

	document
		.getElementById("comments-filter-form")
		?.addEventListener("submit", async function (event) {
			event.preventDefault();
			const formData = new FormData(event.currentTarget);
			state.commentFilters.status = String(formData.get("status") ?? "");
			state.commentFilters.pageKey = String(formData.get("pageKey") ?? "");
			state.commentFilters.search = String(formData.get("search") ?? "");
			state.commentFilters.limit = Number(formData.get("limit") ?? 20) || 20;
			state.commentFilters.offset = 0;
			await loadActiveTab();
		});

	document.querySelectorAll("[data-comment-action]").forEach(function (button) {
		button.addEventListener("click", async function () {
			const action = button.getAttribute("data-comment-action");
			const commentId = button.getAttribute("data-comment-id");
			if (!commentId) {
				return;
			}

			try {
				if (action === "delete") {
					await removeComment(commentId);
					return;
				}

				if (action === "status") {
					await updateComment(commentId, {
						status: button.getAttribute("data-comment-status"),
					});
					return;
				}

				if (action === "pin") {
					await updateComment(commentId, {
						isPinned: button.getAttribute("data-comment-value") === "true",
					});
					return;
				}

				if (action === "fold") {
					await updateComment(commentId, {
						isFolded: button.getAttribute("data-comment-value") === "true",
					});
				}
			} catch (error) {
				state.shellMessage = error.message;
				render();
			}
		});
	});

	document
		.getElementById("blacklist-form")
		?.addEventListener("submit", async function (event) {
			event.preventDefault();
			try {
				await createBlacklist(new FormData(event.currentTarget));
			} catch (error) {
				state.shellMessage = error.message;
				render();
			}
		});

	document.querySelectorAll("[data-blacklist-delete]").forEach(function (button) {
		button.addEventListener("click", async function () {
			try {
				await removeBlacklistRule(
					button.getAttribute("data-blacklist-delete"),
				);
			} catch (error) {
				state.shellMessage = error.message;
				render();
			}
		});
	});

	document
		.getElementById("settings-form")
		?.addEventListener("submit", async function (event) {
			event.preventDefault();
			try {
				await saveSettings(new FormData(event.currentTarget));
			} catch (error) {
				state.shellMessage = error.message;
				render();
			}
		});

	document
		.getElementById("system-settings-form")
		?.addEventListener("submit", async function (event) {
			event.preventDefault();
			try {
				await saveSystemSettings(new FormData(event.currentTarget));
			} catch (error) {
				state.shellMessage = error.message;
				render();
			}
		});

	document
		.querySelectorAll("[data-open-comments-page]")
		.forEach(function (button) {
			button.addEventListener("click", async function () {
				state.activeTab = "comments";
				state.commentFilters.pageKey =
					button.getAttribute("data-open-comments-page") ?? "";
				state.commentFilters.search = "";
				state.commentFilters.offset = 0;
				await loadActiveTab();
			});
		});

	document
		.querySelectorAll("[data-open-comments-search]")
		.forEach(function (button) {
			button.addEventListener("click", async function () {
				state.activeTab = "comments";
				state.commentFilters.search =
					button.getAttribute("data-open-comments-search") ?? "";
				state.commentFilters.pageKey = "";
				state.commentFilters.offset = 0;
				await loadActiveTab();
			});
		});

	document.querySelectorAll("[data-open-site-tab]").forEach(function (button) {
		button.addEventListener("click", async function () {
			state.currentSiteKey = button.getAttribute("data-open-site-key") ?? "";
			state.activeTab = button.getAttribute("data-open-site-tab") ?? "settings";
			await loadActiveTab();
		});
	});
}

void bootstrap();
`;
}
