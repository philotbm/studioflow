import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { BookingConfirmationContext } from "../types";
import { formatClassWhen } from "../format";

/**
 * v0.25.0 (Sprint B) — Booking confirmation.
 * Fired immediately when booking_events records a 'booked' transition.
 */

export const BOOKING_CONFIRMATION_SUBJECT = (
  ctx: BookingConfirmationContext,
) => `You're booked into ${ctx.class_title}`;

export default function BookingConfirmationEmail({
  studio_name,
  member_name,
  class_title,
  class_starts_at,
  class_instructor,
  class_location,
  cancellation_window_hours,
}: BookingConfirmationContext) {
  const greeting = member_name ? `Hi ${member_name},` : "Hi,";
  const when = formatClassWhen(class_starts_at);
  return (
    <Html>
      <Head />
      <Preview>{`You're booked into ${class_title} at ${when}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={h1}>{class_title}</Heading>
          <Text style={lead}>{greeting}</Text>
          <Text style={para}>
            You&apos;re booked into <strong>{class_title}</strong> at{" "}
            <strong>{when}</strong>
            {class_instructor ? ` with ${class_instructor}` : ""}
            {class_location ? ` (${class_location})` : ""}.
          </Text>
          <Section>
            <Text style={para}>
              We&apos;ll send you a reminder 24 hours before the class.
              {cancellation_window_hours !== undefined
                ? ` You can cancel up to ${cancellation_window_hours} hours before the start without losing your credit.`
                : ""}
            </Text>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Sent by StudioFlow on behalf of {studio_name}. If you didn&apos;t
            expect this, reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f7f7f7",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "560px",
};
const h1: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 16px",
};
const lead: React.CSSProperties = {
  fontSize: "14px",
  margin: "0 0 12px",
};
const para: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 12px",
};
const hr: React.CSSProperties = {
  border: "none",
  borderTop: "1px solid #e6e6e6",
  margin: "24px 0",
};
const footer: React.CSSProperties = {
  fontSize: "12px",
  color: "#888",
  margin: 0,
};
