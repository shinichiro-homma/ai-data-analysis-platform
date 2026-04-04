import pandas as pd


def aggregate_sales(df_transactions: pd.DataFrame, df_customers: pd.DataFrame) -> pd.DataFrame:
    """店舗別・顧客セグメント別の売上基礎集計を行う。

    Args:
        df_transactions: 購買トランザクションデータ
        df_customers: 会員マスタデータ

    Returns:
        店舗別・顧客セグメント別の集計DataFrame
    """
    df = df_transactions.merge(
        df_customers[["customer_id", "loyalty_rank"]],
        on="customer_id",
        how="left",
    )
    result = (
        df.groupby(["store_code", "loyalty_rank"])
        .agg(
            total_amount=("amount", "sum"),
            customer_count=("customer_id", "nunique"),
        )
        .reset_index()
    )
    return result
