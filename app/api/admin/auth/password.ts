import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * POST /api/admin/auth/password
 * Validates admin password and returns a session token.
 */
export async function POST(req: NextRequest) {
  if (req.method !== 'POST') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { password } = await req.json();

    if (!password) {
      return NextResponse.json({ message: 'Password is required.' }, { status: 400 });
    }

    // Compare against ADMIN_PASSWORD environment variable
    const adminPassword = process.env.ADMIN_PASSWORD || process.env.CRON_SECRET || '';
    if (!adminPassword || password !== adminPassword) {
      return NextResponse.json({ message: 'Invalid password.' }, { status: 401 });
    }

    // Generate a session token (1 hour TTL)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresIn = 3600; // 1 hour

    // In production, you'd store this token server-side with TTL
    // For now, we'll sign it with a secret to prevent tampering
    const signature = crypto
      .createHmac('sha256', process.env.ADMIN_SESSION_SECRET || 'default-secret')
      .update(sessionToken)
      .digest('hex');

    return NextResponse.json(
      {
        sessionToken: `${sessionToken}.${signature}`,
        expiresIn,
        message: 'Password verified.',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[admin/auth/password]', error);
    return NextResponse.json({ message: 'Authentication failed.' }, { status: 500 });
  }
}
