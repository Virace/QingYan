import { buildExternalAvatarUrl } from "./gravatar";
import { sanitizeOptionalSafeHttpUrl } from "../shared/url-policy";
import type {
	CommentAuthorIdentity,
	StaffDisplaySettings,
} from "./verified-author";
import type { SystemSettings } from "../system-settings/definitions";

interface PresenterCommentInput {
	id: string;
	parentId: string | null;
	authorIdentity?: CommentAuthorIdentity | string;
	authorName: string;
	authorEmail: string | null;
	authorEmailHash: string | null;
	authorWebsite: string | null;
	staffUserDisplayName?: string | null;
	staffUserEmail?: string | null;
	staffUserWebsite?: string | null;
	staffUserAvatarUrl?: string | null;
	authorIp?: string | null;
	authorUserAgent?: string | null;
	authorIpCountry?: string | null;
	authorIpRegion?: string | null;
	authorIpCity?: string | null;
	authorIpLocationRaw?: string | null;
	authorDeviceBrowser?: string | null;
	authorDeviceBrowserVersion?: string | null;
	authorDeviceOs?: string | null;
	authorDeviceOsVersion?: string | null;
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
	avatar?: SystemSettings["avatar"];
	verifiedAuthor?: {
		enabled: boolean;
		displayName?: string;
		badgeLabel: string;
	};
	staffDisplay?: StaffDisplaySettings;
	commentVotes?: {
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

function renderHtml(raw: string): string {
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
	if (
		options?.device?.enabled &&
		(comment.authorDeviceBrowser ||
			comment.authorDeviceOs ||
			comment.authorDeviceType)
	) {
		displayMeta.device = {
			browser: comment.authorDeviceBrowser ?? "unknown",
			browserVersion: comment.authorDeviceBrowserVersion ?? null,
			os: comment.authorDeviceOs ?? "unknown",
			osVersion: comment.authorDeviceOsVersion ?? null,
			type: comment.authorDeviceType ?? "unknown",
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
	const childBuckets = new Map<string, Array<Record<string, unknown>>>();
	const rootNodes: Array<Record<string, unknown>> = [];

	for (const comment of comments) {
		const verifiedAuthor = options?.verifiedAuthor;
		const isVerifiedAuthor =
			(comment.authorIdentity === "verified" ||
				comment.authorIdentity === "staff") &&
			verifiedAuthor?.enabled === true;
		const shouldUseCurrentStaffProfile =
			isVerifiedAuthor &&
			comment.authorIdentity === "staff" &&
			(options?.staffDisplay?.nameMode ?? "current_profile") ===
				"current_profile" &&
			Boolean(comment.staffUserDisplayName);
		const displayEmail = shouldUseCurrentStaffProfile
			? (comment.staffUserEmail ?? comment.authorEmail)
			: comment.authorEmail;
		const author: Record<string, unknown> = {
			name: shouldUseCurrentStaffProfile
				? comment.staffUserDisplayName
				: comment.authorName,
			website: sanitizeOptionalSafeHttpUrl(
				shouldUseCurrentStaffProfile
					? (comment.staffUserWebsite ?? comment.authorWebsite)
					: comment.authorWebsite,
			),
			avatarUrl:
				shouldUseCurrentStaffProfile && comment.staffUserAvatarUrl
					? comment.staffUserAvatarUrl
					: buildExternalAvatarUrl({
							enabled: options?.avatar?.external.enabled ?? false,
							email: displayEmail,
							baseUrl:
								options?.avatar?.external.baseUrl ??
								"https://gravatar.com/avatar",
							hashAlgorithm:
								options?.avatar?.external.hashAlgorithm ?? "sha256",
							query: options?.avatar?.external.query ?? "s=80&d=404&r=g",
						}),
		};
		if (isVerifiedAuthor && verifiedAuthor?.badgeLabel) {
			author.badge = {
				label: verifiedAuthor.badgeLabel,
			};
		}
		const node: Record<string, unknown> = {
			id: comment.id,
			author,
			content: {
				raw: comment.contentRaw,
				html: renderHtml(comment.contentRaw),
			},
			status: comment.status,
			isPinned: comment.isPinned,
			isFolded: comment.isFolded,
			replyCount: comment.replyCount,
			createdAt: toPublicTimestamp(comment.createdAt),
			updatedAt: toPublicTimestamp(comment.updatedAt),
		};
		if (comment.parentId) {
			node.parentId = comment.parentId;
		}
		if (options?.commentVotes?.enabled) {
			const viewerVote = viewerVoteMap.get(comment.id);
			node.vote = {
				up: comment.voteUpCount,
				down: comment.voteDownCount,
				...(viewerVote ? { viewer: viewerVote } : {}),
			};
		}
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
			const children = childBuckets.get(comment.parentId) ?? [];
			children.push(node);
			childBuckets.set(comment.parentId, children);
			continue;
		}

		rootNodes.push(node);
	}

	for (const root of rootNodes) {
		attachChildren(root, childBuckets);
	}

	return rootNodes;
}

function attachChildren(
	node: Record<string, unknown>,
	childBuckets: Map<string, Array<Record<string, unknown>>>,
) {
	const children = childBuckets.get(String(node.id));
	if (!children || children.length === 0) {
		return;
	}
	for (const child of children) {
		attachChildren(child, childBuckets);
	}
	node.children = children;
}
