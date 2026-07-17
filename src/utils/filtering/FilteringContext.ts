/**
 * Filtering context for strategy selection and execution
 *
 * This class encapsulates the logic for selecting the appropriate filtering
 * strategy based on configuration. HybridFilteringStrategy attempts
 * server-side filtering and transparently falls back to client-side
 * filtering on any server error, so it is safe to use whenever a filter
 * is present.
 */

import type { TaskFilteringStrategy } from './TaskFilteringStrategy';
import type { FilteringParams, FilteringResult, StrategyConfig } from './types';
import { ClientSideFilteringStrategy } from './ClientSideFilteringStrategy';
import { HybridFilteringStrategy } from './HybridFilteringStrategy';

export class FilteringContext {
  private strategy: TaskFilteringStrategy;

  constructor(config: StrategyConfig) {
    this.strategy = this.getStrategy(config);
  }

  /**
   * Execute filtering using the selected strategy
   */
  async execute(params: FilteringParams): Promise<FilteringResult> {
    return this.strategy.execute(params);
  }

  /**
   * Select the appropriate filtering strategy based on configuration.
   *
   * - enableServerSide -> HybridFilteringStrategy (server-side attempt with
   *   automatic client-side fallback on any server error).
   * - otherwise -> ClientSideFilteringStrategy.
   *
   * Server-side filtering used to be gated behind NODE_ENV=production or the
   * VIKUNJA_ENABLE_SERVER_SIDE_FILTERING env var. That gate only ever disabled
   * a self-healing path: with it off, every filtered list fetched a raw page
   * and filtered it in memory, so `done`/`filter` were applied *after*
   * pagination and matching tasks were scattered unpredictably across pages.
   */
  private getStrategy(config: StrategyConfig): TaskFilteringStrategy {
    if (config.enableServerSide) {
      return new HybridFilteringStrategy();
    }

    return new ClientSideFilteringStrategy();
  }
}
