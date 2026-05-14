import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import type { CancellationReceiptContext } from "../types";
import { formatClassWhen } from "../format";
import { styles } from "./styles";

/**
 * v0.25.0 (Sprint B) — Cancellation receipt.
 * Fires on booking_events.event_type IN ('cancelled', 'late_cancel').
 * `refundable=true` corresponds to the 'cancelled' branch (within
 * window); 'late_cancel' is non-refundable per cancellation policy.
 */

export const CANCELLATION_RECEIPT_SUBJECT = (
  ctx: CancellationReceiptContext,
) => `Cancellation: ${ctx.class_title}`;

export default function CancellationReceiptEmail({
  studio_name,
  member_name,
  class_title,
  class_starts_at,
  class_instructor,
  class_location,
  refundable,
}: CancellationReceiptContext) {
  const greeting = member_name ? `Hi ${member_name},` : "Hi,";
  const when = formatClassWhen(class_starts_at);
  return (
    <Html>
      <Head />
      <Preview>{`Cancellation: ${class_title}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>Cancellation confirmed</Heading>
          <Text style={styles.lead}>{greeting}</Text>
          <Text style={styles.para}>
            Your booking for <strong>{class_title}</strong> at{" "}
            <strong>{when}</strong>
            {class_instructor ? ` with ${class_instructor}` : ""}
            {class_location ? ` (${class_location})` : ""} has been
            cancelled.
          </Text>
          <Text style={styles.para}>
            {refundable
              ? "Your credit has been refunded to your account."
              : "This was after the free-cancellation window, so the credit is not refunded. The booking is released for waitlist promotion."}
          </Text>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Sent by StudioFlow on behalf of {studio_name}. If you
            didn&apos;t expect this, reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
