export function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>(function withResolversExecutor(promiseResolve, promiseReject) {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject } as const;
}

