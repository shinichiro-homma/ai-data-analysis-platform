/**
 * 環境検出ヘルパー
 * DATA_ENV 環境変数から現在のデータ環境を取得する
 */

export type DataEnv = 'sample' | 'production';

export function getDataEnv(): DataEnv {
  const env = process.env.DATA_ENV || 'sample';
  if (env !== 'sample' && env !== 'production') {
    throw new Error(`Invalid DATA_ENV: ${env}. Must be 'sample' or 'production'`);
  }
  return env;
}
