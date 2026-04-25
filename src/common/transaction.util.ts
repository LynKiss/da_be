/**
 * Retry-on-deadlock helper.
 *
 * MySQL trả về:
 *   - errno = 1213 / code = 'ER_LOCK_DEADLOCK' khi deadlock
 *   - errno = 1205 / code = 'ER_LOCK_WAIT_TIMEOUT' khi lock wait timeout
 *
 * Wrap các transaction critical (createOrder, confirmGr, ...) bằng helper này
 * để tự động retry tối đa N lần khi gặp deadlock.
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const code = err?.code ?? err?.driverError?.code;
      const errno = err?.errno ?? err?.driverError?.errno;
      const isDeadlock =
        code === 'ER_LOCK_DEADLOCK' ||
        code === 'ER_LOCK_WAIT_TIMEOUT' ||
        errno === 1213 ||
        errno === 1205;
      if (!isDeadlock || attempt === maxRetries - 1) {
        throw err;
      }
      // exponential backoff với jitter nhỏ: 50ms, 100ms, 200ms
      const delay = 50 * Math.pow(2, attempt) + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
