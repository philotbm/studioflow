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
import type { PaymentReceiptContext } from "../types";
import { formatPriceCents } from "../format";
import { styles } from "./styles";

/**
 * v0.25.0 (Sprint B) — Payment receipt.
 * Fires on purchases.status transitioning to 'completed' (both INSERT
 * and UPDATE paths — see sf_queue_purchase_email trigger). One-shot
 * per (purchase_id, 'payment_receipt') via the partial unique index.
 *
 * Sources:
 *   - 'stripe'           — real Stripe checkout webhook
 *   - 'dev_fake'         — preview-deploy self-serve buy
 *   - 'operator_manual'  — operator test-purchase
 *   - 'fake'             — legacy historical rows (pre-v0.15.0)
 *
 * All sources fire the same receipt — the source text is included in
 * the email body for traceability but the content is the same.
 */

export const PAYMENT_RECEIPT_SUBJECT = (ctx: PaymentReceiptContext) =>
  `Receipt: ${ctx.plan_name}`;

export default function PaymentReceiptEmail({
  studio_name,
  member_name,
  plan_name,
  price_cents_paid,
  credits_granted,
  external_id,
  created_at,
}: PaymentReceiptContext) {
  const greeting = member_name ? `Hi ${member_name},` : "Hi,";
  const purchasedOn = new Date(created_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Html>
      <Head />
      <Preview>{`Receipt for ${plan_name}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Heading style={styles.h1}>Payment received</Heading>
          <Text style={styles.lead}>{greeting}</Text>
          <Text style={styles.para}>
            Thanks for your purchase. Here&apos;s a quick receipt for your
            records.
          </Text>

          <Text style={styles.para}>
            <strong>Plan:</strong> {plan_name}
            <br />
            <strong>Amount:</strong> {formatPriceCents(price_cents_paid)}
            <br />
            {credits_granted !== null && credits_granted !== undefined && (
              <>
                <strong>Credits granted:</strong> {credits_granted}
                <br />
              </>
            )}
            <strong>Purchased:</strong> {purchasedOn}
            <br />
            <strong>Reference:</strong> {external_id}
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
