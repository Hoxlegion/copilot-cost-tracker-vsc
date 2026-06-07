<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  export let show = false;
  
  function handleClose() {
    show = false;
  }
  
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && show) {
      handleClose();
    }
  }
  
  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }
  
  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });
  
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click={handleOverlayClick}>
    <div class="modal-content">
      <div class="modal-header">
        <h2>Cost Tracking Definitions</h2>
        <button class="close-button" on:click={handleClose}>×</button>
      </div>
      
      <div class="modal-body">
        <section>
          <h3>Credits (CR)</h3>
          <p><strong>1 Credit = $0.01 USD</strong></p>
          <p>Credits represent the monetary cost of using GitHub Copilot. The amount of credits used depends on the number of tokens consumed by your queries and the model you're using.</p>
        </section>
        
        <section>
          <h3>Tokens</h3>
          <p>Tokens are the units that language models use to process text. Both your input (prompt) and the model's output (response) consume tokens. The number of tokens varies by model and query complexity.</p>
          <p><strong>Token Types:</strong></p>
          <ul>
            <li><strong>Input Tokens:</strong> Tokens from your prompts (questions/requests)</li>
            <li><strong>Output Tokens:</strong> Tokens in the model's responses</li>
            <li><strong>Cached Tokens:</strong> Previously processed tokens that are reused (cheaper than regular input tokens)</li>
            <li><strong>Cache Write Tokens:</strong> Tokens used when writing new data to the cache</li>
          </ul>
        </section>
        
        <section>
          <h3>Cost Calculation</h3>
          <p>Cost is calculated as: <code>(Tokens / 1,000,000) × Price per Million Tokens</code></p>
          <p>Different models have different pricing. For example:</p>
          <ul>
            <li>GPT-5 Mini: $0.25 per 1M input tokens</li>
            <li>Claude Haiku: $1 per 1M input tokens</li>
            <li>Gemini 3.5 Flash: $1.50 per 1M input tokens</li>
          </ul>
        </section>
        
        <section>
          <h3>Budget Tracking</h3>
          <p>Your budget is set in the extension settings and represents your spending limit for the billing period. The dashboard tracks your usage against this budget.</p>
          <ul>
            <li><strong>Budget Used %:</strong> Percentage of your budget consumed</li>
            <li><strong>Days Remaining:</strong> Days left in the current billing period</li>
            <li><strong>Daily Budget:</strong> Average credits you can spend per remaining day</li>
          </ul>
        </section>
        
        <section>
          <h3>Billing Period</h3>
          <p>The billing period is determined by your configured billing cycle start day (default: 1st of the month). All costs are grouped by this period for budget tracking and analysis.</p>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .modal-content {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    max-width: 700px;
    max-height: 80vh;
    width: 90%;
    display: flex;
    flex-direction: column;
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  
  .modal-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    line-height: 1;
  }
  
  .close-button:hover {
    color: var(--vscode-errorForeground);
  }
  
  .modal-body {
    padding: 20px;
    overflow-y: auto;
  }
  
  .modal-body section {
    margin-bottom: 24px;
  }
  
  .modal-body section:last-child {
    margin-bottom: 0;
  }
  
  .modal-body h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  
  .modal-body p {
    margin: 0 0 12px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--vscode-foreground);
  }
  
  .modal-body ul {
    margin: 0 0 12px 0;
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--vscode-foreground);
  }
  
  .modal-body li {
    margin-bottom: 4px;
  }
  
  .modal-body code {
    background: var(--vscode-textBlockQuote-background);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }
  
  .modal-body strong {
    font-weight: 600;
  }
</style>
