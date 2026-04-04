/**
 * ロック中バナーUI
 */
import { Widget } from '@lumino/widgets';

export class LockIndicator extends Widget {
  constructor() {
    super();
    this.addClass('jp-ai-lock-indicator');
    this.node.innerHTML = `
      <div class="jp-ai-lock-banner">
        <span class="jp-ai-lock-icon">🔒</span>
        <span class="jp-ai-lock-text">AI が編集中です...</span>
      </div>
    `;
  }
}
