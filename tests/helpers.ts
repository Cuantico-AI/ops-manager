import { describe } from 'vitest';

export const describeIntegration =
  process.env.SKIP_INTEGRATION === 'true' ? describe.skip : describe;
