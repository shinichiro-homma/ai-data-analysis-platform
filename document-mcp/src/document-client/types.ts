/**
 * document-server API のレスポンス型定義
 */

/** API レスポンスの共通ラッパー */
export interface ApiResponse<T> {
  data: T;
}

// --- テーブルインデックス ---

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

// --- テーブル詳細 ---

export interface DomainMasterRef {
  master_table: string;
  master_column: string;
  label_column: string;
}

export interface DomainValues {
  values: string[];
}

export type Domain = DomainMasterRef | DomainValues;

export interface ConditionalKeyType {
  value: string;
  condition: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  description: string;
  nullable: boolean;
  key_type?: string;
  key_types?: ConditionalKeyType[];
  domain?: Domain;
  notes?: string;
  examples?: (string | number | boolean | null)[];
}

export interface DataSource {
  type: 'postgresql' | 'csv' | 'external';
  table?: string;
  file_path?: string;
  encoding?: string;
  format?: string;
  description?: string;
}

export interface DateRange {
  from: string | null;
  to: string | null;
}

export interface Statistics {
  row_count?: number;
  date_range?: DateRange;
  update_frequency?: string;
  additional?: Record<string, unknown>;
}

export interface TableDetail {
  table_name: string;
  display_name: string;
  description: string;
  data_source: DataSource | null;
  columns: ColumnInfo[];
  statistics?: Statistics;
  notes_table_level?: string[];
}

export type TableDetailResponse = ApiResponse<{
  tables: TableDetail[];
  not_found: string[];
}>;

// --- 用語集（Glossary）---

export interface TermIndex {
  name: string;
  summary: string;
}

export type TermIndexResponse = ApiResponse<{
  terms: TermIndex[];
  total: number;
}>;

export interface TermValue {
  label: string;
  description: string;
}

export interface TermDetail {
  name: string;
  aliases: string[];
  definition: string;
  related_terms?: string[];
  values?: TermValue[];
}

export type TermDetailResponse = ApiResponse<{
  terms: TermDetail[];
  not_found: string[];
}>;

// --- ロジックインデックス ---

export interface LogicIndex {
  logic_name: string;
  summary: string;
  category: string;
}

export type LogicIndexResponse = ApiResponse<{
  logic: LogicIndex[];
  total: number;
}>;

// --- ロジックメタ情報 ---

export interface LogicMeta {
  logic_name: string;
  description: string;
  file_path: string;
  language: string;
  usage_type: string;
  input_tables: string[];
  output_description: string;
  usage_context: string | null;
  related_logic: string[] | null;
  notes: string | null;
}

export type LogicMetaResponse = ApiResponse<{
  logic: LogicMeta[];
  not_found: string[];
}>;

// --- ロジックコード ---

export interface LogicCode {
  logic_name: string;
  language: string;
  code: string;
}

export type LogicCodeResponse = ApiResponse<LogicCode>;

// --- エラー ---

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
