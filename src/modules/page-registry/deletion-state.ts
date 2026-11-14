import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";

import type { DatabaseExecutor } from "../../db/client";
import { delayedDeletions, sitePageRegistry } from "../../db/schema";

type DeletionRecord = Pick<
	typeof delayedDeletions.$inferSelect,
	| "id"
	| "resourceType"
	| "resourceId"
	| "siteId"
	| "requestedAt"
	| "metadataJson"
>;
type PageRecord = typeof sitePageRegistry.$inferSelect;
type PageReference = {
	pageKey: string;
	siteId?: number;
	id?: number;
	deletedAt?: string;
};

function readPageReferences(record: DeletionRecord): PageReference[] {
	let metadata: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(record.metadataJson ?? "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
			metadata = parsed as Record<string, unknown>;
	} catch {
		metadata = {};
	}
	const source =
		record.resourceType === "page"
			? [metadata.deletionSnapshot ?? { pageKey: record.resourceId }]
			: record.resourceType === "page_trash" && Array.isArray(metadata.pages)
				? metadata.pages
				: [];
	return source.flatMap((value): PageReference[] => {
		if (!value || typeof value !== "object") return [];
		const page = value as Record<string, unknown>;
		if (typeof page.pageKey !== "string") return [];
		return [
			{
				pageKey: page.pageKey,
				siteId:
					typeof page.siteId === "number"
						? page.siteId
						: (record.siteId ?? undefined),
				id: typeof page.id === "number" ? page.id : undefined,
				deletedAt:
					typeof page.deletedAt === "string" ? page.deletedAt : undefined,
			},
		];
	});
}

function refersToPage(reference: PageReference, page: PageRecord) {
	return (
		reference.pageKey === page.pageKey &&
		(reference.siteId === undefined || reference.siteId === page.siteId) &&
		(reference.id === undefined || reference.id === page.id)
	);
}

/** 列表、恢复与清理共用删除归属；旧记录只接受当前删除状态及最新对应登记。 */
export async function findDelayedDeletionPages(
	db: DatabaseExecutor,
	records: DeletionRecord[],
	lock = false,
) {
	const references = new Map(
		records.map((record) => [record.id, readPageReferences(record)]),
	);
	const pageKeys = [
		...new Set(
			[...references.values()].flatMap((pages) =>
				pages.map((page) => page.pageKey),
			),
		),
	];
	const matches = new Map<number, PageRecord[]>();
	if (pageKeys.length === 0) return matches;
	const pageQuery = db
		.select()
		.from(sitePageRegistry)
		.where(
			and(
				eq(sitePageRegistry.status, "deleted"),
				inArray(sitePageRegistry.pageKey, pageKeys),
			),
		)
		.orderBy(sitePageRegistry.id);
	const pages = await (lock ? pageQuery.for("update") : pageQuery);
	if (pages.length === 0) return matches;
	const siteIds = [...new Set(pages.map((page) => page.siteId))];
	const pagesByKey = new Map<string, PageRecord[]>();
	for (const page of pages)
		pagesByKey.set(page.pageKey, [
			...(pagesByKey.get(page.pageKey) ?? []),
			page,
		]);
	const owners = await db
		.select()
		.from(delayedDeletions)
		.where(
			and(
				gte(
					delayedDeletions.id,
					Math.min(...records.map((record) => record.id)),
				),
				inArray(delayedDeletions.resourceType, ["page", "page_trash"]),
				or(
					inArray(delayedDeletions.siteId, siteIds),
					isNull(delayedDeletions.siteId),
				),
			),
		);
	const latestOwner = new Map<number, number>();
	for (const owner of owners) {
		for (const reference of readPageReferences(owner)) {
			for (const page of pagesByKey.get(reference.pageKey) ?? []) {
				if (refersToPage(reference, page))
					latestOwner.set(
						page.id,
						Math.max(latestOwner.get(page.id) ?? 0, owner.id),
					);
			}
		}
	}
	for (const record of records) {
		const recordReferences = references.get(record.id) ?? [];
		const recordPages = new Map<number, PageRecord>();
		for (const reference of recordReferences) {
			const candidates = pagesByKey.get(reference.pageKey) ?? [];
			if (
				record.resourceType === "page" &&
				reference.siteId === undefined &&
				reference.id === undefined &&
				candidates.length !== 1
			)
				continue;
			for (const page of candidates) {
				if (
					latestOwner.get(page.id) !== record.id ||
					!page.deletedAt ||
					!refersToPage(reference, page)
				)
					continue;
				if (
					reference.deletedAt !== undefined
						? reference.deletedAt !== page.deletedAt
						: Date.parse(page.deletedAt) > Date.parse(record.requestedAt)
				)
					continue;
				recordPages.set(page.id, page);
			}
		}
		if (recordPages.size > 0) matches.set(record.id, [...recordPages.values()]);
	}
	return matches;
}
