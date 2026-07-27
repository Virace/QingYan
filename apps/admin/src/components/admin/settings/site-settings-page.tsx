import { Tabs } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	type AdminSettings,
	getSettings,
	listAdminUsers,
	patchAdminSiteSettingsSection,
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
import { eligibleNotificationRecipientUsers } from "../content/notification-ui-model";
import {
	BooleanField,
	EmptyState,
	Field,
	inputClass,
	SettingsSection,
	SettingsToggleGroup,
	textareaClass,
} from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import { NotificationDiagnosticsPanel } from "./notification-settings-panels";
import {
	buildSettingsErrorModel,
	firstFieldError,
} from "./settings-error-model";
import {
	buildSiteSettingsSectionPayload,
	initialSettingsTab,
	isSameSettingsPayload,
	parseSitemapUrlList,
	replaceSettingsTabQuery,
	SettingsSaveError,
	type SiteSettingsTab,
	siteSectionSaveLabels,
	siteSettingsTabs,
} from "./settings-shared";
import {
	countSiteNotificationChanges,
	normalizeSiteNotificationEvents,
	updateEventExternalTargets,
	updateEventRecipients,
} from "./site-notification-events-model";
import { SiteNotificationEventPanel } from "./site-notification-events-panel";
import {
	showCaptchaThresholdDetails,
	showLowTrustCounterHint,
} from "./settings-visibility";
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
		queryFn: () => listAdminUsers({ siteKey: resolvedSiteKey, limit: 100 }),
		enabled: Boolean(resolvedSiteKey),
	});
	const [draft, setDraft] = useState<AdminSettings | null>(null);
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
		onSuccess: (settings, input) => {
			setDraft(settings);
			queryClient.setQueryData(
				["admin", "settings", resolvedSiteKey],
				settings,
			);
			if (input.section === "notifications") {
				void queryClient.invalidateQueries({
					queryKey: ["admin", "notification-diagnostics", resolvedSiteKey],
				});
			}
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
	const notificationChangeCount =
		query.data && draft
			? countSiteNotificationChanges(
					query.data.notifications,
					draft.notifications,
				)
			: 0;
	const notificationDraftDirty = notificationChangeCount > 0;
	useEffect(() => {
		if (!notificationDraftDirty) {
			return;
		}
		const guardUnsavedChanges = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", guardUnsavedChanges);
		return () =>
			window.removeEventListener("beforeunload", guardUnsavedChanges);
	}, [notificationDraftDirty]);

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
	const notificationEvents = normalizeSiteNotificationEvents(
		draft.notifications.backend.events,
	);
	const notificationCandidateUsers = eligibleNotificationRecipientUsers(
		usersQuery.data?.users ?? [],
		draft.siteKey,
	);
	const staffCandidateUsers = eligibleNotificationRecipientUsers(
		usersQuery.data?.users ?? [],
		draft.siteKey,
	);
	const selectedStaffCandidate = staffCandidateUsers.find(
		(user) => user.email === draft.comments.verifiedAuthor.email,
	);
	const setNotificationEvents = (
		events: AdminSettings["notifications"]["backend"]["events"],
	) => {
		setDraft({
			...draft,
			notifications: {
				...draft.notifications,
				backend: {
					...draft.notifications.backend,
					events,
				},
			},
		});
	};
	const setEventRecipientUserIds = (
		eventType: AdminSettings["notifications"]["backend"]["events"][number]["eventType"],
		userIds: number[],
	) => {
		const currentEvent = notificationEvents.find(
			(event) => event.eventType === eventType,
		);
		const nextRecipients = userIds.flatMap((userId) => {
			const existing = currentEvent?.recipients.find(
				(recipient) => recipient.userId === userId,
			);
			if (existing) {
				return [existing];
			}
			const user = notificationCandidateUsers.find(
				(candidate) => candidate.id === userId,
			);
			return user
				? [
						{
							userId: user.id,
							username: user.username,
							email: user.email,
							displayName: user.displayName,
							includeCommentContent: "summary" as const,
						},
					]
				: [];
		});
		setNotificationEvents(
			updateEventRecipients(notificationEvents, eventType, nextRecipients),
		);
	};
	const setControlledSiteTab = (nextTab: string) => {
		const normalized = siteSettingsTabs.includes(nextTab as SiteSettingsTab)
			? (nextTab as SiteSettingsTab)
			: "comments";
		if (
			siteTab === "notifications" &&
			normalized !== "notifications" &&
			notificationDraftDirty
		) {
			if (!window.confirm("通知设置尚未应用。要放弃这些更改并离开吗？")) {
				return;
			}
			if (query.data) {
				setDraft({
					...draft,
					notifications: structuredClone(query.data.notifications),
				});
			}
		}
		setSiteTab(normalized);
		replaceSettingsTabQuery("siteTab", normalized);
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
											<SettingsSection
												title="评论审核"
												description="评论审核策略属于当前站点；Akismet 会自动使用站点前端 Origin 作为 Blog URL。"
											>
												<div className="grid gap-4 md:grid-cols-2">
													<Field
														label="评论审核策略"
														description="不审核会直接发布；人工审核会进入待审；Akismet 自动审核会发布正常评论并拦截垃圾评论；Akismet 辅助会标记垃圾评论，正常评论仍待审。"
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
																		defaultStatus:
																			mode === "manual" ||
																			mode === "manual_with_akismet"
																				? "pending"
																				: "approved",
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
															<option value="manual">人工审核</option>
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
												title="公开输入上限"
												description="限制公开评论、页面身份和作者信息的最大长度。保存后前台 bootstrap 会返回这些限制。"
											>
												<div className="grid gap-4 md:grid-cols-2">
													<Field
														label="评论正文"
														error={firstFieldError(
															saveError,
															"comments.inputLimits.contentMaxLength",
														)}
													>
														<Input
															type="number"
															min={1}
															max={10000}
															value={
																draft.comments.inputLimits.contentMaxLength
															}
															onChange={(event) =>
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		inputLimits: {
																			...draft.comments.inputLimits,
																			contentMaxLength: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
													<Field
														label="作者昵称"
														error={firstFieldError(
															saveError,
															"comments.inputLimits.authorNameMaxLength",
														)}
													>
														<Input
															type="number"
															min={1}
															max={100}
															value={
																draft.comments.inputLimits.authorNameMaxLength
															}
															onChange={(event) =>
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		inputLimits: {
																			...draft.comments.inputLimits,
																			authorNameMaxLength: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
													<Field
														label="作者站点 URL"
														error={firstFieldError(
															saveError,
															"comments.inputLimits.authorWebsiteMaxLength",
														)}
													>
														<Input
															type="number"
															min={1}
															max={4096}
															value={
																draft.comments.inputLimits
																	.authorWebsiteMaxLength
															}
															onChange={(event) =>
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		inputLimits: {
																			...draft.comments.inputLimits,
																			authorWebsiteMaxLength: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
													<Field
														label="页面标题"
														error={firstFieldError(
															saveError,
															"comments.inputLimits.pageTitleMaxLength",
														)}
													>
														<Input
															type="number"
															min={1}
															max={500}
															value={
																draft.comments.inputLimits.pageTitleMaxLength
															}
															onChange={(event) =>
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		inputLimits: {
																			...draft.comments.inputLimits,
																			pageTitleMaxLength: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
													<Field
														label="页面标识"
														error={firstFieldError(
															saveError,
															"comments.inputLimits.pageKeyMaxLength",
														)}
													>
														<Input
															type="number"
															min={1}
															max={1024}
															value={
																draft.comments.inputLimits.pageKeyMaxLength
															}
															onChange={(event) =>
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		inputLimits: {
																			...draft.comments.inputLimits,
																			pageKeyMaxLength: Number(
																				event.target.value,
																			),
																		},
																	},
																})
															}
														/>
													</Field>
												</div>
											</SettingsSection>
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
												title="站点人员评论身份"
												description="从当前站点可用后台用户选择评论身份；公开展示会按这里的 badge 和显示名策略处理。"
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
													<Field
														label="站点人员"
														description="从当前站点可用后台用户中选择，选择后自动填充展示名、邮箱和主页。"
													>
														<select
															className={inputClass}
															value={selectedStaffCandidate?.email ?? ""}
															onChange={(event) => {
																const user = staffCandidateUsers.find(
																	(item) => item.email === event.target.value,
																);
																if (!user) {
																	return;
																}
																setDraft({
																	...draft,
																	comments: {
																		...draft.comments,
																		verifiedAuthor: {
																			...draft.comments.verifiedAuthor,
																			displayName: user.displayName,
																			email: user.email,
																			website: user.website ?? "",
																		},
																	},
																});
															}}
														>
															<option value="">选择站点人员</option>
															{draft.comments.verifiedAuthor.email &&
															!selectedStaffCandidate ? (
																<option value="" disabled>
																	当前邮箱不属于当前站点人员
																</option>
															) : null}
															{staffCandidateUsers.map((user) => (
																<option key={user.id} value={user.email}>
																	{user.displayName} / {user.email}
																</option>
															))}
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
													<Field
														label="邮箱"
														description="来自所选站点人员；如需修改，请先调整后台用户资料或站点授权。"
													>
														<Input
															type="email"
															value={draft.comments.verifiedAuthor.email}
															readOnly
														/>
													</Field>
													<Field
														label="作者主页 URL"
														description="来自所选站点人员；为空时公开侧不会展示作者主页。"
													>
														<Input
															value={draft.comments.verifiedAuthor.website}
															readOnly
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
												description="开启后 QingYan 会记录公开写操作并按窗口阈值触发自动拉黑；关闭后需依赖前置 WAF、反向代理或外部限流。"
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
												description="单位是次数；评论提交、评论投票、页面点赞等公开写操作都会计入。"
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
												description="关闭后仍保留手动黑名单、验证码和基础限流，但超出滥用阈值不会自动新增黑名单规则。"
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
								<div className="grid gap-4">
									<SettingsSection
										title="发送能力"
										description="这里仅展示系统已经准备好的发送方式。需要调整时，可直接进入对应的系统设置。"
									>
										<div className="grid gap-3 md:grid-cols-2">
											<div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
												<div>
													<p className="text-sm font-medium">邮件</p>
													<p className="mt-1 text-xs text-muted-foreground">
														{draft.notifications.capabilities.mailReady
															? "邮件服务器已经可以使用。"
															: "还需要完成邮件服务器设置。"}
													</p>
												</div>
												<div className="flex shrink-0 items-center gap-2">
													<Badge
														variant={
															draft.notifications.capabilities.mailReady
																? "secondary"
																: "outline"
														}
													>
														{draft.notifications.capabilities.mailReady
															? "可用"
															: "待设置"}
													</Badge>
													<a
														className="text-sm font-medium underline-offset-4 hover:underline"
														href="?view=system&systemTab=mail"
													>
														前往设置
													</a>
												</div>
											</div>
											<div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
												<div>
													<p className="text-sm font-medium">其他发送方式</p>
													<p className="mt-1 text-xs text-muted-foreground">
														{draft.notifications.capabilities
															.externalTargetCount > 0
															? `已有 ${draft.notifications.capabilities.externalTargetCount} 个可用目标。`
															: "当前没有可用的 Webhook 或 WxPusher 目标。"}
													</p>
												</div>
												<div className="flex shrink-0 items-center gap-2">
													<Badge variant="outline">
														{
															draft.notifications.capabilities
																.externalTargetCount
														}
														个
													</Badge>
													<a
														className="text-sm font-medium underline-offset-4 hover:underline"
														href="?view=system&systemTab=notifications"
													>
														前往设置
													</a>
												</div>
											</div>
										</div>
									</SettingsSection>
									<SettingsSection
										title="评论者回复邮件通知"
										description="控制公开评论表单是否显示“有人回复时邮件通知我”。只影响普通评论者，不影响后台用户通知。"
									>
										<BooleanField
											label="允许评论者订阅回复邮件"
											description="开启后，内容站点可以在评论框中显示回复提醒选项。"
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
										<BooleanField
											label="回复提醒默认勾选"
											description="控制评论框首次显示时是否默认勾选；评论者仍可自行取消。"
											checked={
												draft.notifications.commenter.replyEmailDefaultChecked
											}
											error={firstFieldError(
												saveError,
												"notifications.commenter.replyEmailDefaultChecked",
											)}
											disabled={
												!draft.notifications.commenter.replyEmailEnabled
											}
											onCheckedChange={(replyEmailDefaultChecked) =>
												setDraft({
													...draft,
													notifications: {
														...draft.notifications,
														commenter: {
															...draft.notifications.commenter,
															replyEmailDefaultChecked,
														},
													},
												})
											}
										/>
									</SettingsSection>
									<SettingsSection
										title="评论通知"
										description="每种评论通知各自选择站点人员和其他发送目标。没有选择任何目标时，该类型保持可用，但不会发送。"
									>
										<div className="grid gap-4">
											<BooleanField
												label="启用评论通知"
												description="关闭后暂停下面两类通知；已选择的人员和目标会保留。"
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
											{notificationEvents.map((event) => (
												<SiteNotificationEventPanel
													key={event.eventType}
													event={event}
													eligibleUsers={notificationCandidateUsers}
													externalChannelConfigs={draft.notifications.channelConfigs.filter(
														(config) => config.type !== "email",
													)}
													disabled={
														!draft.notifications.backend.enabled ||
														mutation.isPending
													}
													onRecipientUserIdsChange={(userIds) =>
														setEventRecipientUserIds(event.eventType, userIds)
													}
													onExternalChannelConfigIdsChange={(configIds) =>
														setNotificationEvents(
															updateEventExternalTargets(
																notificationEvents,
																event.eventType,
																configIds,
															),
														)
													}
												/>
											))}
										</div>
									</SettingsSection>
									<NotificationDiagnosticsPanel
										siteKey={draft.siteKey}
										defaultCommentStatus={draft.comments.defaultStatus}
										hasUnsavedNotificationChanges={notificationDraftDirty}
									/>
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
														<p>保障刷新任务由任务中心自动管理。</p>
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
					{siteTab === "notifications" ? (
						notificationDraftDirty ? (
							<div className="sticky bottom-4 z-20 flex min-w-0 flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur md:col-span-2 md:flex-row md:items-center md:justify-between">
								<p className="min-w-0 text-sm font-medium">
									有 {notificationChangeCount} 项通知设置尚未应用
								</p>
								<div className="flex shrink-0 flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										disabled={mutation.isPending}
										onClick={() => {
											if (query.data) {
												setDraft(structuredClone(query.data));
											}
										}}
									>
										放弃更改
									</Button>
									<Button type="submit" disabled={mutation.isPending}>
										{mutation.isPending ? "正在应用" : "应用全部更改"}
									</Button>
								</div>
							</div>
						) : null
					) : (
						<div className="md:col-span-2">
							<Button type="submit" disabled={mutation.isPending}>
								{siteSectionSaveLabels[siteTab]}
							</Button>
						</div>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
