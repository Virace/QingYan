import { useEffect, useState } from "react";
import { Dialog } from "@radix-ui/themes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	listNotificationTemplates,
	previewNotificationTemplate,
	restoreNotificationTemplateDefault,
	testNotificationTemplate,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
	BooleanField,
	EmptyState,
	Field,
	SettingsSection,
	inputClass,
	textareaClass,
} from "../shared/admin-ui";
import { useAdminConfirmDialog } from "../shared/confirm-dialog";
import {
	addRecipientRoute,
	availableNotificationChannelConfigs,
	contentPolicies,
	contentPolicyLabels,
	makeRecipientFromUser,
	notificationChannelConfigLabel,
	notificationChannelLabels,
	notificationChannelTargetSummary,
	removeRecipientRoute,
	siteNotificationEventLabels,
	siteNotificationEvents,
} from "../content/notification-ui-model";
import { buildSettingsErrorModel } from "./settings-error-model";
import {
	SettingsSaveError,
	configStringValue,
	secretPlaceholder,
	secretStringValue,
} from "./settings-shared";
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

export function SiteNotificationRecipientDialog({
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

export function NotificationChannelTestDialog({
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

export function MailTestPanel({
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

export function NotificationChannelConfigList({
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

export function NotificationChannelConfigDialog({
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
		} catch {
			error = "内容不是合法 JSON。";
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

export function NotificationTemplatesPanel() {
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
