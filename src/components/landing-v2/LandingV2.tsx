import { LandingV2About } from "./LandingV2About";
import { LandingV2BusinessTools } from "./LandingV2BusinessTools";
import { LandingV2Community } from "./LandingV2Community";
import { LandingV2Comparison } from "./LandingV2Comparison";
import { LandingV2Continuity } from "./LandingV2Continuity";
import { LandingV2Courses } from "./LandingV2Courses";
import { LandingV2Ecosystem } from "./LandingV2Ecosystem";
import { LandingV2Faq } from "./LandingV2Faq";
import { LandingV2FinalCta } from "./LandingV2FinalCta";
import { LandingV2Footer } from "./LandingV2Footer";
import { LandingV2Gamification } from "./LandingV2Gamification";
import { LandingV2Hero } from "./LandingV2Hero";
import { LandingV2HowItWorks } from "./LandingV2HowItWorks";
import { LandingV2LearningPaths } from "./LandingV2LearningPaths";
import { LandingV2Navbar } from "./LandingV2Navbar";
import { LandingV2PlatformTour } from "./LandingV2PlatformTour";
import { LandingV2Pricing } from "./LandingV2Pricing";
import { LandingV2Problem } from "./LandingV2Problem";
import { LandingV2SocialProof } from "./LandingV2SocialProof";
import { LandingV2Stampy } from "./LandingV2Stampy";
import { LandingV2ValueStrip } from "./LandingV2ValueStrip";

export function LandingV2() {
  return (
    <div className="min-h-screen overflow-x-clip bg-stampa-bg text-stampa-text selection:bg-stampa-orange/30 selection:text-white">
      <LandingV2Navbar />
      <div>
        <LandingV2Hero />
        <LandingV2ValueStrip />
        <LandingV2Problem />
        <LandingV2Comparison />
        <LandingV2Ecosystem />
        <LandingV2LearningPaths />
        <LandingV2PlatformTour />
        <LandingV2HowItWorks />
        <LandingV2Stampy />
        <LandingV2BusinessTools />
        <LandingV2Courses />
        <LandingV2Community />
        <LandingV2Gamification />
        <LandingV2Continuity />
        <LandingV2SocialProof />
        <LandingV2About />
        <LandingV2Pricing />
        <LandingV2Faq />
        <LandingV2FinalCta />
      </div>
      <LandingV2Footer />
    </div>
  );
}
