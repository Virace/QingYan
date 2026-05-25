import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";

import {
	DEFAULT_PUBLIC_PATH,
	normalizePublicPath,
} from "../config/public-path";

export interface OpenApiDocument {
	yamlText: string;
	json: unknown;
}

const OPENAPI_PATH = path.resolve(process.cwd(), "docs/openapi.yaml");

export async function loadOpenApiDocument(
	publicPath = DEFAULT_PUBLIC_PATH,
): Promise<OpenApiDocument> {
	const yamlText = await readFile(OPENAPI_PATH, "utf-8");
	const json = parse(yamlText) as Record<string, unknown>;
	const runtimeJson = {
		...json,
		servers: [{ url: normalizePublicPath(publicPath) }],
	};

	return {
		yamlText: stringify(runtimeJson),
		json: runtimeJson,
	};
}

export function renderOpenApiHtml(specUrl = "/openapi.yaml"): string {
	return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QingYan API Docs</title>
    <style>
      body {
        margin: 0;
        background: #f5f1e8;
        color: #1f2937;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      header {
        padding: 20px 24px;
        border-bottom: 1px solid rgba(31, 41, 55, 0.12);
        background: #fbf8f1;
      }
      header h1 {
        margin: 0;
        font-size: 20px;
      }
      header p {
        margin: 6px 0 0;
        font-size: 14px;
        color: #4b5563;
      }
      redoc {
        display: block;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>QingYan API</h1>
      <p>当前页面展示仓库内 docs/openapi.yaml 的运行时文档视图。</p>
    </header>
    <redoc spec-url="${specUrl}"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
}
