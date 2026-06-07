/**
 * Resolves a Slack channel from a prioritized list of (usually env-var)
 * candidates, falling back to a default.
 *
 * Why not just `A ?? B ?? default`: `??` only coalesces null/undefined, so a
 * channel env var that is set but empty or whitespace (`SLACK_ALERTS_CHANNEL=""`)
 * slips through and reaches Slack's `postMessage`, which rejects an empty channel
 * (the post-message input schema requires min length 1). This treats blank
 * values as unset and trims the winner.
 */
export function resolveChannel(
  candidates: Array<string | undefined | null>,
  fallback: string,
): string {
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}
