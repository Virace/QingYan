import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createBlacklist,
	deleteBlacklist,
	getSettings,
	getSystemSettings,
	listBlacklist,
	type AdminSettings,
	type AdminSystemSettings,
	updateSettings,
	updateSystemSettings,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import {
	EmptyState,
	Field,
	SettingsSection,
	SettingsSubsection,
	inputClass,
	textareaClass,
} from "./admin-ui";
import { useAdminConfirmDialog } from "./confirm-dialog";
import {
	blacklistMatchModeLabels,
	blacklistTargetTypeLabels,
	captchaProviderLabels,
	ipRegionCachePolicyLabels,
	labelFor,
	loggingLevelLabels,
	recaptchaVariantLabels,
	scopeLabels,
} from "./display-labels";
import { PaginationControls } from "./admin-pagination";

export function BlacklistPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [targetValue, setTargetValue] = useState("");
	const [reason, setReason] = useState("");
	const [search, setSearch] = useState("");
	const [limit, setLimitState] = useState(20);
	const [pageIndex, setPageIndex] = useState(0);
	const offset = pageIndex * limit;
	const setLimit = (nextLimit: number) => {
		setLimitState(nextLimit);
		setPageIndex(0);
	};
	const [targetType, setTargetType] = useState<"ip" | "email" | "visitor">(
		"email",
	);
	const [matchMode, setMatchMode] = useState<"exact" | "cidr" | "wildcard">(
		"exact",
	);
	const [scope, setScope] = useState<"post" | "all">("post");
	const query = useQuery({
		queryKey: ["admin", "blacklist", siteKey, search, limit, offset],
		queryFn: () => listBlacklist({ siteKey, search, limit, offset }),
	});
	const createMutation = useMutation({
		mutationFn: createBlacklist,
		onSuccess() {
			setTargetValue("");
			setReason("");
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});
	const deleteMutation = useMutation({
		mutationFn: deleteBlacklist,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin"] }),
	});
	const removeRule = async (ruleId: number) => {
		const confirmed = await confirm({
			title: "删除黑名单规则",
			description: "确认删除这条黑名单规则？删除后目标会恢复评论或访问能力。",
			confirmText: "删除规则",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		deleteMutation.mutate(ruleId);
	};

	return (
		<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">新增黑名单</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!targetValue.trim()) {
								return;
							}
							createMutation.mutate({
								siteKey,
								targetType,
								matchMode,
								scope,
								targetValue,
								reason: reason || undefined,
							});
						}}
					>
						<Field label="目标类型">
							<select
								className={inputClass}
								value={targetType}
								onChange={(event) =>
									setTargetType(event.target.value as typeof targetType)
								}
							>
								<option value="email">邮箱</option>
								<option value="visitor">访客</option>
								<option value="ip">IP</option>
							</select>
						</Field>
						<Field label="匹配模式">
							<select
								className={inputClass}
								value={matchMode}
								onChange={(event) =>
									setMatchMode(event.target.value as typeof matchMode)
								}
							>
								<option value="exact">精确</option>
								<option value="wildcard">通配</option>
								<option value="cidr">CIDR</option>
							</select>
						</Field>
						<Field label="作用域">
							<select
								className={inputClass}
								value={scope}
								onChange={(event) =>
									setScope(event.target.value as typeof scope)
								}
							>
								<option value="post">当前页面</option>
								<option value="all">全局</option>
							</select>
						</Field>
						<Field label="目标值">
							<Input
								value={targetValue}
								onChange={(event) => setTargetValue(event.target.value)}
							/>
						</Field>
						<Field label="原因">
							<Input
								value={reason}
								onChange={(event) => setReason(event.target.value)}
							/>
						</Field>
						<Button type="submit" disabled={createMutation.isPending}>
							新增规则
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">黑名单规则</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-3">
					<Input
						placeholder="搜索黑名单"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							setPageIndex(0);
						}}
					/>
					<PaginationControls
						limit={limit}
						pageIndex={pageIndex}
						totalCount={query.data?.pagination.totalCount ?? 0}
						itemCount={query.data?.items.length ?? 0}
						setLimit={setLimit}
						setPageIndex={setPageIndex}
					/>
					{query.data?.items.map((rule) => (
						<div key={rule.id} className="rounded-md border p-3">
							<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
								<div>
									<p className="font-medium">{rule.targetValue}</p>
									<p className="text-xs text-muted-foreground">
										{labelFor(blacklistTargetTypeLabels, rule.targetType)} /{" "}
										{labelFor(blacklistMatchModeLabels, rule.matchMode)} /{" "}
										{labelFor(scopeLabels, rule.scope)}
									</p>
								</div>
								<Button
									type="button"
									size="sm"
									variant="destructive"
									onClick={() => void removeRule(rule.id)}
								>
									删除
								</Button>
							</div>
						</div>
					))}
					{query.data?.items.length === 0 ? (
						<EmptyState text="暂无黑名单规则" />
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}

export function SiteSettingsPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const resolvedSiteKey = siteKey ?? "";
	const query = useQuery({
		queryKey: ["admin", "settings", resolvedSiteKey],
		queryFn: () => getSettings(resolvedSiteKey),
		enabled: Boolean(resolvedSiteKey),
	});
	const [draft, setDraft] = useState<AdminSettings | null>(null);
	const mutation = useMutation({
		mutationFn: (input: AdminSettings) => updateSettings(input.siteKey, input),
		onSuccess: (settings) => {
			setDraft(settings);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
		}
	}, [query.data]);

	if (!draft) {
		if (!resolvedSiteKey) {
			return <EmptyState text="请选择站点" />;
		}
		if (query.isError) {
			const error = query.error;
			const message =
				error instanceof ApiError
					? `${error.message}${error.code ? ` (${error.code})` : ""}`
					: "站点设置加载失败。";
			return <EmptyState text={message} />;
		}
		return <EmptyState text="加载中" />;
	}

	const commentRequire = draft.comments.identity.require ?? [];
	const updateRequire = (
		field: "nickname" | "email" | "website",
		checked: boolean,
	) => {
		const nextRequire = checked
			? Array.from(new Set([...commentRequire, field]))
			: commentRequire.filter((value) => value !== field);
		setDraft({
			...draft,
			comments: {
				...draft.comments,
				identity: {
					...draft.comments.identity,
					require: nextRequire,
				},
			},
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">站点设置</CardTitle>
				<CardDescription>{draft.siteKey}</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						mutation.mutate(draft);
					}}
				>
					<Field label="评论开关">
						<select
							className={inputClass}
							value={String(draft.comments.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										enabled: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="默认状态">
						<select
							className={inputClass}
							value={draft.comments.defaultStatus}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										defaultStatus: event.target.value as "pending" | "approved",
									},
								})
							}
						>
							<option value="pending">待审</option>
							<option value="approved">直接通过</option>
						</select>
					</Field>
					<SettingsSection
						title="评论审核"
						description="审核模式属于当前站点；Akismet 会自动使用站点前端 Origin 作为 Blog URL。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field
								label="审核模式"
								description="纯手动只进入待审；Akismet 自动审核可直接通过正常评论并拦截垃圾评论。"
							>
								<select
									className={inputClass}
									value={draft.comments.moderation.mode}
									onChange={(event) => {
										const mode = event.target
											.value as AdminSettings["comments"]["moderation"]["mode"];
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												moderation: {
													...draft.comments.moderation,
													mode,
													provider:
														mode === "akismet_auto" ||
														mode === "manual_with_akismet"
															? "akismet"
															: "none",
												},
											},
										});
									}}
								>
									<option value="manual">纯手动审核</option>
									<option value="none">不审核，直接通过</option>
									<option value="akismet_auto">Akismet 自动审核</option>
									<option value="manual_with_akismet">
										手动审核 + Akismet 辅助
									</option>
								</select>
							</Field>
						</div>
					</SettingsSection>
					<Field label="验证码模式">
						<select
							className={inputClass}
							value={draft.comments.captcha.mode}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											mode: event.target.value as
												| "never"
												| "always"
												| "threshold",
										},
									},
								})
							}
						>
							<option value="never">从不</option>
							<option value="always">总是</option>
							<option value="threshold">阈值</option>
						</select>
					</Field>
					<Field label="阈值动作次数">
						<Input
							type="number"
							min={1}
							value={draft.comments.captcha.thresholdMaxActions}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											thresholdMaxActions: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="阈值窗口（秒）">
						<Input
							type="number"
							min={1}
							value={draft.comments.captcha.thresholdWindowSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										captcha: {
											...draft.comments.captcha,
											thresholdWindowSec: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="评论最大深度">
						<Input
							type="number"
							min={1}
							value={draft.comments.maxDepth}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										maxDepth: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="根评论分页">
						<Input
							type="number"
							min={1}
							value={draft.comments.rootLimit}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										rootLimit: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="允许作者站点">
						<select
							className={inputClass}
							value={String(draft.comments.allowWebsite)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										allowWebsite: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">允许</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<SettingsSection
						title="评论身份必填项"
						description="控制普通访客提交评论时必须提供哪些身份字段。"
					>
						<div className="grid gap-2 md:grid-cols-3">
							{(["nickname", "email", "website"] as const).map((field) => (
								<label
									key={field}
									className="flex items-center justify-between rounded-md border p-3 text-sm"
								>
									<span>
										{field === "nickname"
											? "昵称"
											: field === "email"
												? "邮箱"
												: "站点"}
									</span>
									<input
										type="checkbox"
										checked={commentRequire.includes(field)}
										disabled={
											field === "website" && !draft.comments.allowWebsite
										}
										onChange={(event) =>
											updateRequire(field, event.target.checked)
										}
									/>
								</label>
							))}
						</div>
					</SettingsSection>
					<SettingsSection
						title="可信评论作者"
						description="管理员登录后可作为站点人员回复；公开展示会按这里的 badge 和显示名策略处理。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用可信作者">
								<select
									className={inputClass}
									value={String(draft.comments.verifiedAuthor.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												verifiedAuthor: {
													...draft.comments.verifiedAuthor,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="显示名称">
								<Input
									value={draft.comments.verifiedAuthor.displayName}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												verifiedAuthor: {
													...draft.comments.verifiedAuthor,
													displayName: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="邮箱">
								<Input
									type="email"
									value={draft.comments.verifiedAuthor.email}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												verifiedAuthor: {
													...draft.comments.verifiedAuthor,
													email: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="作者主页 URL">
								<Input
									value={draft.comments.verifiedAuthor.website}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												verifiedAuthor: {
													...draft.comments.verifiedAuthor,
													website: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="Badge 文案">
								<Input
									value={draft.comments.verifiedAuthor.badgeLabel}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												verifiedAuthor: {
													...draft.comments.verifiedAuthor,
													badgeLabel: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="站点人员显示名">
								<select
									className={inputClass}
									value={draft.comments.staffDisplay.nameMode}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												staffDisplay: {
													nameMode: event.target
														.value as AdminSettings["comments"]["staffDisplay"]["nameMode"],
												},
											},
										})
									}
								>
									<option value="current_profile">跟随当前资料</option>
									<option value="snapshot">保留评论快照</option>
								</select>
							</Field>
						</div>
					</SettingsSection>
					<Field label="滥用防护">
						<select
							className={inputClass}
							value={String(draft.comments.abuseGuard.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											enabled: event.target.value === "true",
										},
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field
						label="滥用检测窗口（秒）"
						description="统计同一 IP 的公开写操作时长窗口。"
					>
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.windowSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											windowSec: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field
						label="窗口内最大写操作次数"
						description="单位是次数；评论提交、评论投票等公开写操作都会计入。"
					>
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.maxWriteActions}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											maxWriteActions: Number(event.target.value),
										},
									},
								})
							}
						/>
					</Field>
					<Field label="自动拉黑">
						<select
							className={inputClass}
							value={String(draft.comments.abuseGuard.autoBlacklist.enabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												enabled: event.target.value === "true",
											},
										},
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="自动拉黑作用域">
						<select
							className={inputClass}
							value={draft.comments.abuseGuard.autoBlacklist.scope}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												scope: event.target.value as "post" | "all",
											},
										},
									},
								})
							}
						>
							<option value="post">当前页面</option>
							<option value="all">全局</option>
						</select>
					</Field>
					<Field label="自动拉黑 TTL（秒）">
						<Input
							type="number"
							min={1}
							value={draft.comments.abuseGuard.autoBlacklist.ttlSec}
							onChange={(event) =>
								setDraft({
									...draft,
									comments: {
										...draft.comments,
										abuseGuard: {
											...draft.comments.abuseGuard,
											autoBlacklist: {
												...draft.comments.abuseGuard.autoBlacklist,
												ttlSec: Number(event.target.value),
											},
										},
									},
								})
							}
						/>
					</Field>
					<SettingsSection
						title="请求元数据"
						description="原始 IP 和 User-Agent 只用于后台记录、反滥用和解析；公开接口只返回按开关整理后的地区和设备信息。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="记录 IP" description="关闭后不保存原始请求 IP。">
								<select
									className={inputClass}
									value={String(draft.comments.metadata.collectIp)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													collectIp: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field
								label="记录 User-Agent"
								description="关闭后不保存原始浏览器 User-Agent，也不解析设备信息。"
							>
								<select
									className={inputClass}
									value={String(draft.comments.metadata.collectUserAgent)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													collectUserAgent: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field
								label="IP 地域解析"
								description="公开展示还需要系统设置中的 IP 数据库总开关开启。"
							>
								<select
									className={inputClass}
									value={String(draft.comments.metadata.ipRegion.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														enabled: event.target.value === "true",
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field
								label="地域精度"
								description="控制公开 location.label 的粒度。"
							>
								<select
									className={inputClass}
									value={draft.comments.metadata.ipRegion.precision}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													ipRegion: {
														...draft.comments.metadata.ipRegion,
														precision: event.target.value as
															| "country"
															| "province"
															| "city",
													},
												},
											},
										})
									}
								>
									<option value="country">国家</option>
									<option value="province">省份</option>
									<option value="city">城市</option>
								</select>
							</Field>
							<Field
								label="设备解析"
								description="解析为浏览器、系统、设备类型等结构化字段。"
							>
								<select
									className={inputClass}
									value={String(draft.comments.metadata.device.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													device: {
														...draft.comments.metadata.device,
														enabled: event.target.value === "true",
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field
								label="前台显示设备信息"
								description="公开接口返回结构化设备字段，图标由前端自行适配。"
							>
								<select
									className={inputClass}
									value={String(draft.comments.metadata.device.display.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											comments: {
												...draft.comments,
												metadata: {
													...draft.comments.metadata,
													device: {
														...draft.comments.metadata.device,
														display: {
															...draft.comments.metadata.device.display,
															enabled: event.target.value === "true",
														},
													},
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
						</div>
					</SettingsSection>
					<Field label="页面点赞">
						<select
							className={inputClass}
							value={String(draft.pageFeedback.allowLike)}
							onChange={(event) =>
								setDraft({
									...draft,
									pageFeedback: {
										allowLike: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">允许</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<Field label="邮件通知">
						<select
							className={inputClass}
							value={String(draft.notifications.emailEnabled)}
							onChange={(event) =>
								setDraft({
									...draft,
									notifications: {
										emailEnabled: event.target.value === "true",
									},
								})
							}
						>
							<option value="true">启用</option>
							<option value="false">关闭</option>
						</select>
					</Field>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							保存站点设置
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function withoutEmptySecrets(
	settings: AdminSystemSettings,
): AdminSystemSettings {
	const next = structuredClone(settings);
	if (next.mail.smtp.password === "") {
		delete next.mail.smtp.password;
	}
	if (next.captcha.turnstile.secretKey === "") {
		delete next.captcha.turnstile.secretKey;
	}
	if (next.captcha.hcaptcha.secretKey === "") {
		delete next.captcha.hcaptcha.secretKey;
	}
	if (next.captcha.recaptcha.apiKey === "") {
		delete next.captcha.recaptcha.apiKey;
	}
	if (next.captcha.geetest.captchaKey === "") {
		delete next.captcha.geetest.captchaKey;
	}
	if (next.antiSpam.akismet.apiKey === "") {
		delete next.antiSpam.akismet.apiKey;
	}

	return next;
}

function secretPlaceholder(configured: boolean) {
	return configured ? "已配置，留空则保留" : "";
}

export function SystemSettingsPage() {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: ["admin", "system-settings"],
		queryFn: getSystemSettings,
	});
	const [draft, setDraft] = useState<AdminSystemSettings | null>(null);
	const mutation = useMutation({
		mutationFn: updateSystemSettings,
		onSuccess: (settings) => {
			setDraft(settings);
			void queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
		}
	}, [query.data]);

	if (!draft) {
		return <EmptyState text="加载中" />;
	}

	const updateAvatar = (avatar: AdminSystemSettings["avatar"]) =>
		setDraft({
			...draft,
			avatar,
		});
	const updatePublicApi = (publicApi: AdminSystemSettings["publicApi"]) =>
		setDraft({
			...draft,
			publicApi,
		});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">系统设置</CardTitle>
				<CardDescription>全局日志级别与保留策略。</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						mutation.mutate(withoutEmptySecrets(draft));
					}}
				>
					<Field label="日志等级">
						<select
							className={inputClass}
							value={draft.logging.level}
							onChange={(event) =>
								setDraft({
									...draft,
									logging: {
										...draft.logging,
										level: event.target
											.value as AdminSystemSettings["logging"]["level"],
									},
								})
							}
						>
							<option value="error">{loggingLevelLabels.error}</option>
							<option value="warn">{loggingLevelLabels.warn}</option>
							<option value="info">{loggingLevelLabels.info}</option>
							<option value="debug">{loggingLevelLabels.debug}</option>
						</select>
					</Field>
					<Field label="保留天数">
						<Input
							type="number"
							min={1}
							max={3650}
							value={draft.logging.retentionDays}
							onChange={(event) =>
								setDraft({
									...draft,
									logging: {
										...draft.logging,
										retentionDays: Number(event.target.value),
									},
								})
							}
						/>
					</Field>
					<Field label="日志目录">
						<Input value={draft.logging.directory} readOnly />
					</Field>
					<SettingsSection
						title="后台会话"
						description="新登录会话使用这里的有效期；已签发的会话保持原有过期时间。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field
								label="Cookie Session 有效期（分钟）"
								description="默认 4320 分钟，即 3 天。"
							>
								<Input
									type="number"
									min={1}
									value={draft.admin.session.ttlMinutes}
									onChange={(event) =>
										setDraft({
											...draft,
											admin: {
												session: {
													...draft.admin.session,
													ttlMinutes: Number(event.target.value),
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</SettingsSection>
					<SettingsSection
						title="安全与来源控制"
						description="保存后立即影响运行中的请求校验；修改后台来源限制前，请确认当前管理后台 Origin 已包含在允许列表内。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用后台 Origin Guard">
								<select
									className={inputClass}
									value={String(draft.security.adminOriginGuard.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												adminOriginGuard: {
													...draft.security.adminOriginGuard,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="允许后台请求缺失 Origin">
								<select
									className={inputClass}
									value={String(
										draft.security.adminOriginGuard.allowMissingOrigin,
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												adminOriginGuard: {
													...draft.security.adminOriginGuard,
													allowMissingOrigin: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="false">关闭</option>
									<option value="true">允许</option>
								</select>
							</Field>
							<Field
								label="后台允许 Origin"
								description="每行一个纯 Origin，例如 https://admin.example.com。留空时默认只允许 QingYan publicBaseUrl 的 origin。"
							>
								<textarea
									className={textareaClass}
									placeholder="留空则使用 QingYan 公开访问地址"
									value={draft.security.adminOriginGuard.allowedOrigins.join(
										"\n",
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												adminOriginGuard: {
													...draft.security.adminOriginGuard,
													allowedOrigins: event.target.value
														.split(/\r?\n|,/)
														.map((value) => value.trim())
														.filter(Boolean),
												},
											},
										})
									}
								/>
							</Field>
							<Field
								label="启用公开 Origin Guard"
								description="公开写接口会校验请求 Origin 是否匹配站点配置的前端 Origin。"
							>
								<select
									className={inputClass}
									value={String(draft.security.publicOriginGuard.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												publicOriginGuard: {
													...draft.security.publicOriginGuard,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="允许公开写请求缺失 Origin">
								<select
									className={inputClass}
									value={String(
										draft.security.publicOriginGuard.allowMissingOrigin,
									)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												publicOriginGuard: {
													...draft.security.publicOriginGuard,
													allowMissingOrigin: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="false">关闭</option>
									<option value="true">允许</option>
								</select>
							</Field>
							<Field label="启用全局 Flood Guard">
								<select
									className={inputClass}
									value={String(draft.security.globalFloodGuard.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												globalFloodGuard: {
													...draft.security.globalFloodGuard,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="Flood 窗口秒">
								<Input
									type="number"
									min={1}
									value={draft.security.globalFloodGuard.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												globalFloodGuard: {
													...draft.security.globalFloodGuard,
													windowSec: Number(event.target.value),
												},
											},
										})
									}
								/>
							</Field>
							<Field label="Flood 最大请求">
								<Input
									type="number"
									min={1}
									value={draft.security.globalFloodGuard.maxRequests}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												globalFloodGuard: {
													...draft.security.globalFloodGuard,
													maxRequests: Number(event.target.value),
												},
											},
										})
									}
								/>
							</Field>
						</div>
						<SettingsSubsection
							title="频率限制"
							description="窗口字段单位均为秒；最大请求和最大失败字段单位均为次数。"
						>
							<Field label="管理员登录窗口（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.adminLogin.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													adminLogin: {
														...draft.security.rateLimit.adminLogin,
														windowSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="管理员登录最大失败次数">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.adminLogin.maxFailures}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													adminLogin: {
														...draft.security.rateLimit.adminLogin,
														maxFailures: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="管理员失败封禁时长（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.adminLogin.autoBlacklistSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													adminLogin: {
														...draft.security.rateLimit.adminLogin,
														autoBlacklistSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="评论创建窗口（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.commentCreate.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													commentCreate: {
														...draft.security.rateLimit.commentCreate,
														windowSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="评论创建最大请求次数">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.commentCreate.maxRequests}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													commentCreate: {
														...draft.security.rateLimit.commentCreate,
														maxRequests: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="评论投票窗口（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.commentVote.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													commentVote: {
														...draft.security.rateLimit.commentVote,
														windowSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="评论投票最大请求次数">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.commentVote.maxRequests}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													commentVote: {
														...draft.security.rateLimit.commentVote,
														maxRequests: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="验证码验证窗口（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.captchaVerify.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													captchaVerify: {
														...draft.security.rateLimit.captchaVerify,
														windowSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="验证码验证最大失败次数">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.captchaVerify.maxFailures}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													captchaVerify: {
														...draft.security.rateLimit.captchaVerify,
														maxFailures: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="页面点赞窗口（秒）">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.pageLike.windowSec}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													pageLike: {
														...draft.security.rateLimit.pageLike,
														windowSec: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
							<Field label="页面点赞最大请求次数">
								<Input
									type="number"
									min={1}
									value={draft.security.rateLimit.pageLike.maxRequests}
									onChange={(event) =>
										setDraft({
											...draft,
											security: {
												...draft.security,
												rateLimit: {
													...draft.security.rateLimit,
													pageLike: {
														...draft.security.rateLimit.pageLike,
														maxRequests: Number(event.target.value),
													},
												},
											},
										})
									}
								/>
							</Field>
						</SettingsSubsection>
					</SettingsSection>
					<SettingsSection
						title="头像 / 外部头像 URL"
						description="后端只返回 author.avatarUrl，不托管、不代理、不缓存头像图片。图片 404 或加载失败时由前端继续显示名称首字母或文字 fallback。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用外部头像 URL">
								<select
									className={inputClass}
									value={String(draft.avatar.external.enabled)}
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											external: {
												...draft.avatar.external,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="false">关闭</option>
									<option value="true">开启</option>
								</select>
							</Field>
							<Field
								label="头像接口地址"
								description="例如 https://gravatar.com/avatar 或 https://cravatar.cn/avatar。"
							>
								<Input
									value={draft.avatar.external.baseUrl}
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											external: {
												...draft.avatar.external,
												baseUrl: event.target.value,
											},
										})
									}
								/>
							</Field>
							<Field label="邮箱哈希算法">
								<select
									className={inputClass}
									value={draft.avatar.external.hashAlgorithm}
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											external: {
												...draft.avatar.external,
												hashAlgorithm: event.target
													.value as AdminSystemSettings["avatar"]["external"]["hashAlgorithm"],
											},
										})
									}
								>
									<option value="sha256">SHA-256</option>
									<option value="md5">MD5</option>
								</select>
							</Field>
							<Field
								label="头像 URL 参数"
								description="参数不包含开头的 ?，多个参数用 & 分隔。Gravatar 常用 SHA-256 和 s=80&d=404&r=g；Cravatar 当前文档使用 MD5。"
							>
								<Input
									value={draft.avatar.external.query}
									placeholder="s=80&d=404&r=g"
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											external: {
												...draft.avatar.external,
												query: event.target.value,
											},
										})
									}
								/>
							</Field>
							<Field label="头像形状">
								<select
									className={inputClass}
									value={draft.avatar.display.shape}
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											display: {
												...draft.avatar.display,
												shape: event.target
													.value as AdminSystemSettings["avatar"]["display"]["shape"],
											},
										})
									}
								>
									<option value="circle">圆形</option>
									<option value="rounded">圆角</option>
									<option value="square">方形</option>
								</select>
							</Field>
							<Field
								label="显示尺寸"
								description="前端建议显示尺寸，范围 16 到 256。"
							>
								<Input
									type="number"
									min={16}
									max={256}
									value={draft.avatar.display.sizePx}
									onChange={(event) =>
										updateAvatar({
											...draft.avatar,
											display: {
												...draft.avatar.display,
												sizePx: Number(event.target.value),
											},
										})
									}
								/>
							</Field>
						</div>
					</SettingsSection>
					<SettingsSection
						title="公开 API"
						description="控制公开评论接口是否返回非必要的展示建议字段。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field
								label="返回建议字段"
								description="关闭时公开评论接口不返回头像形状、显示尺寸等前端展示建议。"
							>
								<select
									className={inputClass}
									value={String(draft.publicApi.advisoryFields.enabled)}
									onChange={(event) =>
										updatePublicApi({
											...draft.publicApi,
											advisoryFields: {
												...draft.publicApi.advisoryFields,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="false">关闭</option>
									<option value="true">开启</option>
								</select>
							</Field>
						</div>
					</SettingsSection>
					<SettingsSection
						title="邮件通知"
						description="配置 SMTP 后可用于后续评论通知能力；密码留空时保留已有密钥。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="启用邮件通知">
								<select
									className={inputClass}
									value={String(draft.mail.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="SMTP Host">
								<Input
									value={draft.mail.smtp.host}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													host: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP Port">
								<Input
									type="number"
									min={1}
									value={draft.mail.smtp.port}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													port: Number(event.target.value),
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP 加密连接 Secure">
								<select
									className={inputClass}
									value={String(draft.mail.smtp.secure)}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													secure: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="SMTP 用户名">
								<Input
									value={draft.mail.smtp.username}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													username: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="发件人">
								<Input
									value={draft.mail.smtp.from}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													from: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="SMTP 密码">
								<Input
									type="password"
									autoComplete="new-password"
									placeholder={secretPlaceholder(
										draft.mail.smtp.passwordConfigured,
									)}
									value={draft.mail.smtp.password ?? ""}
									onChange={(event) =>
										setDraft({
											...draft,
											mail: {
												...draft.mail,
												smtp: {
													...draft.mail.smtp,
													password: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</SettingsSection>
					<SettingsSection
						title="验证码服务"
						description="选择公开评论写操作使用的验证码提供方；密钥字段留空时保留已有配置。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="验证码服务">
								<select
									className={inputClass}
									value={draft.captcha.provider}
									onChange={(event) =>
										setDraft({
											...draft,
											captcha: {
												...draft.captcha,
												provider: event.target
													.value as AdminSystemSettings["captcha"]["provider"],
											},
										})
									}
								>
									<option value="image">{captchaProviderLabels.image}</option>
									<option value="turnstile">
										{captchaProviderLabels.turnstile}
									</option>
									<option value="hcaptcha">
										{captchaProviderLabels.hcaptcha}
									</option>
									<option value="recaptcha">
										{captchaProviderLabels.recaptcha}
									</option>
									<option value="geetest">
										{captchaProviderLabels.geetest}
									</option>
								</select>
							</Field>
						</div>
						{draft.captcha.provider === "image" ? (
							<SettingsSubsection title="内置图片验证码">
								<Field label="图片宽度">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.width}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														width: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
								<Field label="图片高度">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.height}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														height: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
								<Field label="图片 TTL 秒">
									<Input
										type="number"
										min={1}
										value={draft.captcha.image.ttlSec}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													image: {
														...draft.captcha.image,
														ttlSec: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
							</SettingsSubsection>
						) : null}
						{draft.captcha.provider === "turnstile" ? (
							<SettingsSubsection title="Cloudflare Turnstile">
								<Field label="Turnstile Site Key">
									<Input
										value={draft.captcha.turnstile.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Secret Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.turnstile.secretKeyConfigured,
										)}
										value={draft.captcha.turnstile.secretKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														secretKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Action">
									<Input
										value={draft.captcha.turnstile.expectedAction}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														expectedAction: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="Turnstile Hostname">
									<Input
										value={draft.captcha.turnstile.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													turnstile: {
														...draft.captcha.turnstile,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</SettingsSubsection>
						) : null}
						{draft.captcha.provider === "hcaptcha" ? (
							<SettingsSubsection title="hCaptcha">
								<Field label="hCaptcha Site Key">
									<Input
										value={draft.captcha.hcaptcha.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="hCaptcha Secret Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.hcaptcha.secretKeyConfigured,
										)}
										value={draft.captcha.hcaptcha.secretKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														secretKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="hCaptcha Hostname">
									<Input
										value={draft.captcha.hcaptcha.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													hcaptcha: {
														...draft.captcha.hcaptcha,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</SettingsSubsection>
						) : null}
						{draft.captcha.provider === "recaptcha" ? (
							<SettingsSubsection title="Google reCAPTCHA">
								<Field label="reCAPTCHA 验证模式">
									<select
										className={inputClass}
										value={draft.captcha.recaptcha.variant}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														variant: event.target
															.value as AdminSystemSettings["captcha"]["recaptcha"]["variant"],
													},
												},
											})
										}
									>
										<option value="score_based">
											{recaptchaVariantLabels.score_based}
										</option>
										<option value="policy_based_challenge">
											{recaptchaVariantLabels.policy_based_challenge}
										</option>
									</select>
								</Field>
								<Field label="reCAPTCHA Project ID">
									<Input
										value={draft.captcha.recaptcha.projectId}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														projectId: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Site Key">
									<Input
										value={draft.captcha.recaptcha.siteKey}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														siteKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA API Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.recaptcha.apiKeyConfigured,
										)}
										value={draft.captcha.recaptcha.apiKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														apiKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Action">
									<Input
										value={draft.captcha.recaptcha.expectedAction}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														expectedAction: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA Hostname">
									<Input
										value={draft.captcha.recaptcha.expectedHostname ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														expectedHostname: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="reCAPTCHA 最低分数 Min Score">
									<Input
										type="number"
										min={0}
										max={1}
										step={0.01}
										value={draft.captcha.recaptcha.minScore}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													recaptcha: {
														...draft.captcha.recaptcha,
														minScore: Number(event.target.value),
													},
												},
											})
										}
									/>
								</Field>
							</SettingsSubsection>
						) : null}
						{draft.captcha.provider === "geetest" ? (
							<SettingsSubsection title="GeeTest">
								<Field label="GeeTest Captcha ID">
									<Input
										value={draft.captcha.geetest.captchaId}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														captchaId: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="GeeTest Captcha Key">
									<Input
										type="password"
										placeholder={secretPlaceholder(
											draft.captcha.geetest.captchaKeyConfigured,
										)}
										value={draft.captcha.geetest.captchaKey ?? ""}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														captchaKey: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
								<Field label="GeeTest API Server">
									<Input
										value={draft.captcha.geetest.apiServer}
										onChange={(event) =>
											setDraft({
												...draft,
												captcha: {
													...draft.captcha,
													geetest: {
														...draft.captcha.geetest,
														apiServer: event.target.value,
													},
												},
											})
										}
									/>
								</Field>
							</SettingsSubsection>
						) : null}
					</SettingsSection>
					<SettingsSection
						title="反垃圾服务"
						description="Akismet API Key 为全局密钥；具体站点是否使用 Akismet 在站点设置的评论审核中选择。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="Akismet API Key">
								<Input
									autoComplete="off"
									placeholder={secretPlaceholder(
										draft.antiSpam.akismet.apiKeyConfigured,
									)}
									value={draft.antiSpam.akismet.apiKey ?? ""}
									onChange={(event) =>
										setDraft({
											...draft,
											antiSpam: {
												...draft.antiSpam,
												akismet: {
													...draft.antiSpam.akismet,
													apiKey: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</SettingsSection>
					<SettingsSection
						title="IP 数据库"
						description="系统总开关控制是否允许解析 IP 地域；站点设置仍决定具体站点是否公开展示整理后的地区。"
					>
						<div className="grid gap-4 md:grid-cols-2">
							<Field label="IP 地域解析">
								<select
									className={inputClass}
									value={String(draft.ipRegion.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												enabled: event.target.value === "true",
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="加载方式">
								<select
									className={inputClass}
									value={draft.ipRegion.cachePolicy}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												cachePolicy: event.target.value as
													| "file"
													| "vectorIndex"
													| "content",
											},
										})
									}
								>
									<option value="file">{ipRegionCachePolicyLabels.file}</option>
									<option value="vectorIndex">
										{ipRegionCachePolicyLabels.vectorIndex}
									</option>
									<option value="content">
										{ipRegionCachePolicyLabels.content}
									</option>
								</select>
							</Field>
							<Field label="默认地域精度">
								<select
									className={inputClass}
									value={draft.ipRegion.precision}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												precision: event.target.value as
													| "country"
													| "province"
													| "city",
											},
										})
									}
								>
									<option value="country">国家</option>
									<option value="province">省份</option>
									<option value="city">城市</option>
								</select>
							</Field>
							<Field label="每月自动更新">
								<select
									className={inputClass}
									value={String(draft.ipRegion.autoUpdate.enabled)}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												autoUpdate: {
													...draft.ipRegion.autoUpdate,
													enabled: event.target.value === "true",
												},
											},
										})
									}
								>
									<option value="true">启用</option>
									<option value="false">关闭</option>
								</select>
							</Field>
							<Field label="IPv4 数据库路径">
								<Input
									value={draft.ipRegion.ipv4.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv4: {
													...draft.ipRegion.ipv4,
													dbPath: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 数据库路径">
								<Input
									value={draft.ipRegion.ipv6.dbPath}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv6: {
													...draft.ipRegion.ipv6,
													dbPath: event.target.value,
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv4 下载源">
								<textarea
									className={textareaClass}
									value={draft.ipRegion.ipv4.sources.join("\n")}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv4: {
													...draft.ipRegion.ipv4,
													sources: event.target.value
														.split(/\r?\n/)
														.map((value) => value.trim())
														.filter(Boolean),
												},
											},
										})
									}
								/>
							</Field>
							<Field label="IPv6 下载源">
								<textarea
									className={textareaClass}
									value={draft.ipRegion.ipv6.sources.join("\n")}
									onChange={(event) =>
										setDraft({
											...draft,
											ipRegion: {
												...draft.ipRegion,
												ipv6: {
													...draft.ipRegion.ipv6,
													sources: event.target.value
														.split(/\r?\n/)
														.map((value) => value.trim())
														.filter(Boolean),
												},
											},
										})
									}
								/>
							</Field>
						</div>
					</SettingsSection>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							保存系统设置
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
