"use server";

export async function dismissConsentBanner() {
  fetch("/api/consents/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ marketingEmails: false }),
  });
}
