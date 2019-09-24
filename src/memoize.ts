/* eslint-disable @typescript-eslint/no-explicit-any */
export default function memoize<T extends (...args: Array<any>) => any>(
  fn: T
): (...funcArgs: Parameters<T>) => ReturnType<T> {
  let lastArgs: Array<any>;
  let lastResult: any;
  return (...args: Array<any>): any => {
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
