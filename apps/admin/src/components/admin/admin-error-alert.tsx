import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function adminErrorMessage(error: unknown, fallback: string) {
	if (typeof error === "string" && error) {
		return error;
	}
	return error instanceof Error ? error.message : fallback;
}

export function AdminErrorAlert({
	error,
	title = "操作失败",
	fallback = "请求失败，请稍后重试。",
}: {
	error: unknown;
	title?: string;
	fallback?: string;
}) {
	return (
		<Alert variant="destructive">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{adminErrorMessage(error, fallback)}</AlertDescription>
		</Alert>
	);
}
