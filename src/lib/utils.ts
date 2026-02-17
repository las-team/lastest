import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { NextRequest } from "next/server"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getPublicUrl(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}
