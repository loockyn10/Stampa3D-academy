import { LandingFaq } from "./LandingFaq";
import { LandingFinalCta } from "./LandingFinalCta";
import { LandingFooter } from "./LandingFooter";
import { LandingMechanism } from "./LandingMechanism";
import { LandingMembershipHero } from "./LandingMembershipHero";
import { LandingMembershipNavbar } from "./LandingMembershipNavbar";
import { LandingPillars } from "./LandingPillars";
import { LandingPricing } from "./LandingPricing";
import { LandingProblem } from "./LandingProblem";
import { LandingProductDemo } from "./LandingProductDemo";
import { LandingQuickProof } from "./LandingQuickProof";
import { LandingResults } from "./LandingResults";
import { LandingTestimonials } from "./LandingTestimonials";

export function LandingMembershipPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-stampa-bg font-sans text-stampa-text selection:bg-stampa-orange/30 selection:text-orange-100">
      <LandingMembershipNavbar />

      <style>{`
        @keyframes landing-enter {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .landing-enter {
          animation: landing-enter 800ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @media (prefers-reduced-motion: reduce) {
          .landing-enter {
            animation: none;
          }
        }
      `}</style>

      <main>
        <LandingMembershipHero />
        <LandingQuickProof />
        <LandingProblem />
        <LandingMechanism />
        <LandingProductDemo />
        <LandingPillars />
        <LandingResults />
        <LandingTestimonials />
        <LandingPricing />
        <LandingFaq />
        <LandingFinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
