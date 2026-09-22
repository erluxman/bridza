// Aira wordmark: the gradient mark IS the "A" — "ira" runs straight off it
// as one lockup, not an icon beside a repeated word. Source shape: the old
// standalone mark (brand/logos/aira-mark.svg, task #122); "ira" set in the
// same Inter 700 the brand guidelines call for on the wordmark.
let uid = 0;

const VIEW_W = 146;
const VIEW_H = 64;

export default function Wordmark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const id = uid++;
  const width = Math.round((size * VIEW_W) / VIEW_H);
  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Aira"
      className={className}
    >
      <defs>
        <linearGradient id={`airaLeft-${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4F7BFF" />
          <stop offset="1" stopColor="#6D6BFF" />
        </linearGradient>
        <linearGradient id={`airaRight-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5B4BFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d="M9 36 C6 54 27 58 30.5 40 L37 11"
        fill="none"
        stroke={`url(#airaLeft-${id})`}
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M37 11 L51 55"
        fill="none"
        stroke={`url(#airaRight-${id})`}
        strokeWidth="11"
        strokeLinecap="round"
      />
      <text
        x="60"
        y="50"
        fontFamily="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        fontSize="46"
        fontWeight="700"
        letterSpacing="-1"
        fill="currentColor"
      >
        ira
      </text>
    </svg>
  );
}
