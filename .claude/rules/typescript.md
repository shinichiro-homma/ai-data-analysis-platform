---
paths:
  - "jupyter-mcp/**/*"
  - "document-mcp/**/*"
---

# TypeScript ルール

jupyter-mcp、document-mcp に適用されるルール。

## MCP サーバー実装

MCP サーバーを実装する場合は `.claude/skills/mcp-typescript-server/SKILL.md` を必ず参照する（プロジェクト構成、サーバーの基本実装パターン、ツール/リソースの実装パターン、エラーハンドリング、デバッグ方法を含む）。

## コーディング規約

- `any` は使用しない（やむを得ない場合は `unknown` を検討）
- 関数の引数・戻り値には型を明示。インターフェース名に `I` プレフィックスは付けない
- 非同期処理は Promise より async/await を優先し、エラーは try-catch で明示的にハンドリングする
- 1 ファイル 1 責務、共通型は `types.ts`、ユーティリティは `utils/` 配下
- インポート順序: Node.js 組み込み → 外部パッケージ → 内部絶対パス → 内部相対パス

```typescript
// Good
interface SessionCreateRequest {
  name?: string;
}

async function executeCode(code: string): Promise<ExecutionResult> {
  try {
    return await client.execute(code);
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new ExecutionTimeoutError(error.message);
    }
    throw error;
  }
}

// Bad
function createSession(request: any): any { /* ... */ }
```

## MCP ツール実装

- `description` は AI が理解しやすい説明を記述する
- `inputSchema` は JSON Schema で厳密に定義し、必須パラメータは `required` に明記する
- 接続エラー／タイムアウト／バリデーションエラーを区別し、メッセージは AI が次のアクションを判断できる内容にする

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
- モックで外部依存を分離する
- エッジケース（タイムアウト、エラー）もテストする
