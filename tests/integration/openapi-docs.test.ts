import { afterEach, describe, expect, it } from "vitest";

import { createTestApp } from "../support/test-fixtures";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) {
		await cleanup();
	}
});

describe("openapi docs", () => {
	it("serves yaml, json and docs html", async () => {
		const fixture = await createTestApp();
		cleanups.push(fixture.cleanup);

		const yaml = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/openapi.yaml",
		});
		const json = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/openapi.json",
		});
		const docs = await fixture.app.inject({
			method: "GET",
			url: "/qingyan/docs",
		});
		const rootYaml = await fixture.app.inject({
			method: "GET",
			url: "/openapi.yaml",
		});

		expect(rootYaml.statusCode).toBe(404);
		expect(yaml.statusCode).toBe(200);
		expect(yaml.headers["content-type"]).toContain("application/yaml");
		expect(yaml.body).toContain("openapi: 3.1.0");
		expect(yaml.body).toContain("servers:");
		expect(yaml.body).toContain("url: /qingyan");
		expect(yaml.body).toContain("/api/comments/bootstrap");
		expect(yaml.body).toContain("/api/comments/captcha/widget");
		expect(yaml.body).toContain("/api/comments/captcha/complete");
		expect(yaml.body).toContain("iframe_widget");
		expect(yaml.body).toContain("CommentDisplayMeta");
		expect(yaml.body).toContain("authorUserAgent");

		expect(json.statusCode).toBe(200);
		expect(json.json()).toMatchObject({
			openapi: "3.1.0",
			info: {
				title: "QingYan API",
			},
		});
		const spec = json.json();
		expect(
			spec.components.schemas.CreateCommentResponse.properties.comment.$ref,
		).toBe("#/components/schemas/PublicComment");
		expect(spec.components.schemas.CreateCommentRequest.required).not.toContain(
			"options",
		);
		expect(JSON.stringify(spec.components.schemas.CommentAuthor)).toContain(
			"avatarUrl",
		);
		expect(JSON.stringify(spec.components.schemas.CommentAuthor)).not.toContain(
			"gravatarUrl",
		);
		expect(
			JSON.stringify(spec.components.schemas.CommentAvatarDisplay),
		).toContain("external");
		expect(
			JSON.stringify(spec.components.schemas.CommentAvatarDisplay),
		).not.toContain("gravatar");
		expect(spec.components.schemas.BootstrapResponse.required).toEqual([
			"schemaVersion",
			"site",
			"page",
			"features",
			"data",
		]);
		expect(
			spec.components.schemas.BootstrapResponse.properties.features.$ref,
		).toBe("#/components/schemas/PublicFeatures");
		expect(spec.components.schemas.BootstrapResponse.properties.data.$ref).toBe(
			"#/components/schemas/BootstrapData",
		);
		expect(
			JSON.stringify(spec.components.schemas.BootstrapResponse),
		).not.toContain("pageMetrics");
		expect(
			JSON.stringify(spec.components.schemas.BootstrapResponse),
		).not.toContain("pageFeedback");
		expect(
			JSON.stringify(spec.components.schemas.BootstrapResponse),
		).not.toContain("commentForm");
		expect(spec.components.schemas.PublicFeatures.required).toEqual([
			"comments",
			"commentReplies",
			"commentVotes",
			"commentCaptcha",
			"pageViews",
			"pageLikes",
			"visitors",
			"replyEmailNotification",
		]);
		expect(
			spec.components.schemas.PublicFeatures.properties.replyEmailNotification
				.allOf[0].$ref,
		).toBe("#/components/schemas/FeatureFlag");
		expect(spec.components.schemas.FeatureFlag.required).toEqual(["enabled"]);
		expect(JSON.stringify(spec.components.schemas.PublicComment)).not.toContain(
			"viewerVote",
		);
		expect(JSON.stringify(spec.components.schemas.PublicComment)).not.toContain(
			"voteUp",
		);
		expect(spec.components.schemas.ThreadResponse.required).toEqual([
			"display",
			"pagination",
			"items",
		]);
		expect(spec.components.schemas.VoteCommentResponse.required).toEqual([
			"commentId",
			"vote",
		]);
		expect(spec.components.schemas.PageLikeResponse.required).toEqual([
			"pageLikes",
		]);

		expect(docs.statusCode).toBe(200);
		expect(docs.headers["content-type"]).toContain("text/html");
		expect(docs.body).toContain("QingYan API");
		expect(docs.body).toContain("/qingyan/openapi.yaml");
	});
});
