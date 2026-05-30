import type {
	AdminRequestMetaAggregate,
	AdminRequestMetaDisplay,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function metaValue(value: string | null | undefined) {
	return value || "-";
}

function RawRequestMeta({
	ip,
	userAgent,
	className,
}: {
	ip?: string | null;
	userAgent?: string | null;
	className?: string;
}) {
	if (!ip && !userAgent) {
		return null;
	}

	return (
		<details className={cn("text-xs text-muted-foreground", className)}>
			<summary className="cursor-pointer select-none">原始请求信息</summary>
			<div className="mt-1 grid gap-1">
				<p className="break-all">IP {metaValue(ip)}</p>
				<p className="break-all">UA {metaValue(userAgent)}</p>
			</div>
		</details>
	);
}

export function RequestMetaSummary({
	meta,
	fallbackIp,
	fallbackUserAgent,
	className,
}: {
	meta?: AdminRequestMetaDisplay | null;
	fallbackIp?: string | null;
	fallbackUserAgent?: string | null;
	className?: string;
}) {
	const ip = meta?.ip.raw ?? fallbackIp ?? null;
	const userAgent = meta?.userAgent.raw ?? fallbackUserAgent ?? null;
	const locationLabel = meta?.ip.location?.label ?? (ip ? "未知地区" : "-");
	const deviceLabel =
		meta?.userAgent.device?.label ?? (userAgent ? "未知设备" : "-");

	return (
		<div className={cn("grid gap-1 text-xs text-muted-foreground", className)}>
			<p className="truncate">地区 {locationLabel}</p>
			<p className="truncate">设备 {deviceLabel}</p>
			<RawRequestMeta ip={ip} userAgent={userAgent} />
		</div>
	);
}

export function RequestMetaAggregateBadges({
	items,
	emptyText,
	showDistinctIpCount = false,
}: {
	items?: AdminRequestMetaAggregate[];
	emptyText: string;
	showDistinctIpCount?: boolean;
}) {
	if (!items?.length) {
		return <span className="text-xs text-muted-foreground">{emptyText}</span>;
	}

	return (
		<div className="flex flex-wrap gap-1">
			{items.map((item) => (
				<Badge key={item.key} variant="outline">
					{item.label}
					<span className="ml-1 text-muted-foreground">x{item.count}</span>
					{showDistinctIpCount && item.distinctIpCount ? (
						<span className="ml-1 text-muted-foreground">
							IP {item.distinctIpCount}
						</span>
					) : null}
				</Badge>
			))}
		</div>
	);
}

export function RawRequestMetaList({
	ips,
	userAgents,
	fallbackIp,
	fallbackUserAgent,
	className,
}: {
	ips?: string[];
	userAgents?: string[];
	fallbackIp?: string | null;
	fallbackUserAgent?: string | null;
	className?: string;
}) {
	const ipText = ips?.length ? ips.join(", ") : fallbackIp;
	const userAgentText = userAgents?.length
		? userAgents.join(" | ")
		: fallbackUserAgent;

	return (
		<RawRequestMeta
			className={className}
			ip={ipText}
			userAgent={userAgentText}
		/>
	);
}
