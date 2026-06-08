import { describe, expect, it } from "vitest";

import {
	defaultVerifiedAuthor,
	defaultStaffDisplaySettings,
	isReservedVerifiedAuthorEmail,
	mergeStaffDisplaySettings,
	mergeVerifiedAuthorSettings,
	normalizeVerifiedAuthorEmail,
	serializeStaffDisplaySettings,
	toPublicVerifiedAuthorViewer,
} from "../../src/modules/comments/verified-author";

describe("verified comment author settings", () => {
	it("merges missing JSON with defaults", () => {
		expect(mergeVerifiedAuthorSettings(null)).toEqual(defaultVerifiedAuthor);
	});

	it("keeps configured display values", () => {
		expect(
			mergeVerifiedAuthorSettings(
				JSON.stringify({
					enabled: true,
					displayName: "Virace",
					email: "Owner@Example.COM ",
					website: "https://example.com",
					badgeLabel: "楼主",
				}),
			),
		).toEqual({
			enabled: true,
			displayName: "Virace",
			email: "owner@example.com",
			website: "https://example.com",
			badgeLabel: "楼主",
		});
	});

	it("normalizes emails for reservation checks", () => {
		expect(normalizeVerifiedAuthorEmail(" Owner@Example.COM ")).toBe(
			"owner@example.com",
		);
		expect(
			isReservedVerifiedAuthorEmail("owner@example.com", {
				...defaultVerifiedAuthor,
				email: "Owner@Example.COM",
			}),
		).toBe(true);
		expect(
			isReservedVerifiedAuthorEmail("visitor@example.com", {
				...defaultVerifiedAuthor,
				email: "owner@example.com",
			}),
		).toBe(false);
	});

	it("does not reserve an empty verified author email", () => {
		expect(
			isReservedVerifiedAuthorEmail("owner@example.com", {
				...defaultVerifiedAuthor,
				email: "",
			}),
		).toBe(false);
	});

	it("returns minimal public viewer only when enabled", () => {
		expect(
			toPublicVerifiedAuthorViewer({
				...defaultVerifiedAuthor,
				enabled: false,
				displayName: "Virace",
				badgeLabel: "楼主",
			}),
		).toBeUndefined();
		expect(
			toPublicVerifiedAuthorViewer({
				...defaultVerifiedAuthor,
				enabled: true,
				displayName: "Virace",
				badgeLabel: "楼主",
			}),
		).toEqual({ displayName: "Virace", badgeLabel: "楼主" });
	});

	it("merges staff display settings with current profile as the default", () => {
		expect(mergeStaffDisplaySettings(null)).toEqual(
			defaultStaffDisplaySettings,
		);
		expect(
			mergeStaffDisplaySettings(JSON.stringify({ nameMode: "snapshot" })),
		).toEqual({
			nameMode: "snapshot",
		});
		expect(
			mergeStaffDisplaySettings(JSON.stringify({ nameMode: "unexpected" })),
		).toEqual(defaultStaffDisplaySettings);
	});

	it("serializes staff display settings", () => {
		expect(
			JSON.parse(
				serializeStaffDisplaySettings({
					nameMode: "snapshot",
				}),
			),
		).toEqual({
			nameMode: "snapshot",
		});
	});
});
