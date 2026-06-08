export type LocationPrecision = "country" | "province" | "city";

export interface IpRegionSnapshot {
	country: string | null;
	region: string | null;
	city: string | null;
	isp: string | null;
	raw: string;
}

function normalizePart(value: string | undefined): string | null {
	const normalized = value?.trim();
	if (!normalized || normalized === "0") {
		return null;
	}

	return normalized;
}

function stripChineseAreaSuffix(value: string): string {
	return value.replace(
		/(省|市|自治区|特别行政区|壮族自治区|回族自治区|维吾尔自治区)$/u,
		"",
	);
}

export function parseIpRegionText(regionText: string): IpRegionSnapshot {
	const parts = regionText.split("|");

	return {
		country: normalizePart(parts[0]),
		region: normalizePart(parts[1]),
		city: normalizePart(parts[2]),
		isp: normalizePart(parts[3]),
		raw: regionText,
	};
}

export function formatLocationLabel(
	snapshot: Pick<IpRegionSnapshot, "country" | "region" | "city">,
	precision: LocationPrecision,
): string | null {
	if (precision === "country") {
		return snapshot.country;
	}

	const isChina = snapshot.country === "中国";
	const region = snapshot.region
		? stripChineseAreaSuffix(snapshot.region)
		: null;
	const city = snapshot.city ? stripChineseAreaSuffix(snapshot.city) : null;

	if (!isChina) {
		return snapshot.country ?? region ?? city;
	}

	if (precision === "city") {
		if (region && city && region !== city) {
			return `${region}${city}`;
		}

		return city ?? region ?? snapshot.country;
	}

	return region ?? snapshot.country;
}
