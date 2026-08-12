/**
 * _utils/retry.ts
 * 
 * WHY WE NEED THIS:
 * LLM APIs and HTTP endpoints can fail transiently (rate limits, timeouts,
 * 500s). Retrying with exponential backoff means one bad request doesn't
 * fail the whole workflow run. We cap at 3 attempts and track attempt_count
 * in the step_run row so the UI can show "Retrying (2/3)...".
 */

/**
 * Sleep for a given number of milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  maxAttempts?: number;   // default: 3
  baseDelayMs?: number;   // default: 500ms — doubles each retry (exponential backoff)
  onAttempt?: (attempt: number, error: unknown) => void;
}

/**
 * Run `fn` up to `maxAttempts` times.
 * Waits baseDelayMs * 2^(attempt-1) between each retry.
 * Throws the last error if all attempts fail.
 * 
 * Example usage:
 *   const result = await withRetry(() => callGroqAPI(prompt), { maxAttempts: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, onAttempt } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      onAttempt?.(attempt, error);

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
