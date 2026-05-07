export interface ParsedReleaseVersion {
	major: number;
	minor: number;
	patch: number;
	normalized: string;
}

const releaseVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseReleaseVersion(
	value: string,
): ParsedReleaseVersion | null {
	const match = releaseVersionPattern.exec(value.trim());
	if (!match) {
		return null;
	}
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	return {
		major,
		minor,
		patch,
		normalized: `${major}.${minor}.${patch}`,
	};
}

export function compareParsedReleaseVersions(
	left: ParsedReleaseVersion,
	right: ParsedReleaseVersion,
): -1 | 0 | 1 {
	for (const key of ["major", "minor", "patch"] as const) {
		if (left[key] > right[key]) {
			return 1;
		}
		if (left[key] < right[key]) {
			return -1;
		}
	}
	return 0;
}

export function compareReleaseVersions(
	left: string,
	right: string,
): -1 | 0 | 1 {
	const leftVersion = parseReleaseVersion(left);
	const rightVersion = parseReleaseVersion(right);
	if (!leftVersion || !rightVersion) {
		throw new Error("Cannot compare invalid release versions");
	}
	return compareParsedReleaseVersions(leftVersion, rightVersion);
}
