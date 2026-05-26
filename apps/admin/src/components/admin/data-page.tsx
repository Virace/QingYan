import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AdminSiteSummary } from "@/api/session";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { QingYanExportPage } from "./qingyan-export-page";
import { QingYanImportPage } from "./qingyan-import-page";
import { ImportJobsPage } from "./import-jobs-page";
import { WordPressMigrationPage } from "./wp-migration-page";

type DataTab = "wordpress" | "export" | "import" | "jobs";

const tabs: Array<{ id: DataTab; label: string }> = [
	{ id: "wordpress", label: "WordPress 迁移" },
	{ id: "export", label: "导出" },
	{ id: "import", label: "导入" },
	{ id: "jobs", label: "任务记录" },
];

export function DataPage({ site }: { site: AdminSiteSummary }) {
	const [tab, setTab] = useState<DataTab>("wordpress");
	const siteKey = site.siteKey;

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">数据管理</CardTitle>
					<CardDescription>
						处理评论数据迁移、导入导出和导入任务审计。
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{tabs.map((item) => (
							<Button
								key={item.id}
								type="button"
								variant={tab === item.id ? "secondary" : "outline"}
								onClick={() => setTab(item.id)}
							>
								{item.label}
							</Button>
						))}
					</div>
				</CardContent>
			</Card>
			{tab === "wordpress" ? (
				<WordPressMigrationPage key={siteKey} site={site} />
			) : null}
			{tab === "export" ? <QingYanExportPage siteKey={siteKey} /> : null}
			{tab === "import" ? <QingYanImportPage siteKey={siteKey} /> : null}
			{tab === "jobs" ? <ImportJobsPage siteKey={siteKey} /> : null}
		</div>
	);
}
