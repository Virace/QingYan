import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
	adminUsers,
	allowlistRules,
	blacklistRules,
	captchaSessions,
	commentRequestMetadata,
	comments,
	pageThreads,
	securityPenalties,
	sitePageRegistry,
	siteSettings,
	visitors,
} from "../../src/db/schema";
import { hashKey } from "../../src/db/values";
import { readAbusePolicy } from "../../src/modules/comments/abuse-policy";
import { AbuseRepository } from "../../src/modules/comments/abuse-repository";
import { LocalReviewService } from "../../src/modules/comments/local-review";
import { CommentsWriteRepository } from "../../src/modules/comments/write-repository";
import { hashCommentEmail } from "../../src/modules/shared/comment-content";
import { loginAsAdmin, withAdminWriteAuth } from "../support/admin-login";
import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function createFixture() {
	const fixture = await createTestApp();
	cleanups.push(fixture.cleanup);
	const site = fixture.app.siteRegistry.getRegisteredSite("fangyuan");
	if (!site) throw new Error("Expected fixture site");
	await fixture.app.db.insert(sitePageRegistry).values({
		siteId: site.id,
		pageKey: "/posts/admission/",
		pageKeyHash: hashKey("/posts/admission/"),
		pageUrl: "/posts/admission/",
		status: "active",
	});
	await fixture.app.db.update(siteSettings).set({ captchaMode: "never" });
	return { ...fixture, site };
}

const publicHeaders = { referer: "http://localhost:4321/posts/admission/" };
const commentPayload = {
	siteKey: "fangyuan",
	pageTitle: "Admission",
	parentCommentId: null,
	author: { name: "Visitor", email: "visitor@example.org" },
	content: { raw: "A concrete comment about this article." },
};

async function issueGrant(fixture: Awaited<ReturnType<typeof createFixture>>) {
	const state = await fixture.app.inject({
		method: "GET",
		url: "/qingyan/api/comments/captcha/state?siteKey=fangyuan&action=comment_create",
		headers: publicHeaders,
	});
	expect(state.statusCode).toBe(200);
	const token = String(state.headers["x-qingyan-security"]);
	const challengeId = state.json().challenge.challengeId as string;
	const [session] = await fixture.app.db
		.select()
		.from(captchaSessions)
		.where(eq(captchaSessions.id, challengeId));
	const answer = (
		JSON.parse(session.challengePayloadJson ?? "{}") as { answer: string }
	).answer;
	const verified = await fixture.app.inject({
		method: "POST",
		url: "/qingyan/api/comments/captcha/verify",
		headers: { ...publicHeaders, "x-qingyan-security": token },
		payload: {
			siteKey: "fangyuan",
			challengeId,
			mode: "inline_value",
			value: answer,
		},
	});
	expect(verified.statusCode).toBe(200);
	return { token, challengeId };
}

describe("public write admission", () => {
	it.each([
		"email",
		"visitor",
	] as const)("keeps the %s security allowlist effective through final commit without bypassing quotas", async (targetType) => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({
				commentBurstMax: 1,
				violationThreshold: 3,
			}),
		});
		await new AbuseRepository(fixture.app.db).createPenalty({
			siteId: fixture.site.id,
			ip: "127.0.0.1",
			scope: "post",
			reason: "rate_limited",
			policy: readAbusePolicy(),
			count: 10,
		});
		await fixture.app.db.insert(allowlistRules).values({
			siteId: fixture.site.id,
			targetType,
			matchMode: "exact",
			targetValue:
				targetType === "email" ? "visitor@example.org" : "allowed-visitor",
			scope: "all",
		});
		const cookies =
			targetType === "visitor"
				? { qingyan_visitor: "allowed-visitor" }
				: undefined;
		const response = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			cookies,
			payload: commentPayload,
		});
		expect(response.statusCode).toBe(200);
		const nextCookies = {
			...cookies,
			...Object.fromEntries(
				response.cookies.map((cookie) => [cookie.name, cookie.value]),
			),
		};
		for (let index = 0; index < 4; index += 1) {
			const limited = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/comments",
				headers: publicHeaders,
				cookies: nextCookies,
				payload: commentPayload,
			});
			expect(limited.statusCode).toBe(429);
		}
		expect(await fixture.app.db.select().from(securityPenalties)).toHaveLength(
			1,
		);
	});
	it("uses one captcha grant once under concurrent writes even without visitor records", async () => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({
			captchaMode: "always",
			engagementJson: JSON.stringify({ visitors: { enabled: false } }),
		});
		const { token, challengeId } = await issueGrant(fixture);
		const responses = await Promise.all(
			[0, 1].map(() =>
				fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/comments",
					headers: { ...publicHeaders, "x-qingyan-security": token },
					payload: commentPayload,
				}),
			),
		);
		expect(responses.map((response) => response.statusCode).sort()).toEqual([
			200, 400,
		]);
		expect(await fixture.app.db.select().from(comments)).toHaveLength(1);
		expect(await fixture.app.db.select().from(visitors)).toHaveLength(0);
		const [session] = await fixture.app.db
			.select()
			.from(captchaSessions)
			.where(eq(captchaSessions.id, challengeId));
		expect(session.consumedAt).not.toBeNull();
	});

	it("keeps a comment grant available after another action or a failed write", async () => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({ captchaMode: "always" });
		const { token } = await issueGrant(fixture);
		const headers = { ...publicHeaders, "x-qingyan-security": token };
		const crossAction = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/page-feedback/like",
			headers,
			payload: { siteKey: "fangyuan", pageTitle: "Admission" },
		});
		expect(crossAction.statusCode).toBe(400);
		expect(crossAction.json().error.code).toBe(
			"PAGE_FEEDBACK_CAPTCHA_REQUIRED",
		);
		const missingParent = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers,
			payload: { ...commentPayload, parentCommentId: "missing-parent" },
		});
		expect(missingParent.statusCode).toBe(404);
		expect(await fixture.app.db.select().from(pageThreads)).toHaveLength(0);
		expect(await fixture.app.db.select().from(visitors)).toHaveLength(0);
		const retry = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers,
			payload: commentPayload,
		});
		expect(retry.statusCode).toBe(200);
	});

	it("rolls back captcha consumption with the business transaction", async () => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({ captchaMode: "always" });
		const { challengeId } = await issueGrant(fixture);
		const writer = new CommentsWriteRepository(fixture.app.db);
		const authorization = await writer.reserveCaptchaAuthorization(challengeId);
		await expect(
			fixture.app.db.transaction(async (tx) => {
				await new CommentsWriteRepository(tx).consumeCaptchaAuthorization(
					authorization,
				);
				throw new Error("business-write-rolled-back");
			}),
		).rejects.toThrow("business-write-rolled-back");
		await writer.releaseCaptchaAuthorization(authorization);
		const retryAuthorization =
			await writer.reserveCaptchaAuthorization(challengeId);
		await fixture.app.db.transaction((tx) =>
			new CommentsWriteRepository(tx).consumeCaptchaAuthorization(
				retryAuthorization,
			),
		);
		await expect(
			writer.reserveCaptchaAuthorization(challengeId),
		).rejects.toMatchObject({ code: "COMMENT_CAPTCHA_REQUIRED" });
	});

	it("allows six distinct visitors sharing an IP and blocks the next write after cookie clearing", async () => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({ commentIpMax: 6, ipBurstMax: 6 }),
		});
		const responses = await Promise.all(
			Array.from({ length: 6 }, (_, index) =>
				fixture.app.inject({
					method: "POST",
					url: "/qingyan/api/comments",
					headers: publicHeaders,
					payload: {
						...commentPayload,
						author: {
							name: `Visitor ${index}`,
							email: `visitor${index}@example.org`,
						},
					},
				}),
			),
		);
		expect(responses.map((response) => response.statusCode)).toEqual([
			200, 200, 200, 200, 200, 200,
		]);
		const next = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			payload: commentPayload,
		});
		expect(next.statusCode).toBe(429);
		expect(await fixture.app.db.select().from(comments)).toHaveLength(6);
		expect(await fixture.app.db.select().from(visitors)).toHaveLength(6);
	});

	it("persists penalties once, excludes revoked history and fences delayed violations after release", async () => {
		const fixture = await createFixture();
		const repository = new AbuseRepository(fixture.app.db);
		const policy = readAbusePolicy();
		const input = {
			siteId: fixture.site.id,
			ip: "203.0.113.10",
			scope: "post" as const,
			reason: "rate_limited",
			policy,
			count: 10,
		};
		const [first, duplicate] = await Promise.all([
			repository.createPenalty(input),
			repository.createPenalty(input),
		]);
		expect(first.id).toBe(duplicate.id);
		expect(Date.parse(first.expiresAt) - Date.parse(first.startedAt)).toBe(
			86400000,
		);
		await expect(
			new AbuseRepository(fixture.app.db).assertAllowed(
				fixture.site.id,
				input.ip,
			),
		).rejects.toMatchObject({ code: "COMMENT_BLACKLISTED" });
		await repository.release({
			ruleId: first.sourceRuleId ?? 0,
			kind: "revoked",
			reason: "Shared exit was misclassified",
		});
		const second = await repository.createPenalty(input);
		expect(Date.parse(second.expiresAt) - Date.parse(second.startedAt)).toBe(
			86400000,
		);
		const observedAt = Date.now() - 1;
		await repository.release({
			ruleId: second.sourceRuleId ?? 0,
			kind: "released",
			reason: "Allow a normal retry",
		});
		await repository.createPenalty({
			...input,
			violationObservedAt: observedAt,
		});
		expect(await fixture.app.db.select().from(securityPenalties)).toHaveLength(
			2,
		);
		const third = await repository.createPenalty(input);
		expect(Date.parse(third.expiresAt) - Date.parse(third.startedAt)).toBe(
			604800000,
		);
		expect(await fixture.app.db.select().from(blacklistRules)).toHaveLength(3);
	});

	it("uses mature or effective manual history and immediately ignores reverted approval", async () => {
		const fixture = await createFixture();
		await loginAsAdmin(fixture.app);
		const [admin] = await fixture.app.db
			.select()
			.from(adminUsers)
			.where(eq(adminUsers.username, "admin"));
		const [thread] = await fixture.app.db
			.insert(pageThreads)
			.values({
				siteId: fixture.site.id,
				pageKey: "/posts/admission/",
				pageKeyHash: hashKey("/posts/admission/"),
			})
			.returning();
		const identity = {
			siteId: fixture.site.id,
			authorName: "Visitor",
			authorEmail: "visitor@example.org",
			ip: "203.0.113.20",
			userAgent: "Test Browser",
		};
		const seed = async (
			id: string,
			approvedAt: string,
			approvalSource: string | null,
			approvedByUserId?: number,
		) => {
			await fixture.app.db.insert(comments).values({
				id,
				siteId: fixture.site.id,
				pageThreadId: thread.id,
				authorName: identity.authorName,
				authorEmailHash: hashCommentEmail(identity.authorEmail),
				contentRaw: "An established contribution.",
				status: "approved",
				approvedAt,
				approvalSource,
				approvedByUserId,
			});
			await fixture.app.db.insert(commentRequestMetadata).values({
				commentId: id,
				authorIp: identity.ip,
				authorUserAgent: identity.userAgent,
			});
		};
		const service = new LocalReviewService(fixture.app.db);
		await seed(
			"recent",
			new Date(Date.now() - 300000).toISOString(),
			"automatic",
		);
		await seed(
			"legacy",
			new Date(Date.now() - 40 * 86400000).toISOString(),
			null,
		);
		expect((await service.evaluate(identity)).decision).toBe("pending");
		await seed("manual", new Date().toISOString(), "manual", admin.id);
		expect((await service.evaluate(identity)).decision).toBe("approved");
		await fixture.app.db
			.update(comments)
			.set({ status: "pending" })
			.where(eq(comments.id, "manual"));
		expect((await service.evaluate(identity)).decision).toBe("pending");
		await seed(
			"mature-one",
			new Date(Date.now() - 35 * 86400000).toISOString(),
			"automatic",
		);
		await seed(
			"mature-two",
			new Date(Date.now() - 31 * 86400000).toISOString(),
			"automatic",
		);
		expect((await service.evaluate(identity)).decision).toBe("approved");
		await fixture.app.db
			.update(comments)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(comments.id, "mature-one"));
		expect((await service.evaluate(identity)).decision).toBe("pending");
	});

	it("allows the same subject to retry after an administrator releases its current penalty", async () => {
		const fixture = await createFixture();
		await fixture.app.db.update(siteSettings).set({
			abusePolicyJson: JSON.stringify({
				commentBurstMax: 1,
				violationThreshold: 3,
			}),
		});
		const first = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			payload: commentPayload,
		});
		expect(first.statusCode).toBe(200);
		const cookies = Object.fromEntries(
			first.cookies.map((cookie) => [cookie.name, cookie.value]),
		);
		for (let index = 0; index < 3; index += 1) {
			const limited = await fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/comments",
				cookies,
				headers: publicHeaders,
				payload: commentPayload,
			});
			expect(limited.statusCode).toBe(429);
		}
		const [penalty] = await fixture.app.db.select().from(securityPenalties);
		expect(penalty).toBeDefined();
		const auth = await loginAsAdmin(fixture.app);
		const release = await fixture.app.inject({
			method: "POST",
			url: `/qingyan/api/admin/blacklist/${penalty.sourceRuleId}/release`,
			...withAdminWriteAuth(auth),
			payload: { kind: "released", reason: "Normal visitor may retry" },
		});
		expect(release.statusCode).toBe(200);
		const retry = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			cookies,
			headers: publicHeaders,
			payload: commentPayload,
		});
		expect(retry.statusCode).toBe(200);
		expect(await fixture.app.db.select().from(securityPenalties)).toHaveLength(
			1,
		);
	});

	it("prunes expired local evidence beyond retention while preserving recent and active restrictions", async () => {
		const fixture = await createFixture();
		const repository = new AbuseRepository(fixture.app.db);
		const policy = readAbusePolicy();
		const now = Date.now();
		for (const [index, ageDays] of [120, 10, 0].entries())
			await repository.createPenalty({
				siteId: fixture.site.id,
				ip: `203.0.113.${30 + index}`,
				scope: "post",
				reason: "rate_limited",
				policy,
				count: 10,
				now: now - ageDays * 86400000,
			});
		expect(await repository.pruneExpired(fixture.site.id, policy, now)).toBe(1);
		expect(
			(await fixture.app.db.select().from(securityPenalties))
				.map((penalty) => penalty.ip)
				.sort(),
		).toEqual(["203.0.113.31", "203.0.113.32"]);
		expect(await fixture.app.db.select().from(blacklistRules)).toHaveLength(2);
	});

	it("previews an unsaved email policy and enforces it only after saving", async () => {
		const fixture = await createFixture();
		const auth = await loginAsAdmin(fixture.app);
		const policy = {
			mode: "allow_all",
			allowed: [],
			denied: [
				{ type: "domain", value: "example.org", includeSubdomains: false },
			],
			protectedDomains: [],
		};
		const preview = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/admin/settings/fangyuan/email-policy/preview",
			...withAdminWriteAuth(auth),
			payload: { email: "VISITOR@EXAMPLE.ORG", policy },
		});
		expect(preview.statusCode).toBe(200);
		expect(preview.json()).toMatchObject({
			result: "denied",
			source: "draft",
			saved: false,
		});
		const beforeSave = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			payload: commentPayload,
		});
		expect(beforeSave.statusCode).toBe(200);
		const saved = await fixture.app.inject({
			method: "PATCH",
			url: "/qingyan/api/admin/settings/fangyuan/sections/comments",
			...withAdminWriteAuth(auth),
			payload: { emailPolicy: policy },
		});
		expect(saved.statusCode).toBe(200);
		const afterSave = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			payload: commentPayload,
		});
		expect(afterSave.statusCode).toBe(403);
		expect(afterSave.json().error.code).toBe("COMMENT_EMAIL_NOT_ALLOWED");
		expect(await fixture.app.db.select().from(comments)).toHaveLength(1);
	});

	it("previews author email replacement and clearing without changing saved identity", async () => {
		const fixture = await createFixture();
		const auth = await loginAsAdmin(fixture.app);
		const savedAuthor = {
			enabled: false,
			displayName: "Saved author",
			email: "saved@example.org",
			website: "",
			badgeLabel: "Author",
		};
		await fixture.app.db
			.update(siteSettings)
			.set({ verifiedAuthorJson: JSON.stringify(savedAuthor) })
			.where(eq(siteSettings.siteId, fixture.site.id));
		const policy = {
			mode: "allow_all",
			allowed: [],
			denied: [],
			protectedDomains: [],
		};
		const preview = (payload: Record<string, unknown>) =>
			fixture.app.inject({
				method: "POST",
				url: "/qingyan/api/admin/settings/fangyuan/email-policy/preview",
				...withAdminWriteAuth(auth),
				payload: { policy, ...payload },
			});
		const replacement = await preview({
			email: "next@example.org",
			verifiedAuthorEmail: " NEXT@EXAMPLE.ORG ",
		});
		expect(replacement.statusCode).toBe(200);
		expect(replacement.json()).toMatchObject({
			result: "login_required",
			matchedRule: { type: "email", value: "next@example.org" },
			source: "draft",
			saved: false,
		});
		const previousAuthor = await preview({
			email: savedAuthor.email,
			verifiedAuthorEmail: "next@example.org",
		});
		expect(previousAuthor.statusCode).toBe(200);
		expect(previousAuthor.json().result).toBe("allowed");
		const savedFallback = await preview({ email: savedAuthor.email });
		expect(savedFallback.statusCode).toBe(200);
		expect(savedFallback.json().result).toBe("login_required");
		const cleared = await preview({
			email: savedAuthor.email,
			verifiedAuthorEmail: "",
		});
		expect(cleared.statusCode).toBe(200);
		expect(cleared.json().result).toBe("allowed");
		const invalid = await preview({
			email: savedAuthor.email,
			verifiedAuthorEmail: "invalid-author",
		});
		expect(invalid.statusCode).toBe(400);
		expect(invalid.json().error.code).toBe("VALIDATION_FAILED");
		const [stored] = await fixture.app.db
			.select()
			.from(siteSettings)
			.where(eq(siteSettings.siteId, fixture.site.id));
		expect(JSON.parse(stored.verifiedAuthorJson ?? "{}")).toEqual(savedAuthor);
		const publicSubmission = await fixture.app.inject({
			method: "POST",
			url: "/qingyan/api/comments",
			headers: publicHeaders,
			payload: {
				...commentPayload,
				author: { name: "Visitor", email: savedAuthor.email },
			},
		});
		expect(publicSubmission.statusCode).toBe(403);
		expect(publicSubmission.json().error.code).toBe(
			"VERIFIED_AUTHOR_EMAIL_RESERVED",
		);
	});
});
