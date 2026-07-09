---
name: http-api-client-typescript
description: MCPサーバーから外部REST APIサーバーへ接続するTypeScript + axios製HTTPクライアントを実装する際に使用する。
---

# HTTP API Client (TypeScript + axios)

MCP サーバーから外部 REST API サーバーへ接続する HTTP クライアントの実装パターン。本プロジェクトの `document-mcp/src/document-client/` で確立されたパターンを基にまとめる。

## ディレクトリ構成

```
src/
├── document-client/
│   ├── client.ts     # クライアント本体
│   └── types.ts      # レスポンス型定義
```

## レスポンス型定義（types.ts）

### 共通ラッパー

```typescript
/** API レスポンスの共通ラッパー */
export interface ApiResponse<T> {
  data: T;
}
```

### インデックス型（第1層）

```typescript
export interface TableIndex {
  table_name: string;
  display_name: string;
  summary: string;
  category: string;
}

export type TableIndexResponse = ApiResponse<{
  tables: TableIndex[];
  total: number;
}>;
```

### 詳細型（第2層）

```typescript
export type TableDetailResponse = ApiResponse<{
  tables: TableDetail[];
  not_found: string[];    // 見つからなかった項目
}>;
```

### エラー型

```typescript
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
```

## カスタムエラークラス

```typescript
export class DocumentClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "DocumentClientError";
  }
}
```

## クライアント本体

### axios インスタンス作成

```typescript
import axios, { type AxiosInstance } from "axios";

export class DocumentServerClient {
  private httpClient: AxiosInstance;

  constructor() {
    const baseURL = process.env.DOCUMENT_SERVER_URL || "http://localhost:3002";

    // URL バリデーション（SSRF 対策）
    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new Error("Invalid URL: URL の形式が不正です");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Invalid URL: サポートされないプロトコル ${parsed.protocol}`);
    }

    this.httpClient = axios.create({
      baseURL,
      timeout: 10000,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

### 共通リクエスト処理

```typescript
private async request<T>(fn: () => Promise<{ data: ApiResponse<T> }>): Promise<T> {
  try {
    const response = await fn();
    return response.data.data;   // ラッパーを剥がして data を返す
  } catch (error) {
    throw this.handleError(error);
  }
}
```

### API メソッドの3パターン

```typescript
// パターン1: 引数なし GET（インデックス取得）
async getTableIndex(): Promise<{ tables: TableIndex[]; total: number }> {
  return this.request(() => this.httpClient.get<TableIndexResponse>("/catalog/index"));
}

// パターン2: オプション引数付き GET（検索対応インデックス取得）
async getTermIndex(query?: string): Promise<TermIndexResponse["data"]> {
  return this.request(() =>
    this.httpClient.get<TermIndexResponse>("/glossary/index", {
      params: query ? { query } : undefined,
    })
  );
}

// パターン3: 配列引数 POST（詳細一括取得）
async getTableDetails(tableNames: string[]): Promise<TableDetailResponse["data"]> {
  return this.request(() =>
    this.httpClient.post<TableDetailResponse>("/catalog/tables", { table_names: tableNames })
  );
}

// パターン4: 単一文字列引数 GET（コード取得）
async getLogicCode(logicName: string): Promise<LogicCode> {
  return this.request(() =>
    this.httpClient.get<LogicCodeResponse>(`/logic/code/${encodeURIComponent(logicName)}`)
  );
}
```

## エラーハンドリング

### axios エラー → カスタムエラー変換

```typescript
import axios from "axios";

private handleError(error: unknown): DocumentClientError {
  if (axios.isAxiosError(error)) {
    // 1. HTTP レスポンスエラー（4xx, 5xx）
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      let code = `HTTP_${status}`;
      let message = `HTTP ${status} error`;
      if (this.isErrorResponseData(data)) {
        code = data.error.code;
        message = data.error.message;
      }
      return new DocumentClientError(message, code, status);
    }

    // 2. タイムアウト
    if (error.code === "ECONNABORTED") {
      return new DocumentClientError(
        "サーバーへの接続がタイムアウトしました。",
        "TIMEOUT_ERROR", 408
      );
    }

    // 3. ネットワークエラー（接続拒否、DNS解決失敗等）
    if (!error.response && error.request) {
      return new DocumentClientError(
        "サーバーに接続できません。サーバーが起動しているか確認してください。",
        "CONNECTION_ERROR", 503
      );
    }
  }

  // 4. その他
  const message = error instanceof Error ? error.message : "Unknown error";
  return new DocumentClientError(message, "INTERNAL_ERROR", 500);
}
```

### エラーレスポンスの型ガード

```typescript
private isErrorResponseData(data: unknown): data is ErrorResponse {
  if (typeof data !== "object" || data === null || !("error" in data)) return false;
  const errorObj = (data as { error: unknown }).error;
  if (typeof errorObj !== "object" || errorObj === null) return false;
  const { code, message } = errorObj as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string";
}
```

### ステータスコード割り当て基準

| エラー種別 | statusCode | code |
|-----------|-----------|------|
| HTTP レスポンスエラー | レスポンスの status をそのまま | サーバーの error.code |
| タイムアウト | 408 | `TIMEOUT_ERROR` |
| 接続拒否/ネットワークエラー | 503 | `CONNECTION_ERROR` |
| その他 | 500 | `INTERNAL_ERROR` |

## シングルトンパターン

```typescript
let _instance: DocumentServerClient | null = null;

export function getDocumentClient(): DocumentServerClient {
  if (!_instance) {
    _instance = new DocumentServerClient();
  }
  return _instance;
}
```

## テストパターン

### axios モック設定

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { DocumentServerClient, DocumentClientError } from "../client.js";

vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      isAxiosError: vi.fn((error: unknown) => {
        return typeof error === "object" && error !== null && "isAxiosError" in error;
      }),
    },
  };
});
```

### beforeEach でモックインスタンスを取得

```typescript
let client: DocumentServerClient;
let mockAxiosInstance: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  client = new DocumentServerClient();
  mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
});
```

### 正常系テスト

```typescript
it("正常系: インデックスが取得できる", async () => {
  mockAxiosInstance.get.mockResolvedValue({
    data: {
      data: {
        terms: [{ name: "用語A", summary: "概要A" }],
        total: 1,
      },
    },
  });

  const result = await client.getTermIndex();
  expect(result.terms).toHaveLength(1);
  expect(mockAxiosInstance.get).toHaveBeenCalledWith("/glossary/index", {
    params: undefined,
  });
});
```

### オプション引数テスト

```typescript
it("query パラメータが GET クエリとして送信される", async () => {
  mockAxiosInstance.get.mockResolvedValue({ data: { data: { terms: [], total: 0 } } });
  await client.getTermIndex("PC");
  expect(mockAxiosInstance.get).toHaveBeenCalledWith("/glossary/index", {
    params: { query: "PC" },
  });
});
```

### ネットワークエラーテスト

```typescript
it("ネットワークエラーで DocumentClientError がthrowされる", async () => {
  const axiosError = {
    isAxiosError: true,
    code: "ECONNREFUSED",
    response: undefined,
    request: {},
  };
  mockAxiosInstance.get.mockRejectedValue(axiosError);

  await expect(client.getTermIndex()).rejects.toThrow(DocumentClientError);

  try {
    await client.getTermIndex();
  } catch (error) {
    const clientError = error as DocumentClientError;
    expect(clientError.code).toBe("CONNECTION_ERROR");
    expect(clientError.statusCode).toBe(503);
  }
});
```

## チェックリスト

- [ ] `ApiResponse<T>` ラッパーで型定義を統一したか
- [ ] 詳細レスポンスに `not_found: string[]` を含めたか
- [ ] URL バリデーション（プロトコルチェック）を行ったか
- [ ] `handleError()` で 4 種類のエラーを分岐したか
- [ ] `isErrorResponseData()` 型ガードでサーバーエラーを解析しているか
- [ ] シングルトンファクトリ関数を用意したか
- [ ] テストで `axios.create` のモック結果から `mockAxiosInstance` を取得しているか
- [ ] `axios.isAxiosError` もモックしているか
