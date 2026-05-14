/**
 * Shared inline-style objects for all transactional email templates.
 * Email clients (Gmail, Outlook, Apple Mail) only honour inline styles
 * reliably; CSS classes don't survive most rendering pipelines.
 */

export const styles = {
  body: {
    backgroundColor: "#f7f7f7",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  } as React.CSSProperties,
  container: {
    backgroundColor: "#ffffff",
    margin: "0 auto",
    padding: "32px 24px",
    maxWidth: "560px",
  } as React.CSSProperties,
  h1: {
    fontSize: "20px",
    fontWeight: 600,
    margin: "0 0 16px",
  } as React.CSSProperties,
  lead: {
    fontSize: "14px",
    margin: "0 0 12px",
  } as React.CSSProperties,
  para: {
    fontSize: "14px",
    lineHeight: "1.5",
    margin: "0 0 12px",
  } as React.CSSProperties,
  hr: {
    border: "none",
    borderTop: "1px solid #e6e6e6",
    margin: "24px 0",
  } as React.CSSProperties,
  footer: {
    fontSize: "12px",
    color: "#888",
    margin: 0,
  } as React.CSSProperties,
};
