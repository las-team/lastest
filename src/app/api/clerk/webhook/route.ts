import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import * as queries from '@/lib/db/queries';
import type { UserRole } from '@/lib/db/schema';

type ClerkWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};

const CLERK_ROLE_MAP: Record<string, UserRole> = {
  'org:owner': 'owner',
  'org:admin': 'admin',
  'org:member': 'member',
  'org:viewer': 'viewer',
};

function mapClerkRole(clerkRole: string): UserRole {
  return CLERK_ROLE_MAP[clerkRole] || 'member';
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!webhookSecret) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SIGNING_SECRET not set');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  // Get Svix headers
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const body = await request.text();

  // Verify signature
  const wh = new Webhook(webhookSecret);
  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error('[Clerk Webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  console.log(`[Clerk Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'user.created': {
        const { id, email_addresses, first_name, last_name, image_url } = event.data as {
          id: string;
          email_addresses: { email_address: string }[];
          first_name: string | null;
          last_name: string | null;
          image_url: string | null;
        };
        const email = email_addresses?.[0]?.email_address;
        if (!email) break;

        const name = [first_name, last_name].filter(Boolean).join(' ') || null;

        // Check if user already exists (e.g. from old auth)
        const existing = await queries.getUserByClerkId(id);
        if (!existing) {
          await queries.createUser({
            email,
            name,
            avatarUrl: image_url ?? null,
            clerkId: id,
            hashedPassword: null,
            emailVerified: true,
            role: 'member',
          });
        }
        break;
      }

      case 'user.updated': {
        const { id, email_addresses, first_name, last_name, image_url } = event.data as {
          id: string;
          email_addresses: { email_address: string }[];
          first_name: string | null;
          last_name: string | null;
          image_url: string | null;
        };
        const user = await queries.getUserByClerkId(id);
        if (user) {
          const email = email_addresses?.[0]?.email_address;
          const name = [first_name, last_name].filter(Boolean).join(' ') || null;
          await queries.updateUser(user.id, {
            ...(email ? { email } : {}),
            name,
            avatarUrl: image_url ?? null,
          });
        }
        break;
      }

      case 'user.deleted': {
        const { id } = event.data as { id: string };
        const user = await queries.getUserByClerkId(id);
        if (user) {
          // Soft handling — just log. FK refs make hard delete risky.
          console.log(`[Clerk Webhook] User deleted in Clerk: ${id}, local id: ${user.id}`);
        }
        break;
      }

      case 'organization.created': {
        const { id, name, slug } = event.data as {
          id: string;
          name: string;
          slug: string;
        };
        const existing = await queries.getTeamByClerkOrgId(id);
        if (!existing) {
          const team = await queries.createTeam({ name, slug });
          await queries.updateTeam(team.id, { clerkOrgId: id });
        }
        break;
      }

      case 'organization.updated': {
        const { id, name, slug } = event.data as {
          id: string;
          name: string;
          slug: string;
        };
        const team = await queries.getTeamByClerkOrgId(id);
        if (team) {
          await queries.updateTeam(team.id, { name, slug });
        }
        break;
      }

      case 'organizationMembership.created': {
        const { organization, public_user_data, role } = event.data as {
          organization: { id: string };
          public_user_data: { user_id: string };
          role: string;
        };
        const user = await queries.getUserByClerkId(public_user_data.user_id);
        const team = await queries.getTeamByClerkOrgId(organization.id);
        if (user && team) {
          await queries.updateUser(user.id, {
            teamId: team.id,
            role: mapClerkRole(role),
          });
        }
        break;
      }

      case 'organizationMembership.updated': {
        const { public_user_data, role } = event.data as {
          public_user_data: { user_id: string };
          role: string;
        };
        const user = await queries.getUserByClerkId(public_user_data.user_id);
        if (user) {
          await queries.updateUser(user.id, { role: mapClerkRole(role) });
        }
        break;
      }

      case 'organizationMembership.deleted': {
        const { public_user_data } = event.data as {
          public_user_data: { user_id: string };
        };
        const user = await queries.getUserByClerkId(public_user_data.user_id);
        if (user) {
          await queries.updateUser(user.id, { teamId: null });
        }
        break;
      }

      default:
        console.log(`[Clerk Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[Clerk Webhook] Error handling ${event.type}:`, error);
    return NextResponse.json({ error: 'Webhook handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
