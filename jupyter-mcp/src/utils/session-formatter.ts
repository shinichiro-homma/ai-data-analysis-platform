/**
 * セッション形式への変換ユーティリティ
 */

import { Kernel } from "../jupyter-client/types.js";

/**
 * セッション情報の型定義
 */
export interface SessionInfo {
  session_id: string;
  kernel_id: string;
  status: string;
  kernel_name?: string;
  created_at: string;
}

/**
 * Kernel オブジェクトをセッション形式に変換する
 *
 * @param kernel - 変換元のカーネル情報
 * @param includeKernelName - kernel_name を含めるかどうか（デフォルト: true）
 * @returns セッション情報
 */
export function kernelToSessionInfo(
  kernel: Kernel,
  includeKernelName = true
): SessionInfo {
  const sessionInfo: SessionInfo = {
    session_id: kernel.id,
    kernel_id: kernel.id,
    status: kernel.status,
    created_at: kernel.started_at,
  };

  if (includeKernelName) {
    sessionInfo.kernel_name = kernel.name;
  }

  return sessionInfo;
}

/**
 * Kernel の配列をセッション情報の配列に変換する
 *
 * @param kernels - カーネル一覧
 * @param includeKernelName - kernel_name を含めるかどうか（デフォルト: true）
 * @returns セッション情報の配列
 */
export function kernelsToSessionList(
  kernels: Kernel[],
  includeKernelName = true
): SessionInfo[] {
  return kernels.map((kernel) =>
    kernelToSessionInfo(kernel, includeKernelName)
  );
}
