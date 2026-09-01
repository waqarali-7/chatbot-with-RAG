import { NextRequest, NextResponse } from 'next/server';

/**
 * Basic auth on /admin so bookings made in the demo can be verified without
 * exposing the diary publicly. The password is an env var; there are no
 * credentials in source.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse('ADMIN_PASSWORD is not set on this deployment.', { status: 503 });
  }

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const [, password] = atob(header.slice(6)).split(':');
    if (password === expected) return NextResponse.next();
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Meridian admin", charset="UTF-8"' },
  });
}

export const config = { matcher: ['/admin/:path*'] };
