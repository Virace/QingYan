import { describe, expect, it } from "vitest";
import { MemoryWriteQuotaStore } from "../../src/modules/shared/write-quota";

describe("business quota reservations", () => {
	it("reserves every dimension together and charges only committed operations", () => {
		const store = new MemoryWriteQuotaStore();
		const subject = { key: "subject", rule: { windowSec: 60, maxRequests: 1 } };
		const ip = { key: "ip", rule: { windowSec: 60, maxRequests: 1 } };
		const occupied = store.reserve([ip], "COMMENT_RATE_LIMITED");
		expect(() =>
			store.reserve([subject, ip], "COMMENT_RATE_LIMITED"),
		).toThrow();
		const uncharged = store.reserve([subject], "COMMENT_RATE_LIMITED");
		uncharged.release();
		occupied.release();
		const accepted = store.reserve([subject, ip], "COMMENT_RATE_LIMITED");
		accepted.commit();
		accepted.commit();
		accepted.release();
		expect(() => store.reserve([subject], "COMMENT_RATE_LIMITED")).toThrow();
		expect(() => store.reserve([ip], "COMMENT_RATE_LIMITED")).toThrow();
	});
	it("holds capacity for concurrent work and releases a rolled-back operation", () => {
		const store = new MemoryWriteQuotaStore();
		const rule = { key: "write", rule: { windowSec: 60, maxRequests: 1 } };
		const pending = store.reserve([rule], "COMMENT_RATE_LIMITED");
		expect(() => store.reserve([rule], "COMMENT_RATE_LIMITED")).toThrow();
		pending.release();
		expect(() => store.reserve([rule], "COMMENT_RATE_LIMITED")).not.toThrow();
	});
	it("invalidates old pending work when an administrator resets the affected window", () => {
		const store = new MemoryWriteQuotaStore();
		const rule = {
			key: "write:site:ip:one",
			rule: { windowSec: 60, maxRequests: 1 },
		};
		const pending = store.reserve([rule], "COMMENT_RATE_LIMITED");
		store.resetPrefix("write:site:ip:");
		expect(() => pending.assertActive()).toThrow();
		expect(() => store.reserve([rule], "COMMENT_RATE_LIMITED")).not.toThrow();
	});
});
