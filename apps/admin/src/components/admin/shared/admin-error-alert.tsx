import { adminUiErrorMessage } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function adminErrorMessage(error: unknown, fallback: string) {
	return adminUiErrorMessage(error, fallback);
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
