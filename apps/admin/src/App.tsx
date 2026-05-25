import { useEffect, useMemo, useState } from "react";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { Toaster } from "sonner";

import { ApiError } from "@/api/client";
import { fetchAdminMe } from "@/api/session";
import { AdminShell } from "@/components/admin/admin-shell";
import { LoginPage } from "@/components/admin/login-page";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

function createQueryClient(onUnauthorized: () => void) {
	return new QueryClient({
		queryCache: new QueryCache({
			onError(error) {
				if (error instanceof ApiError && error.statusCode === 401) {
					onUnauthorized();
				}
			},
		}),
		mutationCache: new MutationCache({
			onError(error) {
				if (error instanceof ApiError && error.statusCode === 401) {
					onUnauthorized();
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

	return authenticated ? (
		<AdminShell onLogout={() => setAuthenticated(false)} />
	) : (
		<LoginPage onLogin={() => setAuthenticated(true)} />
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
			<AppContent
				authenticated={authenticated}
				setAuthenticated={setAuthenticated}
			/>
			<Toaster richColors position="top-right" />
		</QueryClientProvider>
	);
}
