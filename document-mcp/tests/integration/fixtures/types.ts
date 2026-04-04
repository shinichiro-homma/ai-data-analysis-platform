/**
 * 環境別テストフィクスチャの型定義
 */

export interface KeyTypesFixture {
  tableName: string;
  columnName: string;
  count: number;
  values: Array<{ value: string; condition: string }>;
  /** key_type（単一）を持つカラム名（同一テーブル内の共存テスト用） */
  keyTypeColumnName: string;
}

export interface StatisticsAdditionalFixture {
  tableName: string;
  expectedAdditional: Record<string, unknown>;
  additionalCount: number;
  noAdditionalTableName: string;
  knownFields: {
    row_count: number;
    date_range: { from: string; to: string };
    update_frequency: string;
  };
}

export interface EnvFixture {
  tables: {
    minCount: number;
    indexKnownNames: string[];
    detail: {
      tableName: string;
      expectedColumns: string[];
      keyTypeColumn: string;
    };
    keyTypes: KeyTypesFixture | null;
    statisticsAdditional: StatisticsAdditionalFixture | null;
  };
  terms: {
    minCount: number;
    indexKnownNames: string[];
    detail: {
      termName: string;
      relatedTermName: string | null;
    };
  };
  logic: {
    minCount: number;
    indexKnownNames: string[];
    detail: {
      logicName: string;
      language: string;
      usageType: string;
      inputTables: string[];
      codeContains: string;
    };
  };
  partialError: {
    existingTable: string;
    existingTerm: string;
    existingLogic: string;
  };
  e2eAvailable: boolean;
}
