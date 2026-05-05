import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { QingYanExportPage } from "./qingyan-export-page";
import { QingYanImportPage } from "./qingyan-import-page";
import { WordPressMigrationPage } from "./wp-migration-page";

type DataTab = "wordpress" | "export" | "import" | "jobs";

const tabs: Array<{ id: DataTab; label: string }> = [
	{ id: "wordpress", label: "WordPress 迁移" },
	{ id: "export", label: "导出" },
	{ id: "import", label: "导入" },
	{ id: "jobs", label: "任务记录" },
];

function PlaceholderPanel({ title }: { title: string }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-lg">{title}</CardTitle>
				<CardDescription>此能力将在后续导入导出切片中接入。</CardDescription>
			</CardHeader>
			<CardContent className="text-sm text-muted-foreground">
				当前版本先交付 WordPress WXR 评论迁移分析，不写业务数据。
			</CardContent>
		</Card>
	);
}

export function DataPage({ siteKey }: { siteKey: string }) {
	const [tab, setTab] = useState<DataTab>("wordpress");

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
				<WordPressMigrationPage siteKey={siteKey} />
			) : null}
			{tab === "export" ? <QingYanExportPage siteKey={siteKey} /> : null}
			{tab === "import" ? <QingYanImportPage siteKey={siteKey} /> : null}
			{tab === "jobs" ? <PlaceholderPanel title="导入任务记录" /> : null}
		</div>
	);
}
