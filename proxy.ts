import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { recordVisitorLog } from './app/api/_lib/visitor-tracker';

const PRIVATE_PATHS = ['/admin', '/catalogue-enhancer'];

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  const isPrefetch =
    request.headers.has('next-router-prefetch') ||
    request.headers.get('purpose') === 'prefetch';
  const isInternalPath = pathname.startsWith('/api/') || pathname.startsWith('/_next/');
  const isPrivatePath = PRIVATE_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!isPrefetch && !isInternalPath && !isPrivatePath) {
    event.waitUntil(
      recordVisitorLog(request).catch((error: unknown) => {
        console.error('Visitor tracking failed unexpectedly:', error);
      }),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api/|_next/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:png|jpe?g|webp|gif|svg|ico|css|js|json|map|mp4|webm|woff2?|ttf|pdf|zip)$).*)',
  ],
};
