interface PresenterCommentInput {
	id: string;
	parentId: string | null;
	authorName: string;
	authorWebsite: string | null;
	authorIp?: string | null;
	authorUserAgent?: string | null;
	authorIpCountry?: string | null;
	authorIpRegion?: string | null;
	authorIpCity?: string | null;
	authorIpLocationRaw?: string | null;
	authorDeviceBrowser?: string | null;
	authorDeviceOs?: string | null;
	authorDeviceType?: string | null;
	authorDeviceIcon?: string | null;
	contentRaw: string;
	contentHtml: string | null;
	status: string;
	isPinned: boolean;
	isFolded: boolean;
	replyCount: number;
	voteUpCount: number;
	voteDownCount: number;
	createdAt: string;
	updatedAt: string;
}

interface PresenterOptions {
	location?: {
		enabled: boolean;
		precision: "country" | "province" | "city";
	};
	device?: {
		enabled: boolean;
	};
}

function toPublicTimestamp(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const normalized = value.includes("T")
		? value
		: `${value.replace(" ", "T")}Z`;
	const timestamp = new Date(normalized);
	return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function renderHtml(raw: string, existingHtml: string | null): string {
	if (existingHtml) {
		return existingHtml;
	}

	return `<p>${raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")}</p>`;
}

function stripChineseAreaSuffix(value: string): string {
	return value.replace(
		/(省|市|自治区|特别行政区|壮族自治区|回族自治区|维吾尔自治区)$/u,
		"",
	);
}

function formatLocationLabel(
	comment: PresenterCommentInput,
	precision: "country" | "province" | "city",
): string | null {
	if (precision === "country") {
		return comment.authorIpCountry ?? null;
	}

	const isChina = comment.authorIpCountry === "中国";
	const region = comment.authorIpRegion
		? stripChineseAreaSuffix(comment.authorIpRegion)
		: null;
	const city = comment.authorIpCity
		? stripChineseAreaSuffix(comment.authorIpCity)
		: null;
	if (!isChina) {
		return comment.authorIpCountry ?? region ?? city ?? null;
	}

	if (precision === "city") {
		if (region && city && region !== city) {
			return `${region}${city}`;
		}

		return city ?? region ?? comment.authorIpCountry ?? null;
	}

	return region ?? comment.authorIpCountry ?? null;
}

function buildDisplayMeta(
	comment: PresenterCommentInput,
	options?: PresenterOptions,
) {
	const displayMeta: Record<string, unknown> = {};
	if (options?.location?.enabled) {
		const label = formatLocationLabel(comment, options.location.precision);
		if (label) {
			displayMeta.location = {
				label,
				precision: options.location.precision,
			};
		}
	}
	if (options?.device?.enabled && comment.authorDeviceIcon) {
		displayMeta.device = {
			browser: comment.authorDeviceBrowser ?? "unknown",
			os: comment.authorDeviceOs ?? "unknown",
			type: comment.authorDeviceType ?? "unknown",
			icon: comment.authorDeviceIcon,
		};
	}

	return Object.keys(displayMeta).length > 0 ? displayMeta : undefined;
}

export function presentComments(
	comments: PresenterCommentInput[],
	viewerVoteMap: Map<string, "up" | "down">,
	options?: PresenterOptions,
) {
	const nodes = new Map<string, Record<string, unknown>>();
	const rootNodes: Array<Record<string, unknown>> = [];

	for (const comment of comments) {
		const node: Record<string, unknown> = {
			id: comment.id,
			parentId: comment.parentId,
			author: {
				name: comment.authorName,
				website: comment.authorWebsite ?? undefined,
			},
			content: {
				raw: comment.contentRaw,
				html: renderHtml(comment.contentRaw, comment.contentHtml),
			},
			status: comment.status,
			isPinned: comment.isPinned,
			isFolded: comment.isFolded,
			replyCount: comment.replyCount,
			voteUp: comment.voteUpCount,
			voteDown: comment.voteDownCount,
			viewerVote: viewerVoteMap.get(comment.id) ?? null,
			createdAt: toPublicTimestamp(comment.createdAt),
			updatedAt: toPublicTimestamp(comment.updatedAt),
			children: [],
		};
		const displayMeta = buildDisplayMeta(comment, options);
		if (displayMeta) {
			node.displayMeta = displayMeta;
		}
		nodes.set(comment.id, node);
	}

	for (const comment of comments) {
		const node = nodes.get(comment.id);
		if (!node) {
			continue;
		}

		if (comment.parentId) {
			const parentNode = nodes.get(comment.parentId);
			const children = parentNode?.children;
			if (Array.isArray(children)) {
				children.push(node);
			}
			continue;
		}

		rootNodes.push(node);
	}

	return rootNodes;
}
