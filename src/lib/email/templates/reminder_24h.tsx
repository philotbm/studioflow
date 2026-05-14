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
import type { Reminder24hContext } from "../types";
import { formatClassWhen } from "../format";
import { styles } from "./styles";

/**
 * v0.25.0 (Sprint B) — T-24h reminder.
 * Fired by the cron when scheduled_for elapses (set at queue time to
 * class.starts_at - 24h). Skipped at queue time if the booking is
 * placed less than 24h before the class.
 */

export const REMINDER_24H_SUBJECT = (ctx: Reminder24hContext) =>
  `Reminder: ${ctx.class_title} tomorrow`;

export default function Reminder24hEmail({
  studio_name,
  member_name,
  class_title,
  class_starts_at,
  class_instructor,
  class_location,
  cancellation_window_hours,
}: Reminder24hContext) {
  const greeting = member_name ? `Hi ${member_name},` : "Hi,";
  const when = formatClassWhen(class_starts_at);
  return (
    <Html>
      <Head />
      <Preview>{`Reminder: ${class_title} tomorrow at ${when}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>See you tomorrow</Heading>
          <Text style={styles.lead}>{greeting}</Text>
          <Text style={styles.para}>
            Just a reminder: you&apos;re booked into{" "}
            <strong>{class_title}</strong> at <strong>{when}</strong>
            {class_instructor ? ` with ${class_instructor}` : ""}
            {class_location ? ` (${class_location})` : ""}.
          </Text>
          {cancellation_window_hours !== undefined && (
            <Text style={styles.para}>
              If you can&apos;t make it, cancel at least{" "}
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
