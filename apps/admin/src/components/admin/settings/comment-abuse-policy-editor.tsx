import type { CommentAbusePolicy } from "@/api/admin";
import { Input } from "@/components/ui/input";
import { BooleanField, Field, SettingsSection } from "../shared/admin-ui";

const fields: Array<{
	key: Exclude<keyof CommentAbusePolicy, "syncToWaf">;
	label: string;
	min: number;
}> = [
	{ key: "commentIpMax", label: "每 IP 评论额度（沿用评论窗口）", min: 6 },
	{ key: "burstWindowSec", label: "突发窗口（秒）", min: 1 },
	{ key: "commentBurstMax", label: "每主体突发评论数", min: 1 },
	{ key: "ipBurstMax", label: "每 IP 突发评论数", min: 6 },
	{ key: "ipActionMultiplier", label: "互动 IP 额度倍率", min: 6 },
	{ key: "captchaWindowSec", label: "验证码操作窗口（秒）", min: 10 },
	{ key: "captchaRequestMax", label: "每主体验证码操作数", min: 5 },
	{ key: "captchaIpMax", label: "每 IP 验证码操作数", min: 30 },
	{ key: "violationWindowSec", label: "同类违规统计窗口（秒）", min: 10 },
	{ key: "violationThreshold", label: "触发限制的同类违规数", min: 3 },
	{ key: "penaltyTtlSec", label: "首次限制时长（秒）", min: 60 },
	{ key: "repeatPenaltyTtlSec", label: "复犯限制时长（秒）", min: 60 },
	{ key: "repeatWindowSec", label: "复犯判定窗口（秒）", min: 60 },
	{ key: "evidenceRetentionDays", label: "违规摘要保留天数", min: 7 },
];

export function CommentAbusePolicyEditor({
	policy,
	onChange,
}: {
	policy: CommentAbusePolicy;
	onChange: (policy: CommentAbusePolicy) => void;
}) {
	return (
		<SettingsSection
			title="写入额度与分级限制"
			description="普通超频先短暂限流，持续同类违规才限制来源。每 IP 额度独立于访客标识，共享网络可适当提高容量。"
		>
			<div className="grid max-w-5xl gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{fields.map(({ key, label, min }) => (
					<Field key={key} label={label}>
						<Input
							type="number"
							min={min}
							value={policy[key]}
							onChange={(event) =>
								onChange({ ...policy, [key]: Number(event.target.value) })
							}
						/>
					</Field>
				))}
			</div>
			<BooleanField
				label="将持续滥用限制同步到站点防火墙"
				description="仅在连接并配置面板网关后生效；会限制该 IP 对当前整站的访问，共享出口需谨慎开启。"
				checked={policy.syncToWaf}
				onCheckedChange={(syncToWaf) => onChange({ ...policy, syncToWaf })}
			/>
		</SettingsSection>
	);
}
