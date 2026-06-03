// Re-export email functions from the auth sub-zone.
// The cloud-auth package is the single source of truth for auth-triggered emails.
export type { SendEmailOptions } from "cloud-auth/src/lib/email";
export { sendEmail, sendPasswordResetEmail, sendInvitationEmail } from "cloud-auth/src/lib/email";
