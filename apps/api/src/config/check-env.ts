import { productionProblems, validateEnv } from './env.js';

/**
 * Exits non-zero when the environment would not run this release in production.
 * Run as the API is started: node --env-file=<file> dist/config/check-env.js
 */
try {
  const env = validateEnv(process.env);
  const problems = env.NODE_ENV === 'production' ? productionProblems(env) : [];
  if (problems.length > 0) {
    console.error(`Environment not ready for production:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Environment OK');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
