export function followupDeliveryPatch(input: {
  sent: boolean;
  followupCount: number;
  sentAt: string;
  nextFollowupAt: string;
  retryAt: string;
}) {
  if (!input.sent) {
    return { next_followup_at: input.retryAt };
  }

  return {
    followup_count: input.followupCount + 1,
    last_outbound_at: input.sentAt,
    next_followup_at: input.nextFollowupAt,
  };
}

export function reviewRequestDeliveryPatch(sent: boolean, sentAt: string) {
  return sent
    ? { review_requested_at: sentAt, last_outbound_at: sentAt }
    : null;
}
