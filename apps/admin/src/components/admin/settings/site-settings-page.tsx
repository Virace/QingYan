import { useEffect, useState } from "react";
import { Tabs } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
	getSettings,
	listAdminUsers,
	patchAdminSiteSettingsSection,
	type AdminSettings,
	type SiteNotificationRecipient,
} from "@/api/admin";
import { adminUiErrorMessage } from "@/api/client";
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

import {
	BooleanField,
	EmptyState,
	Field,
	SettingsSection,
	SettingsToggleGroup,
	inputClass,
	textareaClass,
} from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	contentPolicyLabels,
	eligibleNotificationRecipientUsers,
	siteNotificationEventLabels,
} from "../content/notification-ui-model";
import { SiteNotificationRecipientDialog } from "./notification-settings-panels";
import {
	buildSettingsErrorModel,
	firstFieldError,
} from "./settings-error-model";
import {
	showCaptchaThresholdDetails,
	showLowTrustCounterHint,
} from "./settings-visibility";
import {
	SettingsSaveError,
	buildSiteSettingsSectionPayload,
	initialSettingsTab,
	isSameSettingsPayload,
	parseSitemapUrlList,
	replaceRecipient,
	replaceSettingsTabQuery,
	siteSectionSaveLabels,
	siteSettingsTabs,
	type SiteSettingsTab,
	updateRecipient,
} from "./settings-shared";
export function SiteSettingsPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const resolvedSiteKey = siteKey ?? "";
	const query = useQuery({
		queryKey: ["admin", "settings", resolvedSiteKey],
		queryFn: () => getSettings(resolvedSiteKey),
		enabled: Boolean(resolvedSiteKey),
	});
	const usersQuery = useQuery({
		queryKey: ["admin", "users", "notification-candidates", resolvedSiteKey],
		queryFn: () => listAdminUsers({ limit: 100 }),
		enabled: Boolean(resolvedSiteKey),
	});
	const [draft, setDraft] = useState<AdminSettings | null>(null);
	const [recipientDialog, setRecipientDialog] = useState<{
		mode: "create" | "edit";
		draft: SiteNotificationRecipient | null;
	} | null>(null);
	const [siteTab, setSiteTab] = useState<SiteSettingsTab>(() =>
		initialSettingsTab("siteTab", siteSettingsTabs, "comments"),
	);
	const mutation = useMutation({
		mutationFn: (input: { section: SiteSettingsTab; payload: unknown }) =>
			patchAdminSiteSettingsSection(
				resolvedSiteKey,
				input.section,
				input.payload,
			),
		meta: { suppressGlobalToast: true },
		onSuccess: (settings) => {
			setDraft(settings);
			queryClient.setQueryData(
				["admin", "settings", resolvedSiteKey],
				settings,
			);
			toast.success("站点设置已保存");
		},
		onError: (error) => {
			toast.error(adminUiErrorMessage(error, "站点设置保存失败。"));
		},
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
		}
	}, [query.data]);
	const setControlledSiteTab = (nextTab: string) => {
		const normalized = siteSettingsTabs.includes(nextTab as SiteSettingsTab)
			? (nextTab as SiteSettingsTab)
			: "comments";
		setSiteTab(normalized);
		replaceSettingsTabQuery("siteTab", normalized);
	};

	if (!draft) {
		if (!resolvedSiteKey) {
			return <EmptyState text="请选择站点" />;
		}
		if (query.isError) {
			const message = adminUiErrorMessage(query.error, "站点设置加载失败。");
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
	const updateEngagement = (
		key: keyof AdminSettings["engagement"],
		enabled: boolean,
	) => {
		const nextEngagement = {
			...draft.engagement,
			[key]: {
				...draft.engagement[key],
				enabled,
			},
		};
		setDraft({
			...draft,
			engagement: nextEngagement,
			pageFeedback:
				key === "pageLikes"
					? {
							allowLike: enabled,
						}
					: draft.pageFeedback,
		});
	};
	const saveError = buildSettingsErrorModel(
		mutation.error,
		"站点设置保存失败。",
	);
	const notificationRecipients = draft.notifications.backend.recipients ?? [];
	const notificationCandidateUsers = eligibleNotificationRecipientUsers(
		usersQuery.data?.users ?? [],
		draft.siteKey,
	).filter(
		(user) =>
			!notificationRecipients.some((recipient) => recipient.userId === user.id),
	);
	const setNotificationRecipients = (
		recipients: SiteNotificationRecipient[],
	) => {
		setDraft({
			...draft,
			notifications: {
				...draft.notifications,
				backend: {
					...draft.notifications.backend,
					recipients,
				},
			},
		});
	};
	const openRecipientCreateDialog = () =>
		setRecipientDialog({ mode: "create", draft: null });
	const openRecipientEditDialog = (recipient: SiteNotificationRecipient) =>
		setRecipientDialog({
			mode: "edit",
			draft: structuredClone(recipient),
		});
	const submitRecipientDialog = () => {
		if (!recipientDialog?.draft) {
			return;
		}
		const nextRecipients =
			recipientDialog.mode === "create"
				? [...notificationRecipients, recipientDialog.draft]
				: replaceRecipient(notificationRecipients, recipientDialog.draft);
		setNotificationRecipients(nextRecipients);
		setRecipientDialog(null);
	};
	const saveSiteSettingsSection = async () => {
		const nextPayload = buildSiteSettingsSectionPayload(siteTab, draft);
		const currentPayload = query.data
			? buildSiteSettingsSectionPayload(siteTab, query.data)
			: null;
		if (currentPayload && isSameSettingsPayload(currentPayload, nextPayload)) {
			toast.info("配置无变化");
			return;
		}
		if (
			siteTab === "pageRegistry" &&
			query.data?.pageRegistry.mode !== "authoritative" &&
			draft.pageRegistry.mode === "authoritative"
		) {
			const confirmed = await confirm({
				title: "切换到权威模式",
				description:
					"权威模式必须使用健康 sitemap 来源，RSS 或 Atom 不能单独作为权威来源；未登记页面将不再写入 pending 记录，默认只返回 inactive payload。",
				confirmText: "启用权威模式",
			});
			if (!confirmed) {
				return;
			}
		}
		mutation.mutate({
			section: siteTab,
			payload: nextPayload,
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
						void saveSiteSettingsSection();
					}}
				>
					<SettingsSaveError model={saveError} fallback="站点设置保存失败" />
					<Tabs.Root
						value={siteTab}
						onValueChange={setControlledSiteTab}
						className="md:col-span-2"
					>
						<Tabs.List>
							<Tabs.Trigger value="comments">评论</Tabs.Trigger>
							<Tabs.Trigger value="engagement">访客与计数</Tabs.Trigger>
							<Tabs.Trigger value="notifications">通知</Tabs.Trigger>
							<Tabs.Trigger value="pageRegistry">页面注册</Tabs.Trigger>
						</Tabs.List>
						<div className="pt-4">
							<Tabs.Content value="comments">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsToggleGroup
										title="评论"
										description="控制当前站点是否提供评论提交、评论列表和评论相关互动。"
										checked={draft.comments.enabled}
										error={firstFieldError(saveError, "comments.enabled")}
										onCheckedChange={(enabled) =>
											setDraft({
												...draft,
												comments: {
													...draft.comments,
													enabled,
												},
											})
										}
										disabledSummary="评论已关闭。已保存的审核、验证码、回复、表单和展示配置会保留，再次开启后继续使用。"
										testId="settings-group-comments"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<Field label="默认状态">
												<select
													className={inputClass}
													value={draft.comments.defaultStatus}
													onChange={(event) =>
														setDraft({
															...draft,
															comments: {
																...draft.comments,
																defaultStatus: event.target.value as
																	| "pending"
																	| "approved",
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
															<option value="akismet_auto">
																Akismet 自动审核
															</option>
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
											{showCaptchaThresholdDetails(draft) ? (
												<>
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
																			thresholdMaxActions: Number(
																				event.target.value,
																			),
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
																			thresholdWindowSec: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
												</>
											) : null}
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
											<BooleanField
												label="允许作者站点"
												checked={draft.comments.allowWebsite}
												onCheckedChange={(allowWebsite) =>
													setDraft({
														...draft,
														comments: {
															...draft.comments,
															allowWebsite,
														},
													})
												}
											/>
											<SettingsSection
												title="评论身份必填项"
												description="控制普通访客提交评论时必须提供哪些身份字段。"
											>
												<div className="grid gap-2 md:grid-cols-3">
													{(["nickname", "email", "website"] as const).map(
														(field) => (
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
																	aria-label={
																		field === "nickname"
																			? "昵称"
																			: field === "email"
																				? "邮箱"
																				: "站点"
																	}
																	checked={commentRequire.includes(field)}
																	disabled={
																		field === "website" &&
																		!draft.comments.allowWebsite
																	}
																	onChange={(event) =>
																		updateRequire(field, event.target.checked)
																	}
																/>
															</label>
														),
													)}
												</div>
											</SettingsSection>
											<SettingsSection
												title="可信评论作者"
												description="管理员登录后可作为站点人员回复；公开展示会按这里的 badge 和显示名策略处理。"
											>
												<div className="grid gap-4 md:grid-cols-2">
													<BooleanField
														label="启用可信作者"
														checked={draft.comments.verifiedAuthor.enabled}
														onCheckedChange={(enabled) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	verifiedAuthor: {
																		...draft.comments.verifiedAuthor,
																		enabled,
																	},
																},
															})
														}
													/>
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
															<option value="current_profile">
																跟随当前资料
															</option>
															<option value="snapshot">保留评论快照</option>
														</select>
													</Field>
												</div>
											</SettingsSection>
											<BooleanField
												label="滥用防护"
												checked={draft.comments.abuseGuard.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														comments: {
															...draft.comments,
															abuseGuard: {
																...draft.comments.abuseGuard,
																enabled,
															},
														},
													})
												}
											/>
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
											<BooleanField
												label="自动拉黑"
												checked={
													draft.comments.abuseGuard.autoBlacklist.enabled
												}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														comments: {
															...draft.comments,
															abuseGuard: {
																...draft.comments.abuseGuard,
																autoBlacklist: {
																	...draft.comments.abuseGuard.autoBlacklist,
																	enabled,
																},
															},
														},
													})
												}
											/>
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
													<BooleanField
														label="记录 IP"
														description="关闭后不保存原始请求 IP。"
														checked={draft.comments.metadata.collectIp}
														onCheckedChange={(collectIp) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	metadata: {
																		...draft.comments.metadata,
																		collectIp,
																	},
																},
															})
														}
													/>
													<BooleanField
														label="记录 User-Agent"
														description="关闭后不保存原始浏览器 User-Agent，也不解析设备信息。"
														checked={draft.comments.metadata.collectUserAgent}
														onCheckedChange={(collectUserAgent) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	metadata: {
																		...draft.comments.metadata,
																		collectUserAgent,
																	},
																},
															})
														}
													/>
													<BooleanField
														label="IP 地域解析"
														description="公开展示还需要系统设置中的 IP 数据库总开关开启。"
														checked={draft.comments.metadata.ipRegion.enabled}
														onCheckedChange={(enabled) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	metadata: {
																		...draft.comments.metadata,
																		ipRegion: {
																			...draft.comments.metadata.ipRegion,
																			enabled,
																		},
																	},
																},
															})
														}
													/>
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
													<BooleanField
														label="设备解析"
														description="解析为浏览器、系统、设备类型等结构化字段。"
														checked={draft.comments.metadata.device.enabled}
														onCheckedChange={(enabled) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	metadata: {
																		...draft.comments.metadata,
																		device: {
																			...draft.comments.metadata.device,
																			enabled,
																		},
																	},
																},
															})
														}
													/>
													<BooleanField
														label="前台显示设备信息"
														description="公开接口返回结构化设备字段，图标由前端自行适配。"
														checked={
															draft.comments.metadata.device.display.enabled
														}
														onCheckedChange={(enabled) =>
															setDraft({
																...draft,
																comments: {
																	...draft.comments,
																	metadata: {
																		...draft.comments.metadata,
																		device: {
																			...draft.comments.metadata.device,
																			display: {
																				...draft.comments.metadata.device
																					.display,
																				enabled,
																			},
																		},
																	},
																},
															})
														}
													/>
												</div>
											</SettingsSection>
										</div>
									</SettingsToggleGroup>
								</div>
							</Tabs.Content>
							<Tabs.Content value="engagement">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="访客与计数"
										description="访客记录决定 PV、点赞、投票是否能使用服务端可信去重。若需要可信统计，必须开启访客记录；若更重视隐私或轻量部署，可以关闭访客记录和相关计数。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<BooleanField
												label="访客记录"
												checked={draft.engagement.visitors.enabled}
												error={firstFieldError(
													saveError,
													"engagement.visitors.enabled",
												)}
												onCheckedChange={(enabled) =>
													updateEngagement("visitors", enabled)
												}
											/>
											<div className="rounded-md border p-3 text-sm text-muted-foreground">
												{draft.engagement.visitors.enabled
													? "开启后 QingYan 会记录访客 IP、UA 和访问页面，用于服务端可信去重、PV、点赞、投票和后续访客画像；数据量会随访问增长。"
													: "关闭后 QingYan 不记录访客身份，不提供访客画像；PV、点赞、投票如果开启，只是轻量低可信计数，不能防止重复刷新、重复点赞或重复投票。"}
											</div>
											<BooleanField
												label="页面浏览量"
												checked={draft.engagement.pageViews.enabled}
												error={firstFieldError(
													saveError,
													"engagement.pageViews.enabled",
												)}
												onCheckedChange={(enabled) =>
													updateEngagement("pageViews", enabled)
												}
											/>
											<BooleanField
												label="页面点赞"
												checked={draft.engagement.pageLikes.enabled}
												error={firstFieldError(
													saveError,
													"engagement.pageLikes.enabled",
												)}
												onCheckedChange={(enabled) =>
													updateEngagement("pageLikes", enabled)
												}
											/>
											<BooleanField
												label="评论投票"
												checked={draft.engagement.commentVotes.enabled}
												error={firstFieldError(
													saveError,
													"engagement.commentVotes.enabled",
												)}
												onCheckedChange={(enabled) =>
													updateEngagement("commentVotes", enabled)
												}
											/>
											{showLowTrustCounterHint(draft) ? (
												<div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
													<Badge variant="outline">低可信</Badge>
													<span>
														访客记录关闭时，已开启的计数只做轻量加 1，不使用
														visitorId 去重。
													</span>
												</div>
											) : null}
										</div>
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="notifications">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="评论者回复邮件通知"
										description="控制公开评论表单是否显示“有人回复时邮件通知我”。只影响普通评论者，不影响后台用户通知。"
									>
										<BooleanField
											label="允许评论者订阅回复邮件"
											description="系统邮件可用时，公开 bootstrap 会返回 replyEmailNotification=true，内容站点可显示订阅 checkbox。"
											checked={draft.notifications.commenter.replyEmailEnabled}
											error={firstFieldError(
												saveError,
												"notifications.commenter.replyEmailEnabled",
											)}
											onCheckedChange={(replyEmailEnabled) =>
												setDraft({
													...draft,
													notifications: {
														...draft.notifications,
														commenter: {
															...draft.notifications.commenter,
															replyEmailEnabled,
														},
													},
												})
											}
										/>
									</SettingsSection>
									<SettingsSection
										title="后台用户通知"
										description="控制 QingYan 后台用户是否接收站点通知。接收人引用后台用户，可使用邮件、Webhook 或 WxPusher。"
									>
										<div className="grid gap-3">
											<BooleanField
												label="启用后台用户通知"
												description="关闭后不再为后台用户创建站点通知任务；不影响普通评论者回复邮件订阅。"
												checked={draft.notifications.backend.enabled}
												error={firstFieldError(
													saveError,
													"notifications.backend.enabled",
												)}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														notifications: {
															...draft.notifications,
															backend: {
																...draft.notifications.backend,
																enabled,
															},
														},
													})
												}
											/>
											<div>
												<Button
													type="button"
													variant="outline"
													disabled={notificationCandidateUsers.length === 0}
													onClick={openRecipientCreateDialog}
												>
													添加接收人
												</Button>
											</div>
											{notificationRecipients.map((recipient) => (
												<div
													key={recipient.userId}
													className="grid gap-3 rounded-md border bg-background p-3"
												>
													<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
														<div>
															<p className="font-medium">
																{recipient.displayName || recipient.username}
															</p>
															<p className="text-xs text-muted-foreground">
																{recipient.username} / {recipient.email}
															</p>
															<p className="mt-1 text-xs text-muted-foreground">
																{recipient.routes
																	.map(
																		(route) =>
																			`${siteNotificationEventLabels[route.eventType]} -> ${
																				route.channelName ??
																				route.channelConfigId
																			}`,
																	)
																	.join("；")}
															</p>
															<p className="mt-1 text-xs text-muted-foreground">
																{
																	contentPolicyLabels[
																		recipient.includeCommentContent
																	]
																}
																{recipient.rateLimitProfile
																	? ` / ${recipient.rateLimitProfile}`
																	: ""}
															</p>
														</div>
														<div className="flex flex-wrap gap-2">
															<Badge
																variant={
																	recipient.enabled ? "secondary" : "outline"
																}
															>
																{recipient.enabled ? "启用" : "停用"}
															</Badge>
															<Button
																type="button"
																size="sm"
																variant={
																	recipient.enabled ? "outline" : "secondary"
																}
																onClick={() =>
																	setNotificationRecipients(
																		updateRecipient(
																			notificationRecipients,
																			recipient.userId,
																			{ enabled: !recipient.enabled },
																		),
																	)
																}
															>
																{recipient.enabled ? "停用" : "启用"}
															</Button>
															<Button
																type="button"
																size="sm"
																variant="outline"
																onClick={() =>
																	openRecipientEditDialog(recipient)
																}
															>
																编辑
															</Button>
															<Button
																type="button"
																size="sm"
																variant="destructive"
																onClick={() =>
																	setNotificationRecipients(
																		notificationRecipients.filter(
																			(item) =>
																				item.userId !== recipient.userId,
																		),
																	)
																}
															>
																移除
															</Button>
														</div>
													</div>
												</div>
											))}
											{notificationRecipients.length === 0 ? (
												<EmptyState text="暂无后台通知接收人" />
											) : null}
										</div>
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="pageRegistry">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="页面来源"
										description="权威模式会以选定的 sitemap 来源作为页面登记准入依据，并由任务中心托管刷新任务。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<Field label="模式">
												<select
													className={inputClass}
													value={draft.pageRegistry.mode}
													onChange={(event) =>
														setDraft({
															...draft,
															pageRegistry: {
																...draft.pageRegistry,
																mode: event.target
																	.value as AdminSettings["pageRegistry"]["mode"],
																requireHealthySource:
																	event.target.value === "authoritative"
																		? true
																		: draft.pageRegistry.requireHealthySource,
															},
														})
													}
												>
													<option value="discovery">发现模式</option>
													<option value="authoritative">权威模式</option>
												</select>
											</Field>
											<Field label="未知页面响应">
												<select
													className={inputClass}
													value={draft.pageRegistry.unknownPageResponse}
													onChange={(event) =>
														setDraft({
															...draft,
															pageRegistry: {
																...draft.pageRegistry,
																unknownPageResponse: event.target
																	.value as AdminSettings["pageRegistry"]["unknownPageResponse"],
															},
														})
													}
												>
													<option value="inactive_payload">
														返回 inactive
													</option>
													<option value="forbidden">拒绝访问</option>
												</select>
											</Field>
											<Field
												label="权威 sitemap 地址"
												description="填写一个或多个 sitemap 或 sitemap index URL；可用逗号、空格或换行分隔。"
												error={firstFieldError(
													saveError,
													"pageRegistry.authoritativeSitemapUrls",
												)}
											>
												<textarea
													className={textareaClass}
													value={draft.pageRegistry.authoritativeSitemapUrls.join(
														"\n",
													)}
													onChange={(event) =>
														setDraft({
															...draft,
															pageRegistry: {
																...draft.pageRegistry,
																authoritativeSitemapUrls: parseSitemapUrlList(
																	event.target.value,
																),
															},
														})
													}
												/>
											</Field>
											<Field
												label="健康宽限秒数"
												description="权威模式下，最近成功刷新超过该时间会阻止保存。"
												error={firstFieldError(
													saveError,
													"pageRegistry.sourceFreshnessGraceSec",
												)}
											>
												<Input
													type="number"
													min={0}
													value={draft.pageRegistry.sourceFreshnessGraceSec}
													onChange={(event) =>
														setDraft({
															...draft,
															pageRegistry: {
																...draft.pageRegistry,
																sourceFreshnessGraceSec: Number(
																	event.target.value,
																),
															},
														})
													}
												/>
											</Field>
											<BooleanField
												label="要求健康来源"
												description="权威模式会固定要求健康来源；发现模式下可提前打开该约束。"
												checked={draft.pageRegistry.requireHealthySource}
												onCheckedChange={(requireHealthySource) =>
													setDraft({
														...draft,
														pageRegistry: {
															...draft.pageRegistry,
															requireHealthySource:
																draft.pageRegistry.mode === "authoritative"
																	? true
																	: requireHealthySource,
														},
													})
												}
											/>
											<BooleanField
												label="紧急锁定"
												description="用于快速阻断非权威页面进入活跃登记。"
												checked={draft.pageRegistry.emergencyLockdown}
												onCheckedChange={(emergencyLockdown) =>
													setDraft({
														...draft,
														pageRegistry: {
															...draft.pageRegistry,
															emergencyLockdown,
														},
													})
												}
											/>
											<div className="rounded-md border bg-background p-3 text-sm leading-6 md:col-span-2">
												<div className="flex flex-wrap items-center gap-2">
													<Badge
														variant={
															draft.pageRegistry.mode === "authoritative"
																? "secondary"
																: "outline"
														}
													>
														{draft.pageRegistry.mode === "authoritative"
															? "权威模式"
															: "发现模式"}
													</Badge>
													<span className="text-muted-foreground">
														{draft.pageRegistry.authoritativeSitemapUrls
															.length > 0
															? `sitemap：${draft.pageRegistry.authoritativeSitemapUrls.join(", ")}`
															: "未配置权威 sitemap"}
													</span>
												</div>
												{draft.pageRegistry.mode === "authoritative" ? (
													<div className="mt-3 grid gap-2 text-xs text-muted-foreground">
														<p>
															保障刷新任务由任务中心系统托管，系统键：
															<code className="rounded bg-muted px-1 py-0.5">
																{`page_registry:authoritative_source_refresh:${draft.siteKey}`}
															</code>
														</p>
														<a
															className="font-medium text-primary underline-offset-4 hover:underline"
															href="?view=tasks"
														>
															打开任务中心
														</a>
													</div>
												) : (
													<p className="mt-3 text-xs text-muted-foreground">
														发现模式不会删除既有刷新任务；从权威模式关闭后，系统托管任务会禁用并保留保护归属。
													</p>
												)}
											</div>
										</div>
									</SettingsSection>
								</div>
							</Tabs.Content>
						</div>
					</Tabs.Root>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							{siteSectionSaveLabels[siteTab]}
						</Button>
					</div>
				</form>
				<SiteNotificationRecipientDialog
					open={Boolean(recipientDialog)}
					mode={recipientDialog?.mode ?? "create"}
					draft={recipientDialog?.draft ?? null}
					candidateUsers={notificationCandidateUsers}
					channelConfigs={draft.notifications.channelConfigs}
					onOpenChange={(open) => {
						if (!open) {
							setRecipientDialog(null);
						}
					}}
					onDraftChange={(nextDraft) =>
						setRecipientDialog((current) =>
							current ? { ...current, draft: nextDraft } : current,
						)
					}
					onSubmit={submitRecipientDialog}
				/>
			</CardContent>
		</Card>
	);
}
