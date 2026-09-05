import { LandingV2Hero } from "./LandingV2Hero";
import { LandingV2Navbar } from "./LandingV2Navbar";
import { LandingV2ValueStrip } from "./LandingV2ValueStrip";

export function LandingV2() {
  return (
    <div className="min-h-screen overflow-x-clip bg-stampa-bg text-stampa-text selection:bg-stampa-orange/30 selection:text-white">
      <LandingV2Navbar />
      <div>
        <LandingV2Hero />
        <LandingV2ValueStrip />

        {/* Transición reservada para la próxima sección de Landing V2. */}
        <div
          aria-hidden="true"
          className="relative h-28 overflow-hidden border-t border-white/[0.04] sm:h-36"
        >
          <div className="absolute inset-x-0 top-0 mx-auto h-28 max-w-5xl bg-[radial-gradient(ellipse_at_top,rgba(255,120,10,0.08),transparent_68%)]" />
        </div>
      </div>
    </div>
  );
}
