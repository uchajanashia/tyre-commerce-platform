export interface StaffInvitationDeliveryAdapter {
  deliver(message: {
    purpose: 'invite' | 'password_reset' | 'recovery';
    recipient: string;
    oneTimeUrl: string;
    expiresAt: string;
    correlationId: string;
  }): Promise<{ status: 'accepted' | 'failed'; reference?: string }>;
}

/** No production adapter is registered in this increment; startup remains fail-closed. */
export const STAFF_INVITATION_DELIVERY_ADAPTER = Symbol('STAFF_INVITATION_DELIVERY_ADAPTER');
