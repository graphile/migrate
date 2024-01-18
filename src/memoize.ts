/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
export default function memoize<T extends (...args: Array<any>) => any>(
  fn: T,
): (...funcArgs: Parameters<T>) => ReturnType<T> {
  let lastArgs: Parameters<T>;
  let lastResult: ReturnType<T>;
  return (...args: Parameters<T>): ReturnType<T> => {
    if (
      lastArgs &&
      args.length === lastArgs.length &&
      args.every((arg, i) => arg === lastArgs[i])
    ) {
      return lastResult;
    } else {
      lastArgs = args;
      lastResult = fn(...args);
      return lastResult;
    }
  };
}
