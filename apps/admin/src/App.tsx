import { useEffect, useMemo, useState } from "react";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { toast, Toaster } from "sonner";

import { adminUiErrorMessage, ApiError, logAdminApiError } from "@/api/client";
import { fetchAdminMe } from "@/api/session";
import { AdminShell } from "@/components/admin/shell/admin-shell";
import { AdminConfirmDialogProvider } from "@/components/admin/shared/confirm-dialog";
import { LoginPage } from "@/components/admin/auth/login-page";
import { PasswordChangePage } from "@/components/admin/auth/password-change-page";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type AdminMutationMeta = {
	suppressGlobalToast?: boolean;
	suppressGlobalSuccessToast?: boolean;
	suppressGlobalErrorToast?: boolean;
	successMessage?: string;
	errorMessage?: string;
};

function adminMutationMeta(meta: unknown): AdminMutationMeta {
	return meta && typeof meta === "object" ? (meta as AdminMutationMeta) : {};
}

function createQueryClient(onUnauthorized: () => void) {
	return new QueryClient({
		queryCache: new QueryCache({
			onError(error, query) {
				if (error instanceof ApiError && error.statusCode === 401) {
					onUnauthorized();
					return;
				}
				logAdminApiError(error, {
					operation: "query",
					queryKey: query.queryKey,
				});
			},
		}),
		mutationCache: new MutationCache({
			onSuccess(_data, _variables, _context, mutation) {
				const meta = adminMutationMeta(mutation.options.meta);
				if (!meta.suppressGlobalToast && !meta.suppressGlobalSuccessToast) {
					toast.success(meta.successMessage ?? "操作已完成");
				}
			},
			onError(error, _variables, _context, mutation) {
				if (error instanceof ApiError && error.statusCode === 401) {
					onUnauthorized();
					return;
				}
				const meta = adminMutationMeta(mutation.options.meta);
				logAdminApiError(error, {
					operation: "mutation",
					label: meta.errorMessage,
					mutationKey: mutation.options.mutationKey,
				});
				if (!meta.suppressGlobalToast && !meta.suppressGlobalErrorToast) {
					toast.error(
						adminUiErrorMessage(
							error,
							meta.errorMessage ?? "操作失败，请查看控制台错误详情。",
						),
					);
				}
			},
		}),
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
}

function AppContent({
	authenticated,
	setAuthenticated,
}: {
	authenticated: boolean | null;
	setAuthenticated: (value: boolean) => void;
}) {
	const meQuery = useQuery({
		queryKey: ["admin", "me", "bootstrap"],
		queryFn: fetchAdminMe,
		retry: false,
	});

	useEffect(() => {
		if (meQuery.isSuccess) {
			setAuthenticated(true);
		}
		if (meQuery.error instanceof ApiError && meQuery.error.statusCode === 401) {
			setAuthenticated(false);
		}
	}, [meQuery.error, meQuery.isSuccess, setAuthenticated]);

	if (authenticated === null && meQuery.isLoading) {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-muted/40">
				<Card className="w-[320px]">
					<CardHeader>
						<CardTitle className="text-base">正在载入</CardTitle>
						<CardDescription>检查管理员会话状态。</CardDescription>
					</CardHeader>
				</Card>
			</main>
		);
	}

	if (authenticated && !meQuery.data) {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-muted/40">
				<Card className="w-[320px]">
					<CardHeader>
						<CardTitle className="text-base">正在载入</CardTitle>
						<CardDescription>同步管理员会话状态。</CardDescription>
					</CardHeader>
				</Card>
			</main>
		);
	}

	return authenticated ? (
		meQuery.data?.user.passwordChangeRequired ? (
			<PasswordChangePage onChanged={() => meQuery.refetch()} />
		) : (
			<AdminShell onLogout={() => setAuthenticated(false)} />
		)
	) : (
		<LoginPage
			onLogin={() => {
				setAuthenticated(true);
				void meQuery.refetch();
			}}
		/>
	);
}

export default function App() {
	const [authenticated, setAuthenticated] = useState<boolean | null>(null);
	const queryClient = useMemo(
		() =>
			createQueryClient(() => {
				setAuthenticated(false);
			}),
		[],
	);

	return (
		<QueryClientProvider client={queryClient}>
			<AdminConfirmDialogProvider>
				<AppContent
					authenticated={authenticated}
					setAuthenticated={setAuthenticated}
				/>
			</AdminConfirmDialogProvider>
			<Toaster richColors position="top-right" />
		</QueryClientProvider>
	);
}
