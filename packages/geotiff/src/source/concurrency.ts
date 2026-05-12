/**
 * Create a mutex: a function that runs async tasks one at a time.
 *
 * Tasks submitted while another is running are queued and executed in
 * submission order — never concurrently with each other.
 *
 * Useful when an async operation must observe and mutate shared state
 * across awaits without races. The TypeScript analogue of holding a
 * `tokio::sync::Mutex` across an `await`.
 *
 * @example
 * const lock = mutex();
 * const a = lock(async () => { ... });  // executes immediately
 * const b = lock(async () => { ... });  // waits for `a` to settle, then runs
 *
 * @returns A function that schedules tasks on the queue.
 */
export function mutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}
