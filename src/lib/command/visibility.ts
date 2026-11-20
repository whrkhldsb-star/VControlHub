export function canReadCommandBody(viewerId: string, requesterId: string | null, canApprove: boolean) {
  return canApprove || requesterId === viewerId;
}
