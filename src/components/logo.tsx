/**
 * ISTO Short Brand Logotype — paths copied unchanged from the official file
 * "ISTO - Short Brand Logotype - Black.svg" (Logobook 2026). Colour follows the theme:
 * black on light backgrounds, white on dark (both official versions). Minimum digital width: 120px.
 */
export function IstoLogo({ width = 128, className = "" }: { width?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 255 48.98"
      width={Math.max(width, 120)}
      role="img"
      aria-label="ISTO"
      className={className}
      fill="currentColor"
    >
      <rect y="1.44" width="2.88" height="46.11" />
      <path d="M230.53,46.11c-11.9,0-21.58-9.69-21.58-21.6s9.68-21.6,21.58-21.6,21.58,9.69,21.58,21.6-9.68,21.6-21.58,21.6ZM230.53,0c-13.5,0-24.47,10.99-24.47,24.49s10.98,24.49,24.47,24.49,24.47-10.99,24.47-24.49S244.02,0,230.53,0Z" />
      <path d="M88.32,33.23c0,8.64-7.01,15.68-15.65,15.68s-15.67-7.04-15.67-15.68h2.88c0,7.06,5.73,12.8,12.78,12.8s12.78-5.74,12.78-12.8-5.73-12.78-12.78-12.78c-5.46,0-9.9-4.46-9.9-9.91S67.21.63,72.67.63v2.89c-3.88,0-7.01,3.14-7.01,7.02s3.14,7.02,7.01,7.02c8.64,0,15.65,7.02,15.65,15.67Z" />
      <polygon points="128.87 3.52 143.09 3.52 143.09 47.56 145.98 47.56 145.98 3.52 160.2 3.52 160.2 .63 128.87 .63 128.87 3.52" />
    </svg>
  );
}
