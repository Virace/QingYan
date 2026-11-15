import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";

const restoreMarkerSchema = z.object({
	kind: z.literal("qingyan_restore"),
	id: z.string().uuid(),
	requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function restoreHash(contents: string | Buffer): string {
	return createHash("sha256").update(contents).digest("hex");
}

export function assertRestoreFile(filePath: string, checksum: string): void {
	if (
		!lstatSync(filePath).isFile() ||
		restoreHash(readFileSync(filePath)) !== checksum
	)
		throw new Error("RESTORE_ARTIFACT_CONFLICT");
}

export function prepareRestoreDirectory(
	outputConfigPath: string,
	requestHash: string,
) {
	const directory = `${outputConfigPath}.restore`;
	const markerPath = path.join(directory, "restore.json");
	if (existsSync(directory)) {
		if (!lstatSync(directory).isDirectory() || !existsSync(markerPath))
			throw new Error("RESTORE_STATE_INVALID");
		const marker = restoreMarkerSchema.parse(
			JSON.parse(readFileSync(markerPath, "utf8")),
		);
		if (marker.requestHash !== requestHash)
			throw new Error("RESTORE_RECOVERY_REQUEST_MISMATCH");
		return { directory, marker, isRetry: true };
	}
	if (lstatSync(outputConfigPath, { throwIfNoEntry: false }))
		throw new Error("RESTORE_OUTPUT_CONFIG_EXISTS");
	mkdirSync(directory, { mode: 0o700 });
	const marker = {
		kind: "qingyan_restore" as const,
		id: randomUUID(),
		requestHash,
	};
	writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
		flush: true,
	});
	return { directory, marker, isRetry: false };
}

/** 恢复目录内的文件保持不可变，配置发布后仍可能与暂存文件共享 inode。 */
export function stageRestoreFile(filePath: string, contents: string | Buffer) {
	const checksum = restoreHash(contents);
	if (existsSync(filePath)) {
		assertRestoreFile(filePath, checksum);
		return;
	}
	mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, contents, {
		flag: "wx",
		mode: 0o600,
		flush: true,
	});
	renameSync(temporaryPath, filePath);
}

export function publishRestoreConfig(stagedPath: string, outputPath: string) {
	const checksum = restoreHash(readFileSync(stagedPath));
	try {
		linkSync(stagedPath, outputPath);
	} catch (error) {
		if (!existsSync(outputPath)) throw error;
		assertRestoreFile(outputPath, checksum);
	}
}
