---
paths:
  - "jupyter-mcp/**/*"
  - "document-mcp/**/*"
---

# TypeScript ルール

jupyter-mcp、document-mcp に適用されるルール。

## MCP サーバー実装

MCP サーバーを実装する場合は、以下の Skill を必ず参照してください：

→ **`.claude/skills/mcp-typescript-server/SKILL.md`**

この Skill には以下が含まれています：
- プロジェクト構成
- サーバーの基本実装パターン
- ツール/リソースの実装パターン
- エラーハンドリング
- デバッグ方法

## コーディング規約

### 型定義

- `any` は使用しない（やむを得ない場合は `unknown` を検討）
- 関数の引数・戻り値には型を明示する
- インターフェースは `I` プレフィックスを付けない

```typescript
// Good
interface SessionCreateRequest {
  name?: string;
}

function createSession(request: SessionCreateRequest): Promise<Session> {
  // ...
}

// Bad
function createSession(request: any): any {
  // ...
}
```

### 非同期処理

- Promise より async/await を優先する
- エラーハンドリングは try-catch で明示的に行う

```typescript
// Good
async function executeCode(code: string): Promise<ExecutionResult> {
  try {
    const response = await client.execute(code);
    return response;
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new ExecutionTimeoutError(error.message);
    }
    throw error;
  }
}
```

### ファイル構成

- 1ファイル1責務を原則とする
- 共通の型定義は `types.ts` にまとめる
- ユーティリティ関数は `utils/` ディレクトリに配置

### インポート順序

1. Node.js 組み込みモジュール
2. 外部パッケージ
3. 内部モジュール（絶対パス）
4. 内部モジュール（相対パス）

```typescript
import { readFile } from 'fs/promises';

import axios from 'axios';
import { Server } from '@modelcontextprotocol/sdk/server';

import { config } from '../config';
import { formatOutput } from './utils/formatter';
```

## MCP ツール実装

### ツール定義

- `description` はAIが理解しやすい説明を記述する
- `inputSchema` は JSON Schema 形式で厳密に定義する
- 必須パラメータは `required` に明記する

### エラーハンドリング

- 接続エラー、タイムアウト、バリデーションエラーを区別する
- エラーメッセージはユーザー（AI）が理解できる内容にする

```typescript
if (!session) {
  return {
    content: [{
      type: 'text',
      text: 'エラー: セッションが見つかりません。先に session_create を実行してください。'
    }]
  };
}
```

## テスト

- ツールごとにユニットテストを作成する
- モックを使用して外部依存を分離する
- エッジケース（タイムアウト、エラー）もテストする
