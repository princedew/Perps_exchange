type PendingRequest = {
  targetQuantity: number;
  resolve: (filledQty: number) => void;
  reject: (error: Error) => void;
};

type RequestId = string;

const pendingRequests = new Map<RequestId, PendingRequest>();

export function createPendingRequest(
  reqId: RequestId,
  targetQuantity: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    pendingRequests.set(reqId, {
      targetQuantity,
      resolve,
      reject,
    });
  });
}

export function resolvePendingRequest(reqId: string, filledQty: number): void {
  const pending = pendingRequests.get(reqId);

  if (!pending) return;

  // Don't resolve if the order is only partially filled.
  if (filledQty < pending.targetQuantity) return;

  pendingRequests.delete(reqId);
  pending.resolve(filledQty);
}

export function rejectPendingRequest(reqId: string, error: Error): void {
  const pending = pendingRequests.get(reqId);

  if (!pending) return;

  pendingRequests.delete(reqId);
  pending.reject(error);
}
