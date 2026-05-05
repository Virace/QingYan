import { describe, expect, it } from "vitest";

import type { MigrationReportItem } from "../../apps/admin/src/api/import-export";
import {
	acceptByConfidence,
	acceptCandidate,
	formatMappingOverlay,
	hasBlockingUnresolvedItems,
	mapToPage,
	skipItem,
} from "../../apps/admin/src/components/admin/wp-migration-model";

function reportItem(input: {
	wpPostId: string;
	state?: MigrationReportItem["state"];
	confidence?: number;
	pageKey?: string;
	pageUrl?: string;
}): MigrationReportItem {
	return {
		state: input.state ?? "ready",
		wpPostId: input.wpPostId,
		postType: "post",
		title: `Post ${input.wpPostId}`,
		link: `https://example.com/${input.wpPostId}`,
		sourcePath: `/${input.wpPostId}`,
		sourceRelativePath: `${input.wpPostId}`,
		target: input.pageKey
			? {
					pageKey: input.pageKey,
					pageUrl: input.pageUrl,
					confidence: input.confidence ?? 100,
					source: "strategy",
				}
			: undefined,
		evidence: {
			status: "verified",
			confidence: input.confidence ?? 0,
			reasons: [],
		},
		commentSummary: {
			total: 1,
			migratable: 1,
			skipped: 0,
			maxDepth: 1,
		},
		warnings: [],
	};
}

describe("wp migration model", () => {
	it("accepts an existing candidate as a mapping overlay item", () => {
		const items = acceptCandidate(
			[],
			reportItem({
				wpPostId: "1",
				pageKey: "termux.html",
				pageUrl: "/termux.html",
			}),
		);

		expect(items).toEqual([
			{
				wpPostId: "1",
				decision: "map",
				reason: "confirmed_in_admin_ui",
				target: {
					pageKey: "termux.html",
					pageUrl: "/termux.html",
				},
			},
		]);
	});

	it("maps an item to a manually supplied pageKey", () => {
		const items = mapToPage([], reportItem({ wpPostId: "2" }), {
			pageKey: "manual.html",
			pageUrl: "/manual.html",
		});

		expect(items[0]).toMatchObject({
			wpPostId: "2",
			decision: "map",
			reason: "confirmed_in_admin_ui",
			target: {
				pageKey: "manual.html",
				pageUrl: "/manual.html",
			},
		});
	});

	it("marks an item as skipped", () => {
		const items = skipItem([], reportItem({ wpPostId: "3" }));

		expect(items).toEqual([
			{
				wpPostId: "3",
				decision: "skip",
				reason: "page_not_migrated",
			},
		]);
	});

	it("batch accepts high-confidence rows without accepting conflicts", () => {
		const items = acceptByConfidence(
			[],
			[
				reportItem({ wpPostId: "1", confidence: 100, pageKey: "one.html" }),
				reportItem({ wpPostId: "2", confidence: 90, pageKey: "two.html" }),
				reportItem({
					wpPostId: "3",
					state: "conflict",
					confidence: 100,
					pageKey: "same.html",
				}),
				reportItem({ wpPostId: "4", confidence: 85, pageKey: "four.html" }),
			],
			90,
		);

		expect(items.map((item) => item.wpPostId)).toEqual(["1", "2"]);
	});

	it("detects blocking unresolved rows", () => {
		expect(
			hasBlockingUnresolvedItems([
				reportItem({ wpPostId: "1", state: "ready", confidence: 100 }),
				reportItem({ wpPostId: "2", state: "unverified", confidence: 90 }),
			]),
		).toBe(false);
		expect(
			hasBlockingUnresolvedItems([
				reportItem({
					wpPostId: "1",
					state: "needs_user_mapping",
					confidence: 0,
				}),
			]),
		).toBe(true);
		expect(
			hasBlockingUnresolvedItems([
				reportItem({ wpPostId: "2", state: "unverified", confidence: 60 }),
			]),
		).toBe(true);
	});

	it("formats mapping overlay payload", () => {
		const overlay = formatMappingOverlay("fangyuan", "/", [
			{
				wpPostId: "1",
				decision: "skip",
				reason: "page_not_migrated",
			},
		]);

		expect(overlay).toEqual({
			siteKey: "fangyuan",
			sourceBasePath: "/",
			items: [
				{
					wpPostId: "1",
					decision: "skip",
					reason: "page_not_migrated",
				},
			],
		});
	});
});
