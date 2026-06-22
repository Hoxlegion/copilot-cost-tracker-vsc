import { derived } from 'svelte/store';
import { dashboardData } from './dashboard';
import { filterState } from './filter';
import type { SessionEntry } from '../types';

/**
 * Derived store that filters allSessions by the current filter range.
 * Every tab can subscribe instead of duplicating filter logic.
 */
export const filteredSessions = derived(
  [dashboardData, filterState],
  ([$data, $filter]): SessionEntry[] => {
    const all = $data?.allSessions ?? [];
    return all.filter(s => {
      if ($filter.fromMs !== null && s.startTimestamp < $filter.fromMs) return false;
      if ($filter.toMs !== null && s.startTimestamp > $filter.toMs) return false;
      return true;
    });
  }
);
