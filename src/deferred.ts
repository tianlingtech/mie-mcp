export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

export function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const deferred: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: (value) => {
      if (!deferred.settled) {
        deferred.settled = true;
        resolvePromise(value);
      }
    },
    reject: (error) => {
      if (!deferred.settled) {
        deferred.settled = true;
        rejectPromise(error);
      }
    },
    settled: false,
  };

  return deferred;
}
