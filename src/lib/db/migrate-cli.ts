import 'dotenv/config';
import { runMigrations } from './migrate.js';

runMigrations()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  });
