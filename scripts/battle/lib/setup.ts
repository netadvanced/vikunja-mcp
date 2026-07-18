/**
 * Executes a scenario's (already `{{prefix}}`-substituted) `setup` actions
 * via direct REST, before the agent is spawned. See `SetupAction` in
 * ../types.ts for the "why" -- this lets a scenario require the agent to act
 * on data that already existed (e.g. an already-existing label) rather than
 * data it just created itself in the same run.
 *
 * Errors are collected rather than thrown so a single bad seed doesn't abort
 * the whole scenario run silently -- the caller logs `errors` and the
 * scenario proceeds (its `verify` checks will simply fail if the missing
 * seed data was load-bearing, same as any other unmet precondition).
 */

import type { SetupAction } from '../types';
import type { VikunjaRestClient } from './rest-client';

export interface SetupResult {
  createdLabelIds: number[];
  errors: string[];
}

export async function runSetup(client: VikunjaRestClient, actions: SetupAction[]): Promise<SetupResult> {
  const createdLabelIds: number[] = [];
  const errors: string[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'create-label': {
          const label = await client.createLabel(action.title);
          createdLabelIds.push(label.id);
          break;
        }
        default: {
          // Exhaustiveness guard: fails to compile if a new SetupAction
          // variant is added to the discriminated union without a case here.
          const exhaustive: never = action;
          throw new Error(`Unhandled setup action type: ${JSON.stringify(exhaustive)}`);
        }
      }
    } catch (e) {
      errors.push(`setup action "${action.type}" failed: ${(e as Error).message}`);
    }
  }

  return { createdLabelIds, errors };
}
