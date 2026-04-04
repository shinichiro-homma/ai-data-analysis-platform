SELECT
  COALESCE(m.new_member_id, t.customer_id) AS customer_id,
  t.transaction_id,
  t.transaction_date,
  t.store_code,
  t.product_code,
  t.quantity,
  t.amount
FROM purchase_history t
LEFT JOIN member_id_mapping m
  ON t.customer_id = m.old_member_id
WHERE m.mapping_date = (SELECT MAX(mapping_date) FROM member_id_mapping)
