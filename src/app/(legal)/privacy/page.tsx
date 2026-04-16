import { PRIVACY_VERSION } from '@/lib/legal/versions';

export const metadata = {
  title: 'Privacy Policy - Lastest',
};

export default function PrivacyPolicyPage() {
  return (
    <article className="prose prose-neutral dark:prose-invert max-w-none">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: {PRIVACY_VERSION}</p>

      <h2>1. Data Controller</h2>
      <p>
        Lastest (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is the data controller responsible for processing your personal data in
        connection with the Lastest service (&quot;the Service&quot;).
      </p>
      <p>
        Email: info@lastest.cloud
      </p>

      <h2>2. Personal Data We Collect</h2>
      <p>We collect the following categories of personal data:</p>
      <ul>
        <li>
          <strong>Account information:</strong> name, email address, and password hash when you
          register directly; or name, email, and profile picture when you sign up via GitHub or
          Google OAuth
        </li>
        <li>
          <strong>Usage data:</strong> IP address, browser type, operating system, pages visited,
          and actions taken within the Service
        </li>
        <li>
          <strong>Test data:</strong> screenshots, test scripts, and test results you create through
          the Service
        </li>
        <li>
          <strong>Communication preferences:</strong> your marketing email consent status
        </li>
      </ul>

      <h2>3. Legal Basis for Processing</h2>
      <p>We process your personal data based on the following legal grounds under GDPR:</p>
      <ul>
        <li>
          <strong>Performance of a contract (Article 6(1)(b)):</strong> processing necessary to
          provide the Service you have signed up for, including account management, authentication,
          and transactional communications (e.g., password reset emails, security alerts, invitation
          emails)
        </li>
        <li>
          <strong>Consent (Article 6(1)(a)):</strong> marketing communications, including product
          updates, tips, tutorials, and feature announcements. You can opt in during registration and
          withdraw consent at any time in your account settings
        </li>
        <li>
          <strong>Legitimate interests (Article 6(1)(f)):</strong> improving and securing the
          Service, analyzing usage patterns, and preventing fraud
        </li>
        <li>
          <strong>Legal obligation (Article 6(1)(c)):</strong> where we are required to retain data
          by applicable law
        </li>
      </ul>

      <h2>4. How We Use Your Data</h2>
      <ul>
        <li>To provide, maintain, and improve the Service</li>
        <li>To authenticate your identity and manage your account</li>
        <li>To send transactional emails necessary for the Service (password resets, security alerts, team invitations)</li>
        <li>To send marketing communications if you have opted in (product updates, tips, feature announcements)</li>
        <li>To monitor and analyze usage to improve performance and user experience</li>
        <li>To detect and prevent security threats and abuse</li>
      </ul>

      <h2>5. We Do Not Sell Your Data</h2>
      <p>
        We do not sell, rent, or trade your personal data to third parties for their marketing
        purposes. We will never monetize your personal data by selling it.
      </p>

      <h2>6. Data Sharing</h2>
      <p>We may share your personal data only in the following circumstances:</p>
      <ul>
        <li>
          <strong>Service providers:</strong> with trusted third-party providers who assist us in
          operating the Service (e.g., hosting, email delivery, analytics), bound by data processing
          agreements
        </li>
        <li>
          <strong>Legal requirements:</strong> when required by law, regulation, legal process, or
          governmental request
        </li>
        <li>
          <strong>Business transfers:</strong> in connection with a merger, acquisition, or sale of
          assets, with appropriate notice to you
        </li>
        <li>
          <strong>Your team:</strong> information necessary for team collaboration within the Service
          is visible to other members of your team
        </li>
      </ul>

      <h2>7. International Data Transfers</h2>
      <p>
        Your data may be processed in countries outside the European Economic Area (EEA). When we
        transfer personal data outside the EEA, we ensure appropriate safeguards are in place, such
        as EU Standard Contractual Clauses (SCCs), to protect your data in accordance with GDPR.
      </p>

      <h2>8. Cookies and Tracking</h2>
      <p>
        We use essential cookies required for the functioning of the Service (e.g., session cookies
        for authentication). We do not use third-party advertising or tracking cookies.
      </p>

      <h2>9. Data Retention</h2>
      <p>
        We retain your personal data for as long as your account is active or as needed to provide
        the Service. After account deletion, we will delete or anonymize your personal data within 90
        days, except where retention is required by law or for legitimate business purposes (e.g.,
        resolving disputes, enforcing agreements).
      </p>
      <p>
        Consent records are retained for the duration of your account and for up to 5 years after
        account deletion to demonstrate GDPR compliance.
      </p>

      <h2>10. Your Rights Under GDPR</h2>
      <p>
        As a data subject in the EU/EEA, you have the following rights:
      </p>
      <ul>
        <li><strong>Right of access:</strong> request a copy of the personal data we hold about you</li>
        <li><strong>Right to rectification:</strong> request correction of inaccurate or incomplete data</li>
        <li><strong>Right to erasure:</strong> request deletion of your personal data (&quot;right to be forgotten&quot;)</li>
        <li><strong>Right to restriction:</strong> request that we limit processing of your data in certain circumstances</li>
        <li><strong>Right to data portability:</strong> receive your data in a structured, machine-readable format</li>
        <li><strong>Right to object:</strong> object to processing based on legitimate interests or for direct marketing</li>
        <li><strong>Right to withdraw consent:</strong> withdraw consent at any time for processing based on consent (e.g., marketing emails), without affecting the lawfulness of processing before withdrawal</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at privacy@dexilion.com. We will respond within
        30 days of receiving your request.
      </p>

      <h2>11. Marketing Communications</h2>
      <p>
        If you opt in to marketing communications during registration or in your account settings,
        we may send you product updates, tips, tutorials, and feature announcements. You can
        withdraw your consent at any time by:
      </p>
      <ul>
        <li>Toggling the marketing emails preference off in your account settings</li>
        <li>Contacting us at privacy@dexilion.com</li>
      </ul>
      <p>
        Withdrawing consent for marketing emails does not affect transactional emails that are
        necessary for the operation of the Service.
      </p>

      <h2>12. Data Security</h2>
      <p>
        We implement appropriate technical and organizational measures to protect your personal data,
        including encryption in transit and at rest, access controls, and regular security reviews.
        However, no system is completely secure, and we cannot guarantee absolute security.
      </p>

      <h2>13. Children</h2>
      <p>
        The Service is not directed to individuals under the age of 16. We do not knowingly collect
        personal data from children. If we become aware that a child has provided us with personal
        data, we will take steps to delete it.
      </p>

      <h2>14. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of material changes
        by posting the updated policy on this page and updating the &quot;Last updated&quot; date. We
        encourage you to review this page periodically.
      </p>

      <h2>15. Supervisory Authority</h2>
      <p>
        If you believe we have not adequately addressed your data protection concerns, you have the
        right to lodge a complaint with your local supervisory authority. In Hungary, the competent
        authority is:
      </p>
      <p>
        <strong>Nemzeti Adatvedelmi es Informacioszabadsag Hatosag (NAIH)</strong>
        <br />
        National Authority for Data Protection and Freedom of Information
        <br />
        Website: naih.hu
      </p>

      <h2>16. Contact</h2>
      <p>
        For questions about this Privacy Policy or to exercise your data protection rights, contact
        us at:
      </p>
      <p>
        <strong>Lastest</strong>
        <br />
        Email: info@lastest.cloud
      </p>
    </article>
  );
}
