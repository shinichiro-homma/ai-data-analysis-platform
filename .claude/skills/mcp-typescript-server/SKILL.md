# MCP TypeScript Server Skill

MCP（Model Context Protocol）サーバーを TypeScript で実装するためのスキル。

## 概要

このスキルは、MCP TypeScript SDK を使用してサーバーを構築する際のベストプラクティスを提供する。

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
│   │   ├── index.ts          # ツール登録
│   │   └── {tool-name}.ts    # 各ツール
│   ├── resources/            # リソース実装（必要な場合）
│   │   └── index.ts
│   ├── client/               # 外部APIクライアント
│   │   ├── client.ts
│   │   └── types.ts
│   └── utils/
│       └── errors.ts         # エラー定義
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
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerTools, handleToolCall } from "./tools/index.js";

export function createServer(): Server {
  const server = new Server(
    {
      name: "your-server-name",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {}, // リソースを提供する場合
      },
    }
  );

  // ツール一覧
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: registerTools() };
  });

  // ツール実行
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return server;
}
```

---

## ツールの実装

### ツール定義（src/tools/index.ts）

```typescript
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { executeSessionCreate } from "./session-create.js";
import { executeSessionList } from "./session-list.js";

// ツール定義
const tools: Tool[] = [
  {
    name: "session_create",
    description: "新しいセッション（カーネル）を作成します",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "カーネル名（デフォルト: python3）",
        },
      },
      required: [],
    },
  },
  {
    name: "session_list",
    description: "アクティブなセッション一覧を取得します",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function registerTools(): Tool[] {
  return tools;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case "session_create":
      return executeSessionCreate(args);
    case "session_list":
      return executeSessionList(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

### 個別ツール実装（src/tools/session-create.ts）

```typescript
import { jupyterClient } from "../client/client.js";

interface SessionCreateArgs {
  name?: string;
}

export async function executeSessionCreate(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { name = "python3" } = args as SessionCreateArgs;

  try {
    const session = await jupyterClient.createSession(name);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_id: session.id,
            kernel: session.kernel.name,
            status: session.kernel.status,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        },
      ],
    };
  }
}
```

---

## リソースの実装

### リソース定義（src/resources/index.ts）

```typescript
import { Resource } from "@modelcontextprotocol/sdk/types.js";

export async function listResources(): Promise<Resource[]> {
  // 例: セッション内の画像リソースを列挙
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
  // URIをパース
  const match = uri.match(/^jupyter:\/\/sessions\/(.+)\/images\/(.+)\.png$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const [, sessionId, imageId] = match;
  const imageData = await getImageData(sessionId, imageId);

  return {
    contents: [
      {
        uri,
        mimeType: "image/png",
        blob: imageData, // base64 encoded
      },
    ],
  };
}
```

---

## エラーハンドリング

### エラー定義（src/utils/errors.ts）

```typescript
export class McpError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class NotFoundError extends McpError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class TimeoutError extends McpError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `${operation} timed out after ${timeoutMs}ms`,
      "TIMEOUT",
      408
    );
  }
}
```

### ツールでのエラーハンドリング

```typescript
export async function executeToolWithErrorHandling(
  fn: () => Promise<unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const result = await fn();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, data: result }, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = error instanceof McpError ? error.code : "INTERNAL_ERROR";
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, error: { code, message } }, null, 2),
        },
      ],
    };
  }
}
```

---

## ビルドと実行

### package.json scripts

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  }
}
```

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

---

## デバッグ

### MCP Inspector での確認

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Claude Desktop での設定

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "your-server": {
      "command": "node",
      "args": ["/path/to/your-server/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "your-token"
      }
    }
  }
}
```

---

## チェックリスト

新しい MCP サーバーを作成する際の確認事項：

- [ ] package.json に `@modelcontextprotocol/sdk` を追加
- [ ] tsconfig.json で `module: "NodeNext"` を設定
- [ ] エントリーポイントに shebang（`#!/usr/bin/env node`）を追加
- [ ] サーバーの capabilities を正しく設定
- [ ] 全ツールに description と inputSchema を定義
- [ ] エラーハンドリングを統一
- [ ] MCP Inspector で動作確認
