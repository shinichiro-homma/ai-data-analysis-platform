---
name: error-handling-and-validation
description: TypeScript MCPサーバーとPython REST APIのエラーハンドリング・入力バリデーション・セキュリティ対策の統一パターンを実装する際に使用する。
---

# Error Handling and Validation Skill

TypeScript MCP サーバーと Python REST API サーバーにおける、エラーハンドリング・入力バリデーション・セキュリティ対策の統一パターン。

---

## エラー分類

| エラー種別 | MCP エラーコード | HTTP ステータス |
|-----------|-----------------|----------------|
| validation | `VALIDATION_ERROR` | 400 |
| not-found | `NOT_FOUND` | 404 |
| timeout | `TIMEOUT` | 408 |
| execution | `EXECUTION_ERROR` | - |
| internal | `INTERNAL_ERROR` | 500 |
| unknown-tool | `UNKNOWN_TOOL` | - |

---

## エラークラス階層（TypeScript）

`{component}-mcp/src/utils/errors.ts` で定義。

```typescript
export class McpError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
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
    super(`${operation} timed out after ${timeoutMs}ms`, "TIMEOUT", 408);
  }
}
```

---

## レスポンスフォーマッター（TypeScript）

`{component}-mcp/src/utils/response-formatter.ts` で定義。

```typescript
export interface McpResponse {
  content: Array<{ type: "text"; text: string }>;
}

// 成功レスポンス → { success: true, ...data }
export function createSuccessResponse(data: Record<string, unknown>): McpResponse;

// エラーレスポンス → { success: false, error: { code, message } }
export function createErrorResponse(message: string, code: string): McpResponse;

// catch ブロック用（document-mcp）
export function createErrorResponseFromError(error: unknown): McpResponse;

// エラー情報抽出
export function extractErrorMessage(error: unknown): string;
export function extractErrorCode(error: unknown): string;
```

### MCP vs REST レスポンス形式

| | MCP ツール（TypeScript） | REST API（Python） |
|---|---|---|
| 成功 | `{ success: true, ...data }` | `{ data: { ...data } }` |
| エラー | `{ success: false, error: { code, message } }` | `{ error: { code, message } }` |

---

## ツール内エラーハンドリングパターン

### パターン1: バリデーション + try/catch（jupyter-mcp 標準）

```typescript
export async function executeSessionCreate(args: Record<string, unknown>): Promise<McpResponse> {
  const validation = validateWorkspaceId(args.workspace_id);
  if (!validation.isValid) {
    return createErrorResponse(validation.errorMessage!, "VALIDATION_ERROR");
  }

  try {
    const session = await jupyterClient.createSessionInWorkspace(args.workspace_id as string);
    return createSuccessResponse({ session_id: session.session_id });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
```

### パターン2: createErrorResponseFromError（document-mcp 簡潔パターン）

```typescript
try {
  const result = await getDocumentClient().getTableDetails(validation.value);
  return createSuccessResponse({ tables: result.tables, not_found: result.not_found });
} catch (error) {
  return createErrorResponseFromError(error);
}
```

### パターン3: ValidationError を catch で分岐（パス系）

```typescript
try {
  const normalizedPath = normalizePath(subPath, { allowRoot: true });
  // ...
} catch (error) {
  if (error instanceof ValidationError) {
    return createErrorResponse(error.message, error.code);
  }
  return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
}
```

### パターン4: fire-and-forget（失敗しても続行）

```typescript
async function postAiEventSafe(event: AiEvent, context: string): Promise<BroadcastEventResponse | null> {
  try {
    return await jupyterClient.postAiEvent(event);
  } catch (error) {
    console.error(`[execute_code] Failed to ${context}:`, error);
    return null;
  }
}
```

---

## 入力バリデーション（TypeScript）

### ValidationResult 型

jupyter-mcp と document-mcp で定義が異なる。新規実装では document-mcp の型安全版を推奨。

```typescript
// document-mcp（推奨）: 成功時に検証済みの値を型安全に返す
export type ValidationResult<T = void> =
  | (T extends void ? { isValid: true } : { isValid: true; value: T })
  | { isValid: false; errorMessage: string };
```

### validateStringParameter

チェック順序: null → 必須 → 型 → 空文字 → 長さ → NULL バイト

```typescript
const validation = validateStringParameter(session_id, "session_id", {
  required: true,
  maxLength: 200,
  allowEmpty: false,
});
if (!validation.isValid) {
  return createErrorResponse(validation.errorMessage!, "VALIDATION_ERROR");
}
```

### validateStringArrayParameter（document-mcp）

各要素の検証を `validateStringParameter` に委譲。

```typescript
const validation = validateStringArrayParameter(tableNames, "table_names", {
  required: true,
  maxLength: 128,   // 各要素の最大長
  minItems: 1,
  maxItems: 50,     // DoS 対策
});
if (!validation.isValid) {
  return createErrorResponse(validation.errorMessage, "VALIDATION_ERROR");
}
// validation.value は検証済みの string[]
```

### validateWorkspaceId

`validateStringParameter` + パストラバーサル防止（`..` 拒否）。

### normalizePath / normalizeNotebookPath

パスの正規化とセキュリティチェックを一括で行い、不正な場合は `ValidationError` を throw:
- 空文字チェック、`..` 拒否、NULL バイト拒否、パス長制限、先頭 `/` 除去

### 数値パラメータ

専用関数なし。インラインで型チェック・範囲チェック・上限チェックを行う。

---

## 入力バリデーション（Python）

### Pydantic モデル

```python
class TableDetailRequest(BaseModel):
    table_names: list[str] = Field(..., min_length=1, max_length=100)
```

### FastAPI パスパラメータ

```python
logic_name: str = FastAPIPath(..., pattern=r"^[a-zA-Z0-9_-]+$", max_length=100)
```

### field_validator（パストラバーサル防止）

```python
@field_validator("file_path", mode="before")
@classmethod
def _validate_file_path(cls, v: Any) -> Any:
    if isinstance(v, str) and (".." in v.split("/") or v.startswith("/")):
        raise ValueError(f"Invalid file_path: '{v}' must be a relative path without '..'")
    return v
```

---

## REST API エラーレスポンス（Python）

```python
from fastapi.responses import JSONResponse

def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )
```

---

## セキュリティ対策一覧

セキュリティの原則は `.claude/rules/security.md` に定義されている。本セクションではその原則の実装パターンのみを示す。

| 攻撃手法 | 対策 | 実装箇所 |
|---------|------|---------|
| パストラバーサル | `..` の拒否 | `validateWorkspaceId`, `normalizePath`, `LogicMeta._validate_file_path` |
| NULL バイト | `\0` の拒否 | `validateStringParameter`, `normalizePath` |
| DoS（長大入力） | 文字列長・配列要素数の上限 | `validateStringParameter`, `validateStringArrayParameter` |
| 絶対パス | 先頭 `/` の除去 or 拒否 | `normalizePath`, `FastAPIPath(pattern=...)` |
| CORS | 環境変数で origins を制御 | `document-server/src/main.py`（`["*"]` 禁止） |
| コンテナ | 非 root ユーザーで実行 | jupyter-server: `USER jovyan` |

---

## ログ出力

**TypeScript MCP サーバー**: `console.error` を使用（stdout は MCP プロトコルに予約）。
document-mcp には `logger` ユーティリティあり（LOG_LEVEL 環境変数で制御）。

**Python**: 標準 `logging` モジュールを使用。

---

## チェックリスト

### 新しい MCP ツール追加時

- [ ] 全パラメータに `validateStringParameter` / `validateStringArrayParameter` / `validateWorkspaceId` を使用
- [ ] `required: true` と `maxLength` を適切に設定
- [ ] パスを扱う場合は `normalizePath` / `normalizeNotebookPath` を使用
- [ ] ビジネスロジックを `try/catch` で囲む
- [ ] catch で `createErrorResponseFromError` または `extractErrorMessage`/`extractErrorCode` を使用
- [ ] 成功時は `createSuccessResponse(data)` を返す
- [ ] fire-and-forget 処理は失敗しても本体処理を続行

### 新しい REST API エンドポイント追加時

- [ ] Pydantic `BaseModel` + `Field(min_length=, max_length=)` でリクエストバリデーション
- [ ] パスパラメータに `FastAPIPath(pattern=, max_length=)` を使用
- [ ] ファイルパスに `field_validator` でパストラバーサル防止
- [ ] エラーは `error_response(status_code, code, message)` で返す

### コードレビュー時のセキュリティチェック

セキュリティチェックの詳細は `.claude/rules/security.md` を参照すること。
