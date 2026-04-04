import type { EnvFixture } from './types.js';

export const sampleFixture: EnvFixture = {
  tables: {
    minCount: 2,
    indexKnownNames: ['purchase_history', 'customer_master'],
    detail: {
      tableName: 'purchase_history',
      expectedColumns: ['customer_id', 'amount', 'transaction_date'],
      keyTypeColumn: 'customer_id',
    },
    // sample データには key_types を持つカラムが存在しないためスキップ
    keyTypes: null,
    statisticsAdditional: {
      tableName: 'purchase_history',
      expectedAdditional: {
        avg_basket_size: 3.2,
        top_categories: ['食品', '日用品', '衣料'],
        cancelled_rate: 0.05,
      },
      additionalCount: 3,
      noAdditionalTableName: 'customer_master',
      knownFields: {
        row_count: 15000000,
        date_range: { from: '2020-01-01', to: '2025-12-31' },
        update_frequency: '日次バッチ',
      },
    },
  },
  terms: {
    minCount: 3,
    indexKnownNames: ['ロイヤルティランク', '統合会員ID', '店舗'],
    detail: {
      termName: 'ロイヤルティランク',
      relatedTermName: '統合会員ID',
    },
  },
  logic: {
    minCount: 2,
    indexKnownNames: ['member_id_remapping', 'sales_basic_aggregation'],
    detail: {
      logicName: 'sales_basic_aggregation',
      language: 'python',
      usageType: 'reference',
      inputTables: ['purchase_history', 'customer_master'],
      codeContains: 'def aggregate_sales',
    },
  },
  partialError: {
    existingTable: 'purchase_history',
    existingTerm: 'ロイヤルティランク',
    existingLogic: 'sales_basic_aggregation',
  },
  e2eAvailable: true,
};
