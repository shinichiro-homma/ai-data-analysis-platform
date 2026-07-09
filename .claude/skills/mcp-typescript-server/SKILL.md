---
name: mcp-typescript-server
description: MCPサーバーの構築からツール実装までの全体パターン。新規MCPサーバー作成やツール追加時に使用する。
---

# MCP TypeScript Server Skill

MCP サーバーの構築からツール実装までの全体パターン。
エラーハンドリング・バリデーションの詳細は `error-handling-and-validation` Skill を参照。

---

## プロジェクト構成

```
{component}-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── server.ts             # MCPサーバー定義
│   ├── tools/                # ツール実装
│   │   ├── index.ts          # ツール登録・ルーティング
│   │   └── {tool-name}.ts    # 各ツール
│   ├── resources/            # リソース実装（必要な場合）
│   │   └── index.ts
│   ├── client/               # 外部APIクライアント
│   │   ├── client.ts
│   │   └── types.ts
│   └── utils/
│       ├── errors.ts         # エラークラス
│       ├── validation.ts     # バリデーション関数
│       ├── response-formatter.ts  # レスポンスフォーマッター
│       └── path-validator.ts # パス検証（jupyter-mcp）
└── tests/
```

---

## 依存関係

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## サーバーの基本実装

### エントリーポイント（src/index.ts）

```typescript
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

### サーバー定義（src/server.ts）

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getToolDefinitions, handleToolCall } from "./tools/index.js";

export function createServer(): Server {
  const server = new Server(
    { name: "your-server-name", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getToolDefinitions() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return server;
}
```

---

## ツール管理方式

### toolRegistry 方式（推奨）

document-mcp で採用。ツール定義と実装関数を配列で一元管理する。

```typescript
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ToolEntry {
  definition: Tool;
  execute: (args: Record<string, unknown>) => Promise<McpResponse>;
}

const toolRegistry: ToolEntry[] = [
  {
    definition: {
      name: "get_table_index",
      description: "...",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    execute: executeTableIndex,
  },
  // ...
];

export function getToolDefinitions(): Tool[] {
  return toolRegistry.map((entry) => entry.definition);
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const entry = toolRegistry.find((e) => e.definition.name === name);
  if (!entry) {
    const safeName = typeof name === "string" ? name.slice(0, 100) : "unknown";
    return createErrorResponse(`Unknown tool: ${safeName}`, "UNKNOWN_TOOL");
  }
  try {
    return await entry.execute(args);
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
```

### switch/case 方式

jupyter-mcp で採用。ツール数が多い場合に使う。

```typescript
export async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "workspace_create":
      return executeWorkspaceCreate(args);
    // ...
    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}
```

### 選択基準

| 基準 | toolRegistry | switch/case |
|------|-------------|-------------|
| ツール数 | 少〜中（〜10） | 多（10+） |
| 安全性 | 高（サニタイズ） | 中 |
| エラー方式 | エラーレスポンス | 例外 throw |

**新しい MCP サーバーでは toolRegistry 方式を推奨する。**

---

## ツール3類型テンプレート

### 類型1: インデックス取得（引数なし）

```typescript
export async function executeTableIndex(
  _args: Record<string, unknown>
): Promise<McpResponse> {
  try {
    const { tables, total } = await getClient().getTableIndex();
    return createSuccessResponse({ tables, total });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
```

### 類型2: 詳細一括取得（配列引数 + not_found）

```typescript
export async function executeTableDetail(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const validation = validateStringArrayParameter(args.table_names, "table_names", {
    required: true,
    maxItems: 50,
    maxLength: 128,
  });
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage, "VALIDATION_ERROR");
  }

  try {
    const { tables, not_found } = await getClient().getTableDetails(validation.value);
    return createSuccessResponse({ tables, not_found });
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
```

### 類型3: 単一リソース取得（文字列引数）

```typescript
export async function executeLogicCode(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const validation = validateStringParameter(args.logic_name, "logic_name", {
    required: true,
    maxLength: 200,
  });
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage, "VALIDATION_ERROR");
  }

  try {
    const code = await getClient().getLogicCode(validation.value);
    return createSuccessResponse(code);
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
```

### オプションパラメータのバリデーション

```typescript
let query: string | undefined;
if (args.query !== null && args.query !== undefined) {
  const validation = validateStringParameter(args.query, "query", {
    required: false,
    maxLength: 200,
    allowEmpty: false,
  });
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage, "VALIDATION_ERROR");
  }
  query = validation.value || undefined;
}
```

---

## リソースの実装

```typescript
import { Resource } from "@modelcontextprotocol/sdk/types.js";

export async function listResources(): Promise<Resource[]> {
  const images = await getSessionImages();
  return images.map((img) => ({
    uri: `jupyter://sessions/${img.sessionId}/images/${img.id}.png`,
    name: `Image ${img.id}`,
    mimeType: "image/png",
    description: `Generated image from session ${img.sessionId}`,
  }));
}

export async function readResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; blob: string }> }> {
  const match = uri.match(/^jupyter:\/\/sessions\/(.+)\/images\/(.+)\.png$/);
  if (!match) throw new Error(`Invalid resource URI: ${uri}`);
  const [, sessionId, imageId] = match;
  const imageData = await getImageData(sessionId, imageId);
  return { contents: [{ uri, mimeType: "image/png", blob: imageData }] };
}
```

---

## ビルドと実行

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### デバッグ

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## チェックリスト

### 新しい MCP サーバー作成時

- [ ] `@modelcontextprotocol/sdk` を依存に追加
- [ ] tsconfig.json で `module: "NodeNext"` を設定
- [ ] エントリーポイントに shebang を追加
- [ ] サーバーの capabilities を正しく設定
- [ ] toolRegistry or switch/case を選択
- [ ] 全ツールに description と inputSchema を定義

### 新しいツール追加時

- [ ] 3類型（インデックス/詳細一括/単一リソース）のどれに該当するかを判断
- [ ] `required` が正しいか（オプション引数は `required: []`）
- [ ] 配列パラメータに `maxItems` を設定
- [ ] オプションパラメータで `null` と `undefined` の両方をチェック
- [ ] catch 節で `createErrorResponseFromError(error)` を返す
- [ ] バリデーション・エラーハンドリングは `error-handling-and-validation` Skill に従う
