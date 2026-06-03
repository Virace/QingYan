import { useEffect, useState } from "react";
import { Dialog, Tabs } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createBlacklist,
	deleteBlacklist,
	getSettings,
	getSystemSettings,
	listBlacklist,
	listAdminUsers,
	listNotificationTemplates,
	patchAdminSiteSettingsSection,
	patchAdminSystemSettingsSection,
	previewNotificationTemplate,
	restoreNotificationTemplateDefault,
	testNotificationChannel,
	testSystemMail,
	testNotificationTemplate,
	type AdminSettings,
	type AdminSystemSettings,
	type AdminUser,
	type NotificationChannel,
	type NotificationChannelConfig,
	type NotificationContentPolicy,
	type NotificationTemplate,
	type NotificationTemplateFormat,
	type RenderedNotificationTemplate,
	type SiteNotificationEvent,
	type SiteNotificationRecipient,
	updateNotificationTemplate,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
	SettingsSubsection,
	SettingsToggleGroup,
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
import {
	buildSettingsErrorModel,
	firstFieldError,
} from "./settings-error-model";
import {
	showCaptchaThresholdDetails,
	showExternalAvatarDetails,
	showLowTrustCounterHint,
	showMailDetails,
} from "./settings-visibility";
import {
	contentPolicies,
	contentPolicyLabels,
	addRecipientRoute,
	availableNotificationChannelConfigs,
	eligibleNotificationRecipientUsers,
	cloneNotificationChannelConfigDraft,
	makeRecipientFromUser,
	createNotificationChannelConfigDraft,
	mailChannelTestState,
	notificationChannelLabels,
	notificationChannelConfigLabel,
	notificationChannelTargetSummary,
	notificationTestResultSummary,
	readSettingsTabFromSearch,
	removeRecipientRoute,
	siteNotificationEventLabels,
	siteNotificationEvents,
	upsertNotificationChannelConfig,
	writeSettingsTabToSearch,
} from "./notification-ui-model";

const siteSettingsTabs = ["comments", "engagement", "notifications"] as const;
type SiteSettingsTab = (typeof siteSettingsTabs)[number];

const systemSettingsTabs = [
	"security",
	"rate-limit",
	"mail",
	"notifications",
	"captcha",
	"avatar",
	"ip-region",
	"anti-spam",
] as const;
type SystemSettingsTab = (typeof systemSettingsTabs)[number];

function buildSiteSettingsSectionPayload(
	section: SiteSettingsTab,
	draft: AdminSettings,
) {
	if (section === "comments") {
		return draft.comments;
	}
	if (section === "engagement") {
		return draft.engagement;
	}
	return draft.notifications;
}

function buildSystemSettingsSectionPayload(
	section: SystemSettingsTab,
	draft: AdminSystemSettings,
) {
	const sanitized = withoutEmptySecrets(draft);
	switch (section) {
		case "security":
			return {
				admin: sanitized.admin,
				security: sanitized.security,
				logging: sanitized.logging,
			};
		case "rate-limit":
			return sanitized.security.rateLimit;
		case "mail":
			return sanitized.mail;
		case "notifications":
			return sanitized.notifications;
		case "captcha":
			return sanitized.captcha;
		case "avatar":
			return {
				avatar: sanitized.avatar,
				publicApi: sanitized.publicApi,
			};
		case "ip-region":
			return sanitized.ipRegion;
		case "anti-spam":
			return sanitized.antiSpam;
	}
}

const siteSectionSaveLabels: Record<SiteSettingsTab, string> = {
	comments: "保存评论设置",
	engagement: "保存访客与计数设置",
	notifications: "保存站点通知设置",
};

const systemSectionSaveLabels: Record<SystemSettingsTab, string> = {
	security: "保存后台与安全设置",
	"rate-limit": "保存限流设置",
	mail: "保存邮件设置",
	notifications: "保存通知设置",
	captcha: "保存验证码设置",
	avatar: "保存头像与公开接口设置",
	"ip-region": "保存 IP 地域设置",
	"anti-spam": "保存反垃圾设置",
};

function initialSettingsTab<T extends string>(
	param: string,
	allowed: readonly T[],
	fallback: T,
) {
	if (typeof window === "undefined") {
		return fallback;
	}
	return readSettingsTabFromSearch(window.location.search, {
		param,
		allowed,
		fallback,
	});
}

function replaceSettingsTabQuery(param: string, value: string) {
	if (typeof window === "undefined") {
		return;
	}
	const url = new URL(window.location.href);
	url.search = writeSettingsTabToSearch(url.search, { param, value });
	window.history.replaceState(null, "", url);
}

function SettingsSaveError({
	model,
	fallback,
}: {
	model: ReturnType<typeof buildSettingsErrorModel>;
	fallback: string;
}) {
	if (!model) {
		return null;
	}
	return (
		<Alert variant="destructive" className="md:col-span-2">
			<AlertTitle>{fallback}</AlertTitle>
			<AlertDescription>
				<p>
					{model.message}
					{model.requestId ? ` requestId: ${model.requestId}` : ""}
				</p>
				{model.fields.length > 0 ? (
					<ul className="mt-2 list-disc pl-5">
						{model.fields.map((field) => (
							<li key={`${field.path}:${field.message}`}>
								{field.path}: {field.message}
							</li>
						))}
					</ul>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

function updateRecipient(
	recipients: SiteNotificationRecipient[],
	userId: number,
	patch: Partial<SiteNotificationRecipient>,
) {
	return recipients.map((recipient) =>
		recipient.userId === userId ? { ...recipient, ...patch } : recipient,
	);
}

function replaceRecipient(
	recipients: SiteNotificationRecipient[],
	nextRecipient: SiteNotificationRecipient,
) {
	return recipients.map((recipient) =>
		recipient.userId === nextRecipient.userId ? nextRecipient : recipient,
	);
}

function configStringValue(
	config: NotificationChannelConfig,
	key: string,
): string {
	const value = config.config[key];
	return typeof value === "string" ? value : "";
}

function secretStringValue(
	config: NotificationChannelConfig,
	key: string,
): string {
	const value = config.secretConfig?.[key];
	return typeof value === "string" ? value : "";
}

function RecipientRoutesEditor({
	recipient,
	channelConfigs,
	onChange,
}: {
	recipient: SiteNotificationRecipient;
	channelConfigs: NotificationChannelConfig[];
	onChange: (recipient: SiteNotificationRecipient) => void;
}) {
	const availableConfigs = availableNotificationChannelConfigs(channelConfigs);
	const [eventType, setEventType] = useState<SiteNotificationEvent>(
		siteNotificationEvents[0],
	);
	const [channelConfigId, setChannelConfigId] = useState(
		availableConfigs[0]?.id ?? "",
	);

	useEffect(() => {
		if (
			availableConfigs.length > 0 &&
			!availableConfigs.some((config) => config.id === channelConfigId)
		) {
			setChannelConfigId(availableConfigs[0].id);
		}
	}, [availableConfigs, channelConfigId]);

	const selectedConfig = availableConfigs.find(
		(config) => config.id === channelConfigId,
	);

	return (
		<Field label="接收路由">
			<div className="grid gap-3 rounded-md border px-3 py-2">
				{recipient.routes.map((route) => (
					<div
						key={`${route.eventType}:${route.channelConfigId}`}
						className="flex flex-col gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm md:flex-row md:items-center md:justify-between"
					>
						<div>
							<p className="font-medium">
								{siteNotificationEventLabels[route.eventType]}
							</p>
							<p className="text-xs text-muted-foreground">
								{route.channelName ??
									channelConfigs.find(
										(config) => config.id === route.channelConfigId,
									)?.name ??
									route.channelConfigId}
								{" / "}
								{route.channelType
									? notificationChannelLabels[route.channelType]
									: route.channelConfigId}
							</p>
						</div>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={recipient.routes.length <= 1}
							onClick={() =>
								onChange(
									removeRecipientRoute(recipient, {
										eventType: route.eventType,
										channelConfigId: route.channelConfigId,
									}),
								)
							}
						>
							移除
						</Button>
					</div>
				))}
				<div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
					<Field label="事件">
						<select
							className={inputClass}
							value={eventType}
							onChange={(event) =>
								setEventType(event.target.value as SiteNotificationEvent)
							}
						>
							{siteNotificationEvents.map((item) => (
								<option key={item} value={item}>
									{siteNotificationEventLabels[item]}
								</option>
							))}
						</select>
					</Field>
					<Field label="渠道配置">
						<select
							className={inputClass}
							value={channelConfigId}
							disabled={availableConfigs.length === 0}
							onChange={(event) => setChannelConfigId(event.target.value)}
						>
							{availableConfigs.map((config) => (
								<option key={config.id} value={config.id}>
									{notificationChannelConfigLabel(config)}
								</option>
							))}
						</select>
					</Field>
					<Button
						type="button"
						variant="outline"
						disabled={!selectedConfig}
						onClick={() => {
							if (!selectedConfig) {
								return;
							}
							onChange(
								addRecipientRoute(recipient, {
									eventType,
									channelConfigId: selectedConfig.id,
									channelType: selectedConfig.type,
									channelName: selectedConfig.name,
									enabled: true,
								}),
							);
						}}
					>
						添加路由
					</Button>
				</div>
			</div>
		</Field>
	);
}

function SiteNotificationRecipientDialog({
	open,
	mode,
	draft,
	candidateUsers,
	channelConfigs,
	onOpenChange,
	onDraftChange,
	onSubmit,
}: {
	open: boolean;
	mode: "create" | "edit";
	draft: SiteNotificationRecipient | null;
	candidateUsers: AdminUser[];
	channelConfigs: NotificationChannelConfig[];
	onOpenChange: (open: boolean) => void;
	onDraftChange: (draft: SiteNotificationRecipient) => void;
	onSubmit: () => void;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="720px">
				<Dialog.Title>
					{mode === "create" ? "添加通知接收人" : "编辑通知接收人"}
				</Dialog.Title>
				<Dialog.Description size="2">
					确认后才写回接收人列表；取消不会污染当前站点设置草稿。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					{mode === "create" ? (
						<Field label="后台用户">
							<select
								className={inputClass}
								value={draft?.userId ?? ""}
								disabled={candidateUsers.length === 0}
								onChange={(event) => {
									const userId = Number(event.target.value);
									const user = candidateUsers.find(
										(item) => item.id === userId,
									);
									if (user) {
										onDraftChange(makeRecipientFromUser(user));
									}
								}}
							>
								<option value="">
									{candidateUsers.length > 0 ? "选择接收人" : "暂无可添加用户"}
								</option>
								{candidateUsers.map((user) => (
									<option key={user.id} value={user.id}>
										{user.displayName || user.username} / {user.email}
									</option>
								))}
							</select>
						</Field>
					) : null}
					{draft ? (
						<>
							<div className="rounded-md border bg-muted/30 p-3 text-sm">
								<p className="font-medium">
									{draft.displayName || draft.username}
								</p>
								<p className="text-xs text-muted-foreground">
									{draft.username} / {draft.email}
								</p>
							</div>
							<BooleanField
								label="启用接收人"
								checked={draft.enabled}
								onCheckedChange={(enabled) =>
									onDraftChange({ ...draft, enabled })
								}
							/>
							<RecipientRoutesEditor
								recipient={draft}
								channelConfigs={channelConfigs}
								onChange={onDraftChange}
							/>
							<Field label="内容策略">
								<select
									className={inputClass}
									value={draft.includeCommentContent}
									onChange={(event) =>
										onDraftChange({
											...draft,
											includeCommentContent: event.target
												.value as NotificationContentPolicy,
										})
									}
								>
									{contentPolicies.map((policy) => (
										<option key={policy} value={policy}>
											{contentPolicyLabels[policy]}
										</option>
									))}
								</select>
							</Field>
							<Field label="限速 Profile">
								<Input
									value={draft.rateLimitProfile ?? ""}
									placeholder="留空使用系统默认限速"
									onChange={(event) =>
										onDraftChange({
											...draft,
											rateLimitProfile: event.target.value.trim() || null,
										})
									}
								/>
							</Field>
						</>
					) : (
						<EmptyState text="请选择接收人" />
					)}
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button type="button" disabled={!draft} onClick={onSubmit}>
							确认
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function NotificationChannelConfigEditor({
	config,
	onChange,
	onRemove,
}: {
	config: NotificationChannelConfig;
	onChange: (config: NotificationChannelConfig) => void;
	onRemove?: () => void;
}) {
	const readOnly = config.type === "email";

	return (
		<div className="grid gap-3 rounded-md border bg-background p-3">
			<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
				<div>
					<p className="font-medium">
						{notificationChannelConfigLabel(config)}
					</p>
					<p className="text-xs text-muted-foreground">配置 ID：{config.id}</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<BooleanField
						label="启用"
						checked={config.enabled}
						onCheckedChange={(enabled) => onChange({ ...config, enabled })}
					/>
					{onRemove ? (
						<Button
							type="button"
							size="sm"
							variant="destructive"
							onClick={onRemove}
						>
							删除
						</Button>
					) : null}
				</div>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<Field label="名称">
					<Input
						value={config.name}
						disabled={readOnly}
						onChange={(event) =>
							onChange({ ...config, name: event.target.value })
						}
					/>
				</Field>
				<Field label="说明">
					<Input
						value={config.description ?? ""}
						disabled={readOnly}
						onChange={(event) =>
							onChange({
								...config,
								description: event.target.value.trim() || null,
							})
						}
					/>
				</Field>
				{config.type === "webhook" ? (
					<>
						<Field label="Webhook URL">
							<Input
								value={configStringValue(config, "url")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											url: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="Webhook Secret">
							<Input
								type="password"
								autoComplete="new-password"
								placeholder={secretPlaceholder(
									Boolean(config.secretConfigured),
								)}
								value={secretStringValue(config, "secret")}
								onChange={(event) =>
									onChange({
										...config,
										secretConfig: {
											...(config.secretConfig ?? {}),
											secret: event.target.value,
										},
									})
								}
							/>
						</Field>
					</>
				) : null}
				{config.type === "wxpusher" ? (
					<>
						<Field label="WxPusher API URL">
							<Input
								value={configStringValue(config, "apiUrl")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											apiUrl: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="WxPusher App Token">
							<Input
								type="password"
								autoComplete="new-password"
								placeholder={secretPlaceholder(
									Boolean(config.secretConfigured),
								)}
								value={secretStringValue(config, "appToken")}
								onChange={(event) =>
									onChange({
										...config,
										secretConfig: {
											...(config.secretConfig ?? {}),
											appToken: event.target.value,
										},
									})
								}
							/>
						</Field>
						<Field label="接收目标摘要">
							<Input
								value={configStringValue(config, "targetSummary")}
								onChange={(event) =>
									onChange({
										...config,
										config: {
											...config.config,
											targetSummary: event.target.value,
										},
									})
								}
							/>
						</Field>
					</>
				) : null}
			</div>
		</div>
	);
}

function NotificationChannelTestDialog({
	open,
	config,
	defaultRecipient,
	onOpenChange,
	onTest,
	pending,
}: {
	open: boolean;
	config: NotificationChannelConfig;
	defaultRecipient?: string;
	onOpenChange: (open: boolean) => void;
	onTest: (input: { channelConfigId: string; recipient?: string }) => void;
	pending: boolean;
}) {
	const [recipient, setRecipient] = useState(defaultRecipient ?? "");

	useEffect(() => {
		if (open) {
			setRecipient(defaultRecipient ?? "");
		}
	}, [defaultRecipient, open]);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="520px">
				<Dialog.Title>测试通知通道</Dialog.Title>
				<Dialog.Description size="2">
					测试发送会创建 channel_test 通知任务，真实投递结果在任务中心查看。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					<div className="rounded-md border bg-muted/30 p-3 text-sm">
						<p className="font-medium">
							{notificationChannelConfigLabel(config)}
						</p>
						<p className="text-xs text-muted-foreground">
							{notificationChannelTargetSummary(config)}
						</p>
					</div>
					<Field label="测试收件人 / 目标">
						<Input
							value={recipient}
							placeholder="留空使用当前管理员邮箱或通道默认目标"
							onChange={(event) => setRecipient(event.target.value)}
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button
							type="button"
							disabled={pending}
							onClick={() =>
								onTest({
									channelConfigId: config.id,
									recipient: recipient.trim() || undefined,
								})
							}
						>
							创建测试任务
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function MailTestPanel({
	testable,
	reason,
	onOpen,
}: {
	testable: boolean;
	reason: string;
	onOpen: () => void;
}) {
	return (
		<div className="rounded-md border bg-background p-3">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div>
					<p className="font-medium">邮件测试</p>
					<p className="text-sm text-muted-foreground">
						创建邮件通道测试任务，投递结果在任务中心查看。
					</p>
					{reason ? (
						<p className="mt-1 text-xs text-muted-foreground">{reason}</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="outline"
					disabled={!testable}
					onClick={onOpen}
				>
					测试邮件
				</Button>
			</div>
		</div>
	);
}

function NotificationChannelConfigList({
	configs,
	onAdd,
	onEdit,
	onRemove,
	onTest,
}: {
	configs: NotificationChannelConfig[];
	onAdd: (type: Exclude<NotificationChannel, "email">) => void;
	onEdit: (config: NotificationChannelConfig) => void;
	onRemove: (config: NotificationChannelConfig) => void;
	onTest: (config: NotificationChannelConfig) => void;
}) {
	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={() => onAdd("webhook")}
				>
					添加 Webhook
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => onAdd("wxpusher")}
				>
					添加 WxPusher
				</Button>
			</div>
			<div className="overflow-x-auto rounded-md border bg-background">
				<table className="w-full text-left text-sm">
					<thead className="bg-muted/60">
						<tr>
							<th className="p-3">名称</th>
							<th className="p-3">类型</th>
							<th className="p-3">状态</th>
							<th className="p-3">目标</th>
							<th className="p-3">密钥</th>
							<th className="p-3">操作</th>
						</tr>
					</thead>
					<tbody>
						{configs.map((config) => (
							<tr key={config.id} className="border-t">
								<td className="p-3">
									<p className="font-medium">{config.name}</p>
									<p className="text-xs text-muted-foreground">{config.id}</p>
								</td>
								<td className="p-3">
									{notificationChannelLabels[config.type]}
								</td>
								<td className="p-3">
									<Badge variant={config.enabled ? "secondary" : "outline"}>
										{config.enabled ? "启用" : "停用"}
									</Badge>
								</td>
								<td className="p-3">
									{notificationChannelTargetSummary(config)}
								</td>
								<td className="p-3">
									{config.type === "email"
										? "使用 SMTP"
										: config.secretConfigured
											? "已配置"
											: "未配置"}
								</td>
								<td className="p-3">
									<div className="flex flex-wrap gap-2">
										{config.type === "email" ? null : (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => onEdit(config)}
											>
												编辑
											</Button>
										)}
										{config.type === "email" ? (
											<span className="text-xs text-muted-foreground">
												到邮件页签测试
											</span>
										) : (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={!config.enabled}
												onClick={() => onTest(config)}
											>
												测试
											</Button>
										)}
										{config.type === "email" ? null : (
											<Button
												type="button"
												size="sm"
												variant="destructive"
												onClick={() => onRemove(config)}
											>
												删除
											</Button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function NotificationChannelConfigDialog({
	open,
	draft,
	mode,
	onOpenChange,
	onDraftChange,
	onSubmit,
}: {
	open: boolean;
	draft: NotificationChannelConfig | null;
	mode: "create" | "edit";
	onOpenChange: (open: boolean) => void;
	onDraftChange: (draft: NotificationChannelConfig) => void;
	onSubmit: () => void;
}) {
	if (!draft) {
		return null;
	}
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="680px">
				<Dialog.Title>
					{mode === "create" ? "添加通知渠道" : "编辑通知渠道"}
				</Dialog.Title>
				<Dialog.Description size="2">
					确认后才写回渠道列表；密钥字段留空时保留已有配置。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					<NotificationChannelConfigEditor
						config={draft}
						onChange={onDraftChange}
					/>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button type="button" onClick={onSubmit}>
							确认
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

type NotificationTemplateDraft = {
	format: NotificationTemplateFormat;
	subjectTemplate: string;
	bodyTemplate: string;
};

function notificationTemplateDraftFrom(
	template: NotificationTemplate,
): NotificationTemplateDraft {
	return {
		format: template.format,
		subjectTemplate: template.subjectTemplate ?? "",
		bodyTemplate: template.bodyTemplate,
	};
}

function notificationTemplateOptionLabel(template: NotificationTemplate) {
	return `${template.channelLabel} / ${template.formatLabel}`;
}

function notificationTemplateResultSummary(result: {
	taskId: string;
	deliveryId: string;
	channel: NotificationChannel;
	recipient: string;
}) {
	return `已创建测试任务 ${result.taskId}，投递记录 ${result.deliveryId}，通道 ${
		notificationChannelLabels[result.channel]
	}，收件人 ${result.recipient}。`;
}

function NotificationTemplatePreview({
	format,
	preview,
}: {
	format: NotificationTemplateFormat;
	preview: RenderedNotificationTemplate | null;
}) {
	if (!preview) {
		return <EmptyState text="尚未生成预览" />;
	}
	if (format === "html") {
		return (
			<div className="grid gap-2 rounded-md border p-3 text-sm">
				<p className="font-medium">HTML 预览</p>
				{preview.subject ? (
					<p className="text-muted-foreground">主题：{preview.subject}</p>
				) : null}
				<iframe
					title="通知模板 HTML 预览"
					sandbox=""
					srcDoc={preview.body}
					className="h-56 w-full rounded border bg-background"
				/>
			</div>
		);
	}
	if (format === "json") {
		let formatted = preview.body;
		let error: string | null = null;
		try {
			formatted = JSON.stringify(JSON.parse(preview.body), null, 2);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		}
		return (
			<div className="grid gap-2 rounded-md border p-3 text-sm">
				<p className="font-medium">JSON 预览</p>
				{error ? (
					<p className="text-xs font-medium text-destructive">
						JSON 格式化失败：{error}
					</p>
				) : null}
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
					{formatted}
				</pre>
			</div>
		);
	}
	return (
		<div className="grid gap-2 rounded-md border p-3 text-sm">
			<p className="font-medium">文本预览</p>
			{preview.subject ? (
				<p className="text-muted-foreground">主题：{preview.subject}</p>
			) : null}
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
				{preview.body}
			</pre>
		</div>
	);
}

function NotificationTemplateTestDialog({
	open,
	template,
	recipient,
	onRecipientChange,
	onOpenChange,
	onSubmit,
	pending,
}: {
	open: boolean;
	template: NotificationTemplate | null;
	recipient: string;
	onRecipientChange: (recipient: string) => void;
	onOpenChange: (open: boolean) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Content maxWidth="520px">
				<Dialog.Title>测试发送模板</Dialog.Title>
				<Dialog.Description size="2">
					测试发送会创建 template_test 通知任务，真实投递结果在任务中心查看。
				</Dialog.Description>
				<div className="mt-4 grid gap-3">
					{template ? (
						<div className="rounded-md border bg-muted/30 p-3 text-sm">
							<p className="font-medium">{template.name}</p>
							<p className="text-xs text-muted-foreground">
								{notificationTemplateOptionLabel(template)}
							</p>
						</div>
					) : null}
					<Field label="测试收件人 / 目标">
						<Input
							value={recipient}
							placeholder="留空使用当前管理员邮箱"
							onChange={(event) => onRecipientChange(event.target.value)}
						/>
					</Field>
					<div className="flex justify-end gap-2">
						<Dialog.Close>
							<Button type="button" variant="outline">
								取消
							</Button>
						</Dialog.Close>
						<Button
							type="button"
							disabled={!template || pending}
							onClick={onSubmit}
						>
							创建测试任务
						</Button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function NotificationTemplatesPanel() {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const query = useQuery({
		queryKey: ["admin", "notification-templates"],
		queryFn: listNotificationTemplates,
	});
	const templates = query.data?.templates ?? [];
	const events = Array.from(
		templates
			.reduce((byEvent, template) => {
				if (!byEvent.has(template.eventType)) {
					byEvent.set(template.eventType, []);
				}
				byEvent.get(template.eventType)?.push(template);
				return byEvent;
			}, new Map<string, NotificationTemplate[]>())
			.entries(),
	).map(([eventType, eventTemplates]) => ({
		eventType,
		eventLabel: eventTemplates[0]?.eventLabel ?? eventType,
		eventDescription: eventTemplates[0]?.eventDescription ?? eventType,
		triggerDescription: eventTemplates[0]?.triggerDescription ?? eventType,
		recipientType: eventTemplates[0]?.recipientType ?? "通知接收人",
		templates: eventTemplates,
	}));
	const [selectedEventType, setSelectedEventType] = useState("");
	const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
	const [drafts, setDrafts] = useState<
		Record<string, NotificationTemplateDraft>
	>({});
	const [recipient, setRecipient] = useState("");
	const [testOpen, setTestOpen] = useState(false);
	const [preview, setPreview] = useState<RenderedNotificationTemplate | null>(
		null,
	);
	const selectedEvent =
		events.find((event) => event.eventType === selectedEventType) ?? events[0];
	const selectedTemplate =
		templates.find((template) => template.key === selectedTemplateKey) ??
		selectedEvent?.templates[0] ??
		null;
	const draft = selectedTemplate
		? (drafts[selectedTemplate.key] ??
			notificationTemplateDraftFrom(selectedTemplate))
		: null;
	const isDirty =
		Boolean(selectedTemplate && draft) &&
		(draft?.format !== selectedTemplate?.format ||
			draft?.subjectTemplate !== (selectedTemplate?.subjectTemplate ?? "") ||
			draft?.bodyTemplate !== selectedTemplate?.bodyTemplate);

	useEffect(() => {
		if (!selectedEventType && events[0]) {
			setSelectedEventType(events[0].eventType);
		}
	}, [events, selectedEventType]);

	useEffect(() => {
		if (
			selectedEvent &&
			(!selectedTemplateKey ||
				!selectedEvent.templates.some(
					(template) => template.key === selectedTemplateKey,
				))
		) {
			setSelectedTemplateKey(selectedEvent.templates[0]?.key ?? "");
			setPreview(null);
		}
	}, [selectedEvent, selectedTemplateKey]);

	const updateDraft = (
		template: NotificationTemplate,
		patch: Partial<NotificationTemplateDraft>,
	) => {
		setDrafts((current) => ({
			...current,
			[template.key]: {
				...(current[template.key] ?? notificationTemplateDraftFrom(template)),
				...patch,
			},
		}));
		setPreview(null);
	};
	const updateMutation = useMutation({
		mutationFn: (input: {
			templateKey: string;
			format: NotificationTemplateFormat;
			subjectTemplate: string | null;
			bodyTemplate: string;
		}) =>
			updateNotificationTemplate(input.templateKey, {
				format: input.format,
				subjectTemplate: input.subjectTemplate,
				bodyTemplate: input.bodyTemplate,
			}),
		onSuccess: ({ template }) => {
			setDrafts((current) => ({
				...current,
				[template.key]: notificationTemplateDraftFrom(template),
			}));
			setSelectedEventType(template.eventType);
			setSelectedTemplateKey(template.key);
			void queryClient.invalidateQueries({
				queryKey: ["admin", "notification-templates"],
			});
		},
	});
	const previewMutation = useMutation({
		mutationFn: (input: {
			templateKey: string;
			format: NotificationTemplateFormat;
			subjectTemplate: string | null;
			bodyTemplate: string;
		}) => previewNotificationTemplate(input.templateKey, input),
		onSuccess: ({ rendered }) => setPreview(rendered),
	});
	const restoreMutation = useMutation({
		mutationFn: restoreNotificationTemplateDefault,
		onSuccess: ({ template }) => {
			setDrafts((current) => ({
				...current,
				[template.key]: notificationTemplateDraftFrom(template),
			}));
			setSelectedEventType(template.eventType);
			setSelectedTemplateKey(template.key);
			setPreview(null);
			void queryClient.invalidateQueries({
				queryKey: ["admin", "notification-templates"],
			});
		},
	});
	const testMutation = useMutation({
		mutationFn: (input: { templateKey: string; recipient?: string }) =>
			testNotificationTemplate(input.templateKey, {
				recipient: input.recipient,
			}),
		onSuccess: ({ preview: rendered }) => {
			setPreview(rendered);
			setTestOpen(false);
		},
	});
	const currentPayload =
		selectedTemplate && draft
			? {
					templateKey: selectedTemplate.key,
					format: draft.format,
					subjectTemplate: selectedTemplate.supportsSubject
						? draft.subjectTemplate.trim() || null
						: null,
					bodyTemplate: draft.bodyTemplate,
				}
			: null;
	const restoreCurrentTemplate = async () => {
		if (!selectedTemplate) {
			return;
		}
		const confirmed = await confirm({
			title: "恢复默认模板",
			description: "确认恢复当前模板为默认内容？这个操作只影响当前模板。",
			confirmText: "恢复默认",
			destructive: true,
		});
		if (confirmed) {
			restoreMutation.mutate(selectedTemplate.key);
		}
	};
	const previewError = buildSettingsErrorModel(
		previewMutation.error,
		"模板预览失败。",
	);
	const updateError = buildSettingsErrorModel(
		updateMutation.error,
		"模板保存失败。",
	);
	const restoreError = buildSettingsErrorModel(
		restoreMutation.error,
		"恢复默认模板失败。",
	);
	const testError = buildSettingsErrorModel(
		testMutation.error,
		"模板测试发送失败。",
	);

	return (
		<SettingsSection
			title="模板管理"
			description="按事件和格式编辑通知模板；预览走服务端 renderer，测试发送只创建 template_test 任务。"
		>
			<div className="grid gap-4">
				<SettingsSaveError model={previewError} fallback="模板预览失败" />
				<SettingsSaveError model={updateError} fallback="模板保存失败" />
				<SettingsSaveError model={restoreError} fallback="恢复默认模板失败" />
				<SettingsSaveError model={testError} fallback="模板测试发送失败" />
				{templates.length === 0 ? (
					<EmptyState text={query.isLoading ? "模板加载中" : "暂无通知模板"} />
				) : null}
				{selectedEvent && selectedTemplate && draft ? (
					<>
						<div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(260px,1fr)]">
							<div className="grid gap-3 rounded-md border bg-background p-3">
								<Field label="通知事件">
									<select
										className={inputClass}
										value={selectedEvent.eventType}
										onChange={(event) => {
											const nextEvent = events.find(
												(item) => item.eventType === event.target.value,
											);
											setSelectedEventType(event.target.value);
											setSelectedTemplateKey(
												nextEvent?.templates[0]?.key ?? "",
											);
											setPreview(null);
										}}
									>
										{events.map((event) => (
											<option key={event.eventType} value={event.eventType}>
												{event.eventLabel}
											</option>
										))}
									</select>
								</Field>
								<Field label="通道 / 格式">
									<select
										className={inputClass}
										value={selectedTemplate.key}
										onChange={(event) => {
											setSelectedTemplateKey(event.target.value);
											setPreview(null);
										}}
									>
										{selectedEvent.templates.map((template) => (
											<option key={template.key} value={template.key}>
												{notificationTemplateOptionLabel(template)}
											</option>
										))}
									</select>
								</Field>
								<div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
									<p className="font-medium text-foreground">
										{selectedEvent.eventLabel}
									</p>
									<p>{selectedEvent.eventDescription}</p>
									<p>{selectedEvent.triggerDescription}</p>
									<p>接收人：{selectedEvent.recipientType}</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Badge
										variant={
											selectedTemplate.isCustomized ? "secondary" : "outline"
										}
									>
										{selectedTemplate.isCustomized ? "已自定义" : "默认"}
									</Badge>
									{isDirty ? <Badge variant="outline">未保存</Badge> : null}
									<Badge variant="outline">{selectedTemplate.key}</Badge>
								</div>
							</div>
							<div className="grid gap-3 rounded-md border bg-background p-3">
								<div>
									<p className="font-medium">{selectedTemplate.name}</p>
									<p className="text-sm leading-6 text-muted-foreground">
										{selectedTemplate.description}
									</p>
								</div>
								<div className="grid gap-3 md:grid-cols-2">
									<Field label="格式">
										<select
											className={inputClass}
											value={draft.format}
											onChange={(event) =>
												updateDraft(selectedTemplate, {
													format: event.target
														.value as NotificationTemplateFormat,
												})
											}
										>
											<option value="text">纯文本</option>
											<option value="html">HTML</option>
											<option value="json">JSON</option>
										</select>
									</Field>
									<Field label="当前通道">
										<Input
											value={selectedTemplate.channelLabel}
											readOnly
											aria-readonly="true"
										/>
									</Field>
								</div>
								{selectedTemplate.supportsSubject ? (
									<Field label="主题模板">
										<Input
											value={draft.subjectTemplate}
											onChange={(event) =>
												updateDraft(selectedTemplate, {
													subjectTemplate: event.target.value,
												})
											}
										/>
									</Field>
								) : (
									<div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
										当前模板格式不使用主题字段。
									</div>
								)}
								<Field label="正文模板">
									<textarea
										className={`${textareaClass} min-h-48 font-mono`}
										value={draft.bodyTemplate}
										onChange={(event) =>
											updateDraft(selectedTemplate, {
												bodyTemplate: event.target.value,
											})
										}
									/>
								</Field>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										disabled={!currentPayload || previewMutation.isPending}
										onClick={() =>
											currentPayload && previewMutation.mutate(currentPayload)
										}
									>
										刷新预览
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!currentPayload || updateMutation.isPending}
										onClick={() =>
											currentPayload && updateMutation.mutate(currentPayload)
										}
									>
										保存
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!selectedTemplate || restoreMutation.isPending}
										onClick={() => void restoreCurrentTemplate()}
									>
										恢复默认
									</Button>
									<Button
										type="button"
										variant="outline"
										disabled={!selectedTemplate || testMutation.isPending}
										onClick={() => setTestOpen(true)}
									>
										测试发送
									</Button>
								</div>
							</div>
						</div>
						<div className="grid gap-3 lg:grid-cols-[minmax(220px,320px)_1fr]">
							<div className="grid gap-2 rounded-md border bg-background p-3 text-sm">
								<p className="font-medium">可用占位符</p>
								{selectedTemplate.placeholders.map((placeholder) => (
									<div key={placeholder.path} className="rounded border p-2">
										<code className="text-xs">{`{{${placeholder.path}}}`}</code>
										<p className="mt-1 font-medium">{placeholder.label}</p>
										<p className="text-xs text-muted-foreground">
											{placeholder.description}
										</p>
										{draft.format === "json" && placeholder.jsonSupported ? (
											<code className="mt-1 block text-xs text-muted-foreground">
												{`{{json ${placeholder.path}}}`}
											</code>
										) : null}
									</div>
								))}
							</div>
							<NotificationTemplatePreview
								format={draft.format}
								preview={preview}
							/>
						</div>
						{testMutation.data ? (
							<div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
								{notificationTemplateResultSummary(testMutation.data)}
							</div>
						) : null}
						<NotificationTemplateTestDialog
							open={testOpen}
							template={selectedTemplate}
							recipient={recipient}
							onRecipientChange={setRecipient}
							onOpenChange={setTestOpen}
							onSubmit={() =>
								selectedTemplate &&
								testMutation.mutate({
									templateKey: selectedTemplate.key,
									recipient: recipient.trim() || undefined,
								})
							}
							pending={testMutation.isPending}
						/>
					</>
				) : null}
			</div>
		</SettingsSection>
	);
}

export function BlacklistPage({ siteKey }: { siteKey?: string }) {
	const queryClient = useQueryClient();
	const confirm = useAdminConfirmDialog();
	const [createOpen, setCreateOpen] = useState(false);
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
			setCreateOpen(false);
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
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<div>
						<CardTitle className="text-lg">黑名单规则</CardTitle>
						<CardDescription>
							按邮箱、访客或 IP 管理评论与访问拦截规则。
						</CardDescription>
					</div>
					<Button type="button" onClick={() => setCreateOpen(true)}>
						新增规则
					</Button>
				</div>
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
									{rule.reason ? ` / ${rule.reason}` : ""}
									{rule.expiresAt ? ` / 过期 ${rule.expiresAt}` : ""}
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
				<Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
					<Dialog.Content maxWidth="520px">
						<Dialog.Title>新增黑名单规则</Dialog.Title>
						<Dialog.Description size="2">
							确认后创建规则；取消不会保留新规则草稿。
						</Dialog.Description>
						<form
							className="mt-4 flex flex-col gap-3"
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
							<div className="flex justify-end gap-2">
								<Dialog.Close>
									<Button type="button" variant="outline">
										取消
									</Button>
								</Dialog.Close>
								<Button type="submit" disabled={createMutation.isPending}>
									新增规则
								</Button>
							</div>
						</form>
					</Dialog.Content>
				</Dialog.Root>
			</CardContent>
		</Card>
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
		onSuccess: (settings) => {
			setDraft(settings);
			queryClient.setQueryData(
				["admin", "settings", resolvedSiteKey],
				settings,
			);
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
	const notificationRecipients = draft.notifications.recipients ?? [];
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
				recipients,
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
						mutation.mutate({
							section: siteTab,
							payload: buildSiteSettingsSectionPayload(siteTab, draft),
						});
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
									<BooleanField
										label="当前站点邮件通知"
										description="控制当前站点是否创建通知任务；实例级邮件、Webhook、WxPusher 和队列限速在系统设置维护。"
										checked={draft.notifications.emailEnabled}
										error={firstFieldError(
											saveError,
											"notifications.emailEnabled",
										)}
										onCheckedChange={(emailEnabled) =>
											setDraft({
												...draft,
												notifications: {
													...draft.notifications,
													emailEnabled,
												},
											})
										}
									/>
									<SettingsSection
										title="后台接收人"
										description="接收人必须是启用状态且有当前站点权限的后台用户；保存后会替换当前站点接收人列表。"
									>
										<div className="grid gap-3">
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
	if (next.notifications.webhook.secret === "") {
		delete next.notifications.webhook.secret;
	}
	if (next.notifications.wxpusher.appToken === "") {
		delete next.notifications.wxpusher.appToken;
	}
	next.notifications.channelConfigs = next.notifications.channelConfigs.map(
		(config) => {
			const secretConfig = { ...(config.secretConfig ?? {}) };
			if (secretConfig.secret === "") {
				delete secretConfig.secret;
			}
			if (secretConfig.appToken === "") {
				delete secretConfig.appToken;
			}
			return {
				...config,
				secretConfig,
			};
		},
	);

	return next;
}

function secretPlaceholder(configured: boolean) {
	return configured ? "已配置，留空则保留" : "";
}

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
		onSuccess: (settings) => {
			setDraft(settings);
			setSavedMailSettings(settings.mail);
			queryClient.setQueryData(["admin", "system-settings"], settings);
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
							payload: buildSystemSettingsSectionPayload(systemTab, draft),
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
