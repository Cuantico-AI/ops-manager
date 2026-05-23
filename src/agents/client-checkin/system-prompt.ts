import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const promptPath = join(dirname(fileURLToPath(import.meta.url)), 'prompt.md');

export const CLIENT_CHECKIN_SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');
