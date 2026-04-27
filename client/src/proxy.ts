import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  // Assign an anonymous visitor id to uniquely trace returning users cleanly
  if (!request.cookies.has('visitor_id')) {
    response.cookies.set({
      name: 'visitor_id',
      value: crypto.randomUUID(),
      httpOnly: true, // User cannot interact or explicitly read this payload via frontend JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year cookie
    });
  }
  return response;
}
