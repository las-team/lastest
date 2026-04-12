import { TERMS_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Terms of Service - Lastest',
};

export default function TermsOfServicePage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1>Terms of Service</h1>
      <p className="text-sm text-muted-foreground">Last updated: {TERMS_VERSION}</p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By creating an account or using Lastest (&quot;the Service&quot;), operated by Dexilion Kft
        (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;), a company incorporated under the laws of
        Hungary, you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not
        agree, do not use the Service.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        Lastest is a visual regression testing platform that enables users to record browser
        interactions, run automated tests, compare screenshots, and review visual changes. The
        Service includes web-based tools, APIs, browser extensions, and related documentation.
      </p>

      <h2>3. Account Registration</h2>
      <p>
        To use the Service, you must create an account by providing accurate and complete
        information. You are responsible for maintaining the confidentiality of your account
        credentials and for all activities that occur under your account. You must notify us
        immediately of any unauthorized use.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of any applicable laws</li>
        <li>Attempt to gain unauthorized access to the Service or its related systems</li>
        <li>Interfere with or disrupt the integrity or performance of the Service</li>
        <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
        <li>Use the Service to transmit malware, viruses, or other harmful code</li>
        <li>Resell or redistribute the Service without our prior written consent</li>
      </ul>

      <h2>5. Your Data</h2>
      <p>
        You retain ownership of all data, content, screenshots, and test results you upload or
        generate through the Service (&quot;Your Data&quot;). You grant us a limited license to
        process Your Data solely to provide and improve the Service. We will not sell Your Data to
        third parties. See our <a href="/privacy">Privacy Policy</a> for details on how we handle
        personal data.
      </p>

      <h2>6. Intellectual Property</h2>
      <p>
        The Service, including its software, design, logos, and documentation, is owned by Dexilion
        Kft and is protected by intellectual property laws. These Terms do not grant you any rights
        to our intellectual property except the limited right to use the Service as permitted herein.
      </p>

      <h2>7. Service Availability and Modifications</h2>
      <p>
        We strive to maintain the availability of the Service but do not guarantee uninterrupted
        access. We reserve the right to modify, suspend, or discontinue the Service (or any part
        thereof) at any time with reasonable notice. We may update these Terms from time to time; the
        updated version will be posted on this page with a revised date.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by applicable law, Dexilion Kft shall not be liable for any
        indirect, incidental, special, consequential, or punitive damages, including but not limited
        to loss of profits, data, or business opportunities, arising out of or related to your use
        of the Service.
      </p>
      <p>
        Our total aggregate liability for any claims arising under these Terms shall not exceed the
        amount you paid us in the twelve (12) months preceding the claim.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may terminate your account at any time by contacting us. We may suspend or terminate
        your access if you violate these Terms or for any other reason with reasonable notice. Upon
        termination, your right to use the Service ceases, and we may delete Your Data after a
        reasonable retention period, subject to any legal obligations.
      </p>

      <h2>10. Governing Law and Dispute Resolution</h2>
      <p>
        These Terms are governed by the laws of Hungary and, where applicable, the laws of the
        European Union. Any disputes arising from these Terms shall be submitted to the exclusive
        jurisdiction of the courts of Hungary, unless mandatory consumer protection laws of your
        country of residence provide otherwise.
      </p>

      <h2>11. Contact</h2>
      <p>
        If you have questions about these Terms, please contact us at:
      </p>
      <p>
        <strong>Dexilion Kft</strong>
        <br />
        Email: legal@dexilion.com
      </p>
    </article>
  );
}
