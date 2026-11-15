import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { DatabaseExecutor } from "../../db/client";
import { securitySubjects } from "../../db/schema";

export class SecuritySubjectService {
	public constructor(private readonly db: DatabaseExecutor) {}
	public async resolve(siteId: number, token?: string) {
		const now = new Date().toISOString();
		const digest = (value: string) =>
			createHash("sha256").update(value).digest("hex");
		if (token && /^[a-zA-Z0-9_-]{43}$/u.test(token)) {
			const [subject] = await this.db
				.select()
				.from(securitySubjects)
				.where(
					and(
						eq(securitySubjects.siteId, siteId),
						eq(securitySubjects.tokenHash, digest(token)),
						gt(securitySubjects.expiresAt, now),
					),
				)
				.limit(1);
			if (subject) return { ...subject, token };
		}
		await this.db
			.delete(securitySubjects)
			.where(lt(securitySubjects.expiresAt, now));
		const issuedToken = randomBytes(32).toString("base64url");
		const [subject] = await this.db
			.insert(securitySubjects)
			.values({
				id: `sec_${randomUUID().replaceAll("-", "")}`,
				siteId,
				tokenHash: digest(issuedToken),
				expiresAt: new Date(Date.now() + 86400000).toISOString(),
			})
			.returning();
		return { ...subject, token: issuedToken };
	}
}
