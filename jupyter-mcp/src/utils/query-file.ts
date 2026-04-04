/**
 * SQLクエリファイル保存ユーティリティ
 *
 * execute_sql / export_sql 共通で使用する
 */

import { jupyterClient } from '../jupyter-client/client.js';

export interface SaveQueryFileParams {
  workspacePath: string;
  sql: string;
  filename: string;
  rowCount: number;
  executionTimeMs: number;
}

/**
 * SQLクエリをメタデータ付き .sql ファイルとして保存する
 * 失敗時は1回リトライし、それでも失敗した場合はエラーをスローする
 */
export async function saveQueryFile(params: SaveQueryFileParams): Promise<string> {
  const queriesDir = `${params.workspacePath}/data/queries`;

  // data/queries/ ディレクトリの確保
  await jupyterClient.ensureDirectory(queriesDir);

  // 既存ファイル数を取得して連番を決定
  let existingCount = 0;
  try {
    const contents = await jupyterClient.listContents(queriesDir);
    existingCount = contents.contents.length;
  } catch {
    // ディレクトリが空 or リスト取得失敗の場合は 0 から
  }
  const sequenceNumber = existingCount + 1;

  // ファイル名生成: {連番(3桁ゼロ埋め)}_{filename(拡張子なし)}.sql
  const baseFilename = params.filename.replace(/\.[^.]+$/, '');
  const queryFileName = `${String(sequenceNumber).padStart(3, '0')}_${baseFilename}.sql`;
  const queryFilePath = `${queriesDir}/${queryFileName}`;

  // メタデータ付きクエリファイル内容を生成
  const executedAt = new Date().toISOString();
  const fileContent = [
    `-- executed_at: ${executedAt}`,
    `-- result_file: ${params.filename}`,
    `-- row_count: ${params.rowCount}`,
    `-- execution_time_ms: ${params.executionTimeMs}`,
    params.sql,
  ].join('\n');

  // ファイル書き込み（1回リトライ付き）
  try {
    await jupyterClient.writeTextFile(queryFilePath, fileContent);
  } catch (firstError) {
    console.warn('[saveQueryFile] Write failed, retrying:', firstError);
    await jupyterClient.writeTextFile(queryFilePath, fileContent);
  }

  return `data/queries/${queryFileName}`;
}
