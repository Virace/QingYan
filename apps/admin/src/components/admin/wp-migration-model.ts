import type { MigrationReportItem } from "../../api/import-export";

export type AuthorCandidateDecision = "staff" | "verified" | "visitor";
export type AuthorCandidateDecisionMap = Record<
	string,
	AuthorCandidateDecision
>;

export interface AuthorCandidateComment {
	oldCommentId: string;
	wpPostId: string;
	title: string;
	authorName: string;
	authorEmail?: string;
	wpAuthorId?: string;
	wpAuthorEmail?: string;
}

export interface MappingOverlayItem {
	wpPostId: string;
	decision: "map" | "skip";
	reason: string;
	target?: {
		pageKey: string;
		pageUrl?: string;
	};
}

export interface MappingOverlay {
	siteKey: string;
	sourceBasePath: string;
	items: MappingOverlayItem[];
}

function itemConfidence(item: MigrationReportItem) {
	return item.target?.confidence ?? item.evidence.confidence;
}

function canAcceptCandidate(item: MigrationReportItem) {
	return item.state !== "conflict" && item.state !== "skipped" && item.target;
}

export function upsertMappingItem(
	items: MappingOverlayItem[],
	item: MappingOverlayItem,
) {
	const next = items.filter((existing) => existing.wpPostId !== item.wpPostId);
	next.push(item);
	return next;
}

export function acceptCandidate(
	items: MappingOverlayItem[],
	item: MigrationReportItem,
) {
	if (!item.target) {
		return items;
	}
	return upsertMappingItem(items, {
		wpPostId: item.wpPostId,
		decision: "map",
		reason: "confirmed_in_admin_ui",
		target: {
			pageKey: item.target.pageKey,
			pageUrl: item.target.pageUrl,
		},
	});
}

export function mapToPage(
	items: MappingOverlayItem[],
	item: MigrationReportItem,
	target: { pageKey: string; pageUrl?: string },
) {
	return upsertMappingItem(items, {
		wpPostId: item.wpPostId,
		decision: "map",
		reason: "confirmed_in_admin_ui",
		target: {
			pageKey: target.pageKey,
			pageUrl: target.pageUrl,
		},
	});
}

export function skipItem(
	items: MappingOverlayItem[],
	item: MigrationReportItem,
) {
	return upsertMappingItem(items, {
		wpPostId: item.wpPostId,
		decision: "skip",
		reason: "page_not_migrated",
	});
}

export function acceptByConfidence(
	items: MappingOverlayItem[],
	reportItems: MigrationReportItem[],
	minConfidence: number,
) {
	return reportItems
		.filter((item) => canAcceptCandidate(item))
		.filter((item) => itemConfidence(item) >= minConfidence)
		.reduce((current, item) => acceptCandidate(current, item), items);
}

export function acceptImportableItems(
	items: MappingOverlayItem[],
	reportItems: MigrationReportItem[],
) {
	return reportItems
		.filter((item) => canAcceptCandidate(item))
		.reduce((current, item) => acceptCandidate(current, item), items);
}

export function lowConfidenceImportableItems(
	reportItems: MigrationReportItem[],
	minConfidence: number,
) {
	return reportItems
		.filter((item) => canAcceptCandidate(item))
		.filter((item) => itemConfidence(item) < minConfidence);
}

export function hasBlockingUnresolvedItems(items: MigrationReportItem[]) {
	return items.some((item) => {
		if (
			item.state === "needs_user_mapping" ||
			item.state === "ambiguous" ||
			item.state === "conflict"
		) {
			return true;
		}
		return item.state === "unverified" && itemConfidence(item) < 85;
	});
}

export function authorCandidateComments(
	items: MigrationReportItem[],
): AuthorCandidateComment[] {
	return items.flatMap((item) =>
		(item.comments ?? [])
			.filter(
				(comment) => comment.authorMatch?.kind === "staff_email_candidate",
			)
			.map((comment) => ({
				oldCommentId: comment.oldCommentId,
				wpPostId: item.wpPostId,
				title: item.title,
				authorName: comment.authorName,
				authorEmail: comment.authorEmail,
				wpAuthorId: comment.authorMatch?.wpAuthorId,
				wpAuthorEmail: comment.authorMatch?.email,
			})),
	);
}

export function setAuthorCandidateDecision(
	decisions: AuthorCandidateDecisionMap,
	oldCommentId: string,
	decision: AuthorCandidateDecision,
): AuthorCandidateDecisionMap {
	return {
		...decisions,
		[oldCommentId]: decision,
	};
}

export function setAllAuthorCandidateDecisions(
	items: MigrationReportItem[],
	decisions: AuthorCandidateDecisionMap,
	decision: AuthorCandidateDecision,
): AuthorCandidateDecisionMap {
	return authorCandidateComments(items).reduce<AuthorCandidateDecisionMap>(
		(current, candidate) =>
			setAuthorCandidateDecision(current, candidate.oldCommentId, decision),
		decisions,
	);
}

export function hasBlockingAuthorCandidates(
	items: MigrationReportItem[],
	decisions: AuthorCandidateDecisionMap,
): boolean {
	void items;
	void decisions;
	return false;
}

export function formatMappingOverlay(
	siteKey: string,
	sourceBasePath: string,
	items: MappingOverlayItem[],
): MappingOverlay {
	return {
		siteKey,
		sourceBasePath,
		items,
	};
}
