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
import type { WaitlistPromoteContext } from "../types";
import { formatClassWhen } from "../format";
import { styles } from "./styles";

/**
 * v0.25.0 (Sprint B) — Waitlist promote.
 * Fires on booking_events.event_type IN ('promoted_manual', 'promoted_auto').
 * The member has moved from waitlist to booked — same action items as a
 * fresh booking confirmation but with the "you're off the waitlist" hook.
 */

export const WAITLIST_PROMOTE_SUBJECT = (ctx: WaitlistPromoteContext) =>
  `You're in: ${ctx.class_title}`;

export default function WaitlistPromoteEmail({
  studio_name,
  member_name,
  class_title,
  class_starts_at,
  class_instructor,
  class_location,
  cancellation_window_hours,
}: WaitlistPromoteContext) {
  const greeting = member_name ? `Hi ${member_name},` : "Hi,";
  const when = formatClassWhen(class_starts_at);
  return (
    <Html>
      <Head />
      <Preview>{`Off the waitlist: ${class_title} at ${when}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>You&apos;re off the waitlist</Heading>
          <Text style={styles.lead}>{greeting}</Text>
          <Text style={styles.para}>
            A spot opened up. You&apos;re now booked into{" "}
            <strong>{class_title}</strong> at <strong>{when}</strong>
            {class_instructor ? ` with ${class_instructor}` : ""}
            {class_location ? ` (${class_location})` : ""}.
          </Text>
          {cancellation_window_hours !== undefined && (
            <Text style={styles.para}>
              If your plans have changed, cancel at least{" "}
              {cancellation_window_hours} hours before the start to keep
              your credit.
            </Text>
          )}
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
