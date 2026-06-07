import { useEffect, useState } from "react";
import { Tabs } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
	getSystemSettings,
	patchAdminSystemSettingsSection,
	testNotificationChannel,
	testSystemMail,
	type AdminSystemSettings,
	type NotificationChannel,
	type NotificationChannelConfig,
} from "@/api/admin";
import { adminUiErrorMessage } from "@/api/client";
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
	SettingsSubsection,
	inputClass,
	textareaClass,
} from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	captchaProviderLabels,
	ipRegionCachePolicyLabels,
	loggingLevelLabels,
	recaptchaVariantLabels,
} from "../shared/display-labels";
import {
	cloneNotificationChannelConfigDraft,
	createNotificationChannelConfigDraft,
	mailChannelTestState,
	notificationTestResultSummary,
	upsertNotificationChannelConfig,
} from "../content/notification-ui-model";
import {
	MailTestPanel,
	NotificationChannelConfigDialog,
	NotificationChannelConfigList,
	NotificationChannelTestDialog,
	NotificationTemplatesPanel,
} from "./notification-settings-panels";
import {
	buildSettingsErrorModel,
	firstFieldError,
} from "./settings-error-model";
import {
	showExternalAvatarDetails,
	showMailDetails,
} from "./settings-visibility";
import {
	SettingsSaveError,
	buildSystemSettingsSectionPayload,
	initialSettingsTab,
	isSameSettingsPayload,
	replaceSettingsTabQuery,
	secretPlaceholder,
	systemSectionSaveLabels,
	systemSettingsTabs,
	type SystemSettingsTab,
} from "./settings-shared";
export function SystemSettingsPage({ siteKey }: { siteKey: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: ["admin", "system-settings"],
		queryFn: getSystemSettings,
	});
	const [draft, setDraft] = useState<AdminSystemSettings | null>(null);
	const [channelDialog, setChannelDialog] = useState<{
		mode: "create" | "edit";
		draft: NotificationChannelConfig;
	} | null>(null);
	const [channelTestConfig, setChannelTestConfig] =
		useState<NotificationChannelConfig | null>(null);
	const [systemTab, setSystemTab] = useState<SystemSettingsTab>(() =>
		initialSettingsTab("systemTab", systemSettingsTabs, "security"),
	);
	const [savedMailSettings, setSavedMailSettings] = useState<
		AdminSystemSettings["mail"] | null
	>(null);
	const mutation = useMutation({
		mutationFn: (input: { section: SystemSettingsTab; payload: unknown }) =>
			patchAdminSystemSettingsSection(input.section, input.payload),
		meta: { suppressGlobalToast: true },
		onSuccess: (settings) => {
			setDraft(settings);
			setSavedMailSettings(settings.mail);
			queryClient.setQueryData(["admin", "system-settings"], settings);
			toast.success("系统设置已保存");
		},
		onError: (error) => {
			toast.error(adminUiErrorMessage(error, "系统设置保存失败。"));
		},
	});
	const channelTestMutation = useMutation({
		mutationFn: (input: { channelConfigId: string; recipient?: string }) =>
			testNotificationChannel({ ...input, siteKey }),
	});
	const mailTestMutation = useMutation({
		mutationFn: () => testSystemMail(),
	});

	useEffect(() => {
		if (query.data) {
			setDraft(query.data);
			setSavedMailSettings(query.data.mail);
		}
	}, [query.data]);
	const setControlledSystemTab = (nextTab: string) => {
		const normalized = systemSettingsTabs.includes(nextTab as SystemSettingsTab)
			? (nextTab as SystemSettingsTab)
			: "security";
		setSystemTab(normalized);
		replaceSettingsTabQuery("systemTab", normalized);
	};

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
	const saveError = buildSettingsErrorModel(
		mutation.error,
		"系统设置保存失败。",
	);
	const channelTestError = buildSettingsErrorModel(
		channelTestMutation.error,
		"通知通道测试失败。",
	);
	const mailTestError = buildSettingsErrorModel(
		mailTestMutation.error,
		"邮件测试失败。",
	);
	const mailTestState = mailChannelTestState({
		settings: draft,
		dirty: savedMailSettings
			? JSON.stringify(savedMailSettings) !== JSON.stringify(draft.mail)
			: false,
	});
	const profileVerificationMailReady =
		draft.mail.enabled &&
		Boolean(draft.mail.smtp.host.trim()) &&
		Boolean(draft.mail.smtp.from.trim());
	const openChannelCreateDialog = (
		type: Exclude<NotificationChannel, "email">,
	) =>
		setChannelDialog({
			mode: "create",
			draft: createNotificationChannelConfigDraft(type),
		});
	const openChannelEditDialog = (config: NotificationChannelConfig) =>
		setChannelDialog({
			mode: "edit",
			draft: cloneNotificationChannelConfigDraft(config),
		});
	const submitChannelDialog = () => {
		if (!channelDialog) {
			return;
		}
		setDraft({
			...draft,
			notifications: {
				...draft.notifications,
				channelConfigs: upsertNotificationChannelConfig(
					draft.notifications.channelConfigs,
					channelDialog.draft,
				),
			},
		});
		setChannelDialog(null);
	};
	const removeChannelConfig = async (config: NotificationChannelConfig) => {
		const confirmed = await confirm({
			title: "删除通知渠道",
			description:
				"确认删除这个通知渠道配置？如果站点通知接收人仍引用它，后端会阻止保存。",
			confirmText: "删除渠道",
			destructive: true,
		});
		if (!confirmed) {
			return;
		}
		setDraft({
			...draft,
			notifications: {
				...draft.notifications,
				channelConfigs: draft.notifications.channelConfigs.filter(
					(item) => item.id !== config.id,
				),
			},
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">系统设置</CardTitle>
				<CardDescription>全局日志级别与保留策略。</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 md:grid-cols-2"
					onSubmit={async (event) => {
						event.preventDefault();
						const nextPayload = buildSystemSettingsSectionPayload(
							systemTab,
							draft,
						);
						const currentPayload = query.data
							? buildSystemSettingsSectionPayload(systemTab, query.data)
							: null;
						if (
							currentPayload &&
							isSameSettingsPayload(currentPayload, nextPayload)
						) {
							toast.info("配置无变化");
							return;
						}
						if (draft.admin.deletion.retentionDays === 0) {
							const confirmed = await confirm({
								title: "立即永久删除",
								description:
									"删除保留天数为 0 时，高风险删除操作不会进入恢复窗口，会立即执行永久删除。确认保存这个策略？",
								confirmText: "保存立即删除策略",
								destructive: true,
							});
							if (!confirmed) {
								return;
							}
						}
						mutation.mutate({
							section: systemTab,
							payload: nextPayload,
						});
					}}
				>
					<SettingsSaveError model={saveError} fallback="系统设置保存失败" />
					<Tabs.Root
						value={systemTab}
						onValueChange={setControlledSystemTab}
						className="md:col-span-2"
					>
						<Tabs.List>
							<Tabs.Trigger value="security">后台与安全</Tabs.Trigger>
							<Tabs.Trigger value="rate-limit">限流</Tabs.Trigger>
							<Tabs.Trigger value="mail">邮件</Tabs.Trigger>
							<Tabs.Trigger value="notifications">通知</Tabs.Trigger>
							<Tabs.Trigger value="captcha">验证码</Tabs.Trigger>
							<Tabs.Trigger value="avatar">头像与公开接口</Tabs.Trigger>
							<Tabs.Trigger value="ip-region">IP 地域</Tabs.Trigger>
							<Tabs.Trigger value="anti-spam">反垃圾</Tabs.Trigger>
						</Tabs.List>
						<div className="pt-4">
							<Tabs.Content value="security">
								<div className="grid gap-4 md:grid-cols-2">
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
																...draft.admin,
																session: {
																	...draft.admin.session,
																	ttlMinutes: Number(event.target.value),
																},
															},
														})
													}
												/>
											</Field>
											<Field
												label="删除保留天数"
												description="默认保留 15 天用于恢复；设置为 0 会立即永久删除。"
											>
												<Input
													type="number"
													min={0}
													max={3650}
													value={draft.admin.deletion.retentionDays}
													onChange={(event) =>
														setDraft({
															...draft,
															admin: {
																...draft.admin,
																deletion: {
																	retentionDays: Number(event.target.value),
																},
															},
														})
													}
												/>
											</Field>
											<BooleanField
												label="自助邮箱/密码变更需要邮件验证"
												description="只有系统邮件已启用且 SMTP 配置完整时，该开关才会触发验证码流程；否则仍按当前密码直接确认。"
												checked={
													draft.admin.emailVerification.selfServiceRequired
												}
												onCheckedChange={(selfServiceRequired) =>
													setDraft({
														...draft,
														admin: {
															...draft.admin,
															emailVerification: {
																selfServiceRequired,
															},
														},
													})
												}
											/>
											{profileVerificationMailReady ? null : (
												<div className="rounded-md border bg-background p-3 text-sm leading-6 text-muted-foreground md:col-span-2">
													当前系统邮件未启用或 SMTP
													配置不完整。该开关可以保存，但自助邮箱/密码变更仍会按当前密码直接确认。
												</div>
											)}
										</div>
									</SettingsSection>
									<SettingsSection
										title="安全与来源控制"
										description="保存后立即影响运行中的请求校验；修改后台来源限制前，请确认当前管理后台 Origin 已包含在允许列表内。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<BooleanField
												label="启用后台 Origin Guard"
												checked={draft.security.adminOriginGuard.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														security: {
															...draft.security,
															adminOriginGuard: {
																...draft.security.adminOriginGuard,
																enabled,
															},
														},
													})
												}
											/>
											<BooleanField
												label="允许后台请求缺失 Origin"
												checked={
													draft.security.adminOriginGuard.allowMissingOrigin
												}
												onCheckedChange={(allowMissingOrigin) =>
													setDraft({
														...draft,
														security: {
															...draft.security,
															adminOriginGuard: {
																...draft.security.adminOriginGuard,
																allowMissingOrigin,
															},
														},
													})
												}
											/>
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
											<BooleanField
												label="启用公开 Origin Guard"
												description="公开写接口会校验请求 Origin 是否匹配站点配置的前端 Origin。"
												checked={draft.security.publicOriginGuard.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														security: {
															...draft.security,
															publicOriginGuard: {
																...draft.security.publicOriginGuard,
																enabled,
															},
														},
													})
												}
											/>
											<BooleanField
												label="允许公开写请求缺失 Origin"
												checked={
													draft.security.publicOriginGuard.allowMissingOrigin
												}
												onCheckedChange={(allowMissingOrigin) =>
													setDraft({
														...draft,
														security: {
															...draft.security,
															publicOriginGuard: {
																...draft.security.publicOriginGuard,
																allowMissingOrigin,
															},
														},
													})
												}
											/>
											<BooleanField
												label="启用全局 Flood Guard"
												checked={draft.security.globalFloodGuard.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														security: {
															...draft.security,
															globalFloodGuard: {
																...draft.security.globalFloodGuard,
																enabled,
															},
														},
													})
												}
											/>
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
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="rate-limit">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
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
												value={
													draft.security.rateLimit.adminLogin.autoBlacklistSec
												}
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
												value={
													draft.security.rateLimit.commentCreate.maxRequests
												}
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
												value={
													draft.security.rateLimit.captchaVerify.maxFailures
												}
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
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="avatar">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="头像 / 外部头像 URL"
										description="后端只返回 author.avatarUrl，不托管、不代理、不缓存头像图片。图片 404 或加载失败时由前端继续显示名称首字母或文字 fallback。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<BooleanField
												label="外部头像 URL"
												checked={draft.avatar.external.enabled}
												error={firstFieldError(
													saveError,
													"avatar.external.enabled",
												)}
												onCheckedChange={(enabled) =>
													updateAvatar({
														...draft.avatar,
														external: {
															...draft.avatar.external,
															enabled,
														},
													})
												}
											/>
											{showExternalAvatarDetails(draft) ? (
												<>
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
												</>
											) : (
												<div className="md:col-span-2 rounded-md border p-3 text-sm text-muted-foreground">
													外部头像 URL 已关闭。已保存的 base URL、hash 算法和
													query 参数会保留。
												</div>
											)}
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
											<BooleanField
												label="返回建议字段"
												description="关闭时公开评论接口不返回头像形状、显示尺寸等前端展示建议。"
												checked={draft.publicApi.advisoryFields.enabled}
												error={firstFieldError(
													saveError,
													"publicApi.advisoryFields.enabled",
												)}
												onCheckedChange={(enabled) =>
													updatePublicApi({
														...draft.publicApi,
														advisoryFields: {
															...draft.publicApi.advisoryFields,
															enabled,
														},
													})
												}
											/>
										</div>
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="mail">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="系统邮件"
										description="系统级邮件发送能力；当前站点是否发送通知由站点设置单独控制。密码留空时保留已有密钥。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<BooleanField
												label="系统邮件"
												description="控制实例级邮件发送能力；站点是否发送通知由站点设置单独控制。"
												checked={draft.mail.enabled}
												error={firstFieldError(saveError, "mail.enabled")}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														mail: {
															...draft.mail,
															enabled,
														},
													})
												}
											/>
											{showMailDetails(draft) ? (
												<>
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
													<BooleanField
														label="SMTP 加密连接 Secure"
														checked={draft.mail.smtp.secure}
														onCheckedChange={(secure) =>
															setDraft({
																...draft,
																mail: {
																	...draft.mail,
																	smtp: {
																		...draft.mail.smtp,
																		secure,
																	},
																},
															})
														}
													/>
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
												</>
											) : (
												<div className="md:col-span-2 rounded-md border p-3 text-sm text-muted-foreground">
													系统邮件已关闭。已保存的 SMTP
													配置会保留，再次开启后继续使用。
												</div>
											)}
											<div className="md:col-span-2">
												<SettingsSaveError
													model={mailTestError}
													fallback="邮件测试失败"
												/>
												<MailTestPanel
													testable={mailTestState.testable}
													reason={mailTestState.reason}
													onOpen={() => mailTestMutation.mutate()}
												/>
												{mailTestMutation.data ? (
													<div className="mt-3 rounded-md border bg-background p-3 text-sm text-muted-foreground">
														{notificationTestResultSummary({
															...mailTestMutation.data,
															channelName: "默认邮件",
														})}
													</div>
												) : null}
											</div>
										</div>
									</SettingsSection>
								</div>
							</Tabs.Content>
							<Tabs.Content value="notifications">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSaveError
										model={channelTestError}
										fallback="通知通道测试失败"
									/>
									<SettingsSection
										title="通知队列与限速"
										description="控制通知任务入队和投递节流；具体投递仍由任务中心展示状态和重试结果。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<Field label="队列后端">
												<select
													className={inputClass}
													value={draft.notifications.delivery.queueBackend}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	queueBackend: event.target.value as
																		| "database"
																		| "bullmq",
																},
															},
														})
													}
												>
													<option value="database">Database</option>
													<option value="bullmq">BullMQ</option>
												</select>
											</Field>
											<Field label="全局每分钟上限">
												<Input
													type="number"
													min={1}
													value={
														draft.notifications.delivery.globalMaxPerMinute
													}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	globalMaxPerMinute: Number(
																		event.target.value,
																	),
																},
															},
														})
													}
												/>
											</Field>
											<Field label="单通道每分钟上限">
												<Input
													type="number"
													min={1}
													value={
														draft.notifications.delivery.perChannelMaxPerMinute
													}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	perChannelMaxPerMinute: Number(
																		event.target.value,
																	),
																},
															},
														})
													}
												/>
											</Field>
											<Field label="单站点每小时上限">
												<Input
													type="number"
													min={1}
													value={draft.notifications.delivery.perSiteMaxPerHour}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	perSiteMaxPerHour: Number(event.target.value),
																},
															},
														})
													}
												/>
											</Field>
											<Field label="单收件人最小间隔（秒）">
												<Input
													type="number"
													min={0}
													value={
														draft.notifications.delivery
															.perRecipientMinIntervalSec
													}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	perRecipientMinIntervalSec: Number(
																		event.target.value,
																	),
																},
															},
														})
													}
												/>
											</Field>
											<Field label="每日通道预算">
												<Input
													type="number"
													min={1}
													value={
														draft.notifications.delivery.dailyChannelBudget
													}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	dailyChannelBudget: Number(
																		event.target.value,
																	),
																},
															},
														})
													}
												/>
											</Field>
											<Field label="低优先级延迟（秒）">
												<Input
													type="number"
													min={0}
													value={
														draft.notifications.delivery.lowPriorityDelaySec
													}
													onChange={(event) =>
														setDraft({
															...draft,
															notifications: {
																...draft.notifications,
																delivery: {
																	...draft.notifications.delivery,
																	lowPriorityDelaySec: Number(
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
										title="通知渠道配置"
										description="邮件、Webhook、WxPusher 都按配置实例保存；Webhook 和 WxPusher 可添加多个实例，站点接收人再选择具体实例。密钥字段留空时保留已有配置。"
									>
										<NotificationChannelConfigList
											configs={draft.notifications.channelConfigs}
											onAdd={openChannelCreateDialog}
											onEdit={openChannelEditDialog}
											onRemove={(config) => void removeChannelConfig(config)}
											onTest={setChannelTestConfig}
										/>
									</SettingsSection>
									{channelTestMutation.data ? (
										<div className="md:col-span-2 rounded-md border bg-background p-3 text-sm text-muted-foreground">
											{notificationTestResultSummary(channelTestMutation.data)}
										</div>
									) : null}
									<NotificationTemplatesPanel />
								</div>
							</Tabs.Content>
							<Tabs.Content value="captcha">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="验证码服务"
										description="选择公开评论写操作使用的验证码提供方；密钥字段留空时保留已有配置。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<Field label="验证码服务">
												<select
													aria-label="验证码服务"
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
													<option value="image">
														{captchaProviderLabels.image}
													</option>
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
														value={
															draft.captcha.turnstile.expectedHostname ?? ""
														}
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
														value={
															draft.captcha.hcaptcha.expectedHostname ?? ""
														}
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
														value={
															draft.captcha.recaptcha.expectedHostname ?? ""
														}
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
								</div>
							</Tabs.Content>
							<Tabs.Content value="anti-spam">
								<div className="grid gap-4 md:grid-cols-2">
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
								</div>
							</Tabs.Content>
							<Tabs.Content value="ip-region">
								<div className="grid gap-4 md:grid-cols-2">
									<SettingsSection
										title="IP 数据库"
										description="系统总开关控制是否允许解析 IP 地域；站点设置仍决定具体站点是否公开展示整理后的地区。"
									>
										<div className="grid gap-4 md:grid-cols-2">
											<BooleanField
												label="IP 地域解析"
												checked={draft.ipRegion.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														ipRegion: {
															...draft.ipRegion,
															enabled,
														},
													})
												}
											/>
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
													<option value="file">
														{ipRegionCachePolicyLabels.file}
													</option>
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
											<BooleanField
												label="每月自动更新"
												checked={draft.ipRegion.autoUpdate.enabled}
												onCheckedChange={(enabled) =>
													setDraft({
														...draft,
														ipRegion: {
															...draft.ipRegion,
															autoUpdate: {
																...draft.ipRegion.autoUpdate,
																enabled,
															},
														},
													})
												}
											/>
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
								</div>
							</Tabs.Content>
						</div>
					</Tabs.Root>
					<div className="md:col-span-2">
						<Button type="submit" disabled={mutation.isPending}>
							{systemSectionSaveLabels[systemTab]}
						</Button>
					</div>
				</form>
				<NotificationChannelConfigDialog
					open={Boolean(channelDialog)}
					mode={channelDialog?.mode ?? "create"}
					draft={channelDialog?.draft ?? null}
					onOpenChange={(open) => {
						if (!open) {
							setChannelDialog(null);
						}
					}}
					onDraftChange={(nextDraft) =>
						channelDialog
							? setChannelDialog({
									...channelDialog,
									draft: nextDraft,
								})
							: undefined
					}
					onSubmit={submitChannelDialog}
				/>
				{channelTestConfig ? (
					<NotificationChannelTestDialog
						open={Boolean(channelTestConfig)}
						config={channelTestConfig}
						onOpenChange={(open) => {
							if (!open) {
								setChannelTestConfig(null);
							}
						}}
						onTest={(input) => {
							channelTestMutation.mutate(input);
							setChannelTestConfig(null);
						}}
						pending={channelTestMutation.isPending}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}
