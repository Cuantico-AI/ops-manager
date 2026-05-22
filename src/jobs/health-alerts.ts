import { isFleetDailyHealthEnabled } from '../lib/health/fleet-daily-summary.js';

export function shouldPostIndividualHealthAlert(): boolean {
  return !isFleetDailyHealthEnabled();
}
