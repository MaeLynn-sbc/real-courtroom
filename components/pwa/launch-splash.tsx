// Full-screen branded launch screen for the installed (home-screen) app
// (owner, 2026-10-05: the launch showed a small square logo that "looks
// real slop" — "make a nice background maybe or animation that fills the
// phone when loading").
//
// Pure HTML + CSS on purpose, no JavaScript: it is in the server-rendered
// HTML, so it paints with the very first frame, and it removes itself on
// a fixed CSS timer — nothing to hydrate, nothing that can fail and leave
// a cover stuck over the page. Shown ONLY in standalone display mode (the
// home-screen app); a normal browser visit never sees it. Client-side
// navigation never replays it either: the root layout's markup is not
// re-rendered, so the animation runs once per real launch or refresh.

const STYLES = `
.launch-splash {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  background:
    radial-gradient(circle at 50% 44%, rgba(91, 255, 60, 0.16), rgba(14, 20, 36, 0) 58%),
    #0e1424;
  pointer-events: none;
}
@media (display-mode: standalone) {
  .launch-splash {
    display: flex;
    animation: launch-splash-out 450ms ease-in 1500ms forwards;
  }
}
.launch-splash__stage {
  position: relative;
  display: grid;
  place-items: center;
  width: min(68vw, 320px);
  aspect-ratio: 1;
}
.launch-splash__ring {
  position: absolute;
  inset: 4%;
  border-radius: 9999px;
  border: 2px solid rgba(91, 255, 60, 0.35);
  opacity: 0;
  animation: launch-splash-ring 1600ms ease-out infinite;
}
.launch-splash__ring:nth-child(2) {
  animation-delay: 550ms;
}
.launch-splash__logo {
  position: relative;
  width: 88%;
  height: auto;
  filter: drop-shadow(0 0 28px rgba(91, 255, 60, 0.28));
  animation:
    launch-splash-in 600ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both,
    launch-splash-breathe 1800ms ease-in-out 600ms infinite;
}
.launch-splash__bar {
  position: relative;
  width: 120px;
  height: 3px;
  overflow: hidden;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.1);
}
.launch-splash__bar::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 40%;
  border-radius: inherit;
  background: #5bff3c;
  animation: launch-splash-bar 1100ms ease-in-out infinite;
}
@keyframes launch-splash-in {
  from { opacity: 0; transform: scale(0.82); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes launch-splash-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
@keyframes launch-splash-ring {
  0% { opacity: 0.7; transform: scale(0.7); }
  100% { opacity: 0; transform: scale(1.25); }
}
@keyframes launch-splash-bar {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@keyframes launch-splash-out {
  to { opacity: 0; visibility: hidden; }
}
@media (prefers-reduced-motion: reduce) {
  .launch-splash__ring,
  .launch-splash__bar::after { animation: none; }
  .launch-splash__logo { animation: none; }
}
`;

export function LaunchSplash() {
  return (
    <div className="launch-splash" aria-hidden="true">
      <style>{STYLES}</style>
      <div className="launch-splash__stage">
        <span className="launch-splash__ring" />
        <span className="launch-splash__ring" />
        {/* eslint-disable-next-line @next/next/no-img-element -- must be in the first paint, no next/image loader */}
        <img className="launch-splash__logo" src="/branding/logo-badge.png" alt="" width={720} height={624} />
      </div>
      <div className="launch-splash__bar" />
    </div>
  );
}
