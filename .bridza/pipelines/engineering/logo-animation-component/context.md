# Build animated logo component (SVG + CSS keyframes)

## Intent
Create a reusable React component that renders the Bridza logo (from favicon.svg) with a smooth entrance animation. The component plays once on mount and can be dismissed via click.

## What
- Extract Bridza logo SVG from public/favicon.svg or render inline
- Define CSS keyframes animation (stagger the 3 circles + connecting path with 200-300ms total duration)
- Create `<AnimatedLogo />` React component
- Animation should fade in + slightly scale up the circles in sequence
- Component accepts optional `onComplete` callback for when animation finishes

## Acceptance criteria
- Logo renders with circles animating in staggered sequence (circle 1 → circle 2 → circle 3 → connecting path)
- Total animation duration 300-500ms, smooth easing
- SVG is crisp at all sizes (uses viewBox, no fixed dimensions)
- Component mounts, animates automatically, does not loop
- Clicking anywhere dismisses the logo (fade out, call onComplete)
- No external animation libraries (use CSS keyframes only)
