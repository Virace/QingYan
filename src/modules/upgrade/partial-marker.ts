import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export interface PartialUpgradeMarker {
	kind: "qingyan_partial_upgrade";
	startedAt: string;
	fromVersion: string;
	toVersion: string;
	planPath: string;
	backupDirectory: string;
	currentStep: string;
	error?: string;
}

interface WritePartialMarkerInput {
	markerPath: string;
	fromVersion: string;
	toVersion: string;
	planPath: string;
	backupDirectory: string;
	currentStep: string;
	now?: () => Date;
}

function fallbackMarker(error: unknown): PartialUpgradeMarker {
	return {
		kind: "qingyan_partial_upgrade",
		startedAt: "",
		fromVersion: "unknown",
		toVersion: "unknown",
		planPath: "",
		backupDirectory: "",
		currentStep: "marker_read_failed",
		error: error instanceof Error ? error.message : String(error),
	};
}

function writeMarker(markerPath: string, marker: PartialUpgradeMarker) {
	mkdirSync(path.dirname(markerPath), { recursive: true });
	writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
}

export function readPartialUpgradeMarker(
	markerPath: string,
): PartialUpgradeMarker | null {
	if (!existsSync(markerPath)) {
		return null;
	}
	try {
		const marker = JSON.parse(
			readFileSync(markerPath, "utf-8"),
		) as PartialUpgradeMarker;
		if (marker.kind !== "qingyan_partial_upgrade") {
			return fallbackMarker(new Error("Invalid partial upgrade marker kind."));
		}
		return marker;
	} catch (error) {
		return fallbackMarker(error);
	}
}

export function writePartialUpgradeMarker(
	input: WritePartialMarkerInput,
): PartialUpgradeMarker {
	const marker: PartialUpgradeMarker = {
		kind: "qingyan_partial_upgrade",
		startedAt: (input.now?.() ?? new Date()).toISOString(),
		fromVersion: input.fromVersion,
		toVersion: input.toVersion,
		planPath: input.planPath,
		backupDirectory: input.backupDirectory,
		currentStep: input.currentStep,
	};
	writeMarker(input.markerPath, marker);
	return marker;
}

export function updatePartialUpgradeMarker(
	markerPath: string,
	patch: Partial<Pick<PartialUpgradeMarker, "currentStep" | "error">>,
): PartialUpgradeMarker {
	const marker =
		readPartialUpgradeMarker(markerPath) ??
		fallbackMarker(new Error("Partial upgrade marker is missing."));
	const nextMarker = {
		...marker,
		...patch,
	};
	writeMarker(markerPath, nextMarker);
	return nextMarker;
}

export function removePartialUpgradeMarker(markerPath: string): void {
	rmSync(markerPath, { force: true });
}
