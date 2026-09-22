// Aira mark, inlined so it scales and themes with currentColor-independent
// gradient fills. Source: brand/logos/aira-mark.svg (task #122).
let uid = 0;

export default function Logo({ size = 22 }: { size?: number }) {
  const id = uid++;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
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
    </svg>
  );
}
