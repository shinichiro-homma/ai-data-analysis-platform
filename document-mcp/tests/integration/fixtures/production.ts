import type { EnvFixture } from './types.js';

export const productionFixture: EnvFixture = {
  tables: {
    minCount: 28,
    indexKnownNames: ['dwh_sdt_customer_inf', 'dm_purchase_history'],
    detail: {
      tableName: 'dm_purchase_history',
      expectedColumns: ['receipt_no', 'date_of_use_str', 'otac_membership_no'],
      keyTypeColumn: 'otac_membership_no',
    },
    keyTypes: {
      tableName: 'dwh_idt_co_three_key_authn_fo',
      columnName: 'three_key_id',
      count: 5,
      values: [
        {
          value: 'OTAC会員番号（断面）',
          condition: "organization_id = 'APeAxP3r' の場合",
        },
        {
          value: 'WB会員番号',
          condition: "organization_id = 'WBbLy5Dx' の場合",
        },
      ],
      keyTypeColumnName: 'user_id',
    },
    // production カタログには statistics.additional を持つテーブルがない
    statisticsAdditional: null,
  },
  terms: {
    minCount: 3,
    indexKnownNames: ['OTAC会員番号', 'スターランク', '商業顧客ID'],
    detail: {
      termName: 'OTAC会員番号',
      // production 用語には related_terms がない
      relatedTermName: null,
    },
  },
  logic: {
    minCount: 1,
    indexKnownNames: ['otac_id_washing'],
    detail: {
      logicName: 'otac_id_washing',
      language: 'sql',
      usageType: 'template',
      inputTables: ['dwh_sdt_member_change_inf'],
      codeContains: 'clean_change_map',
    },
  },
  partialError: {
    existingTable: 'dm_purchase_history',
    existingTerm: 'OTAC会員番号',
    existingLogic: 'otac_id_washing',
  },
  // production のロジックは SQL のため、Jupyter での Python 実行 E2E は不可
  e2eAvailable: false,
};
