import { Metadata } from 'next';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingStorytelling } from '@/components/landing/LandingStorytelling';
import { LandingFeatureGrid } from '@/components/landing/LandingFeatureGrid';
import { LandingComparison } from '@/components/landing/LandingComparison';
import { LandingRoadmap } from '@/components/landing/LandingRoadmap';
import { LandingTools } from '@/components/landing/LandingTools';
import { LandingCTA } from '@/components/landing/LandingCTA';

export const metadata: Metadata = {
  title: "Stampa3D Academy | Academia de impresión 3D",
  description: "Aprendé impresión 3D, calculá precios, organizá tu stock y convertí tu impresora en un negocio real.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black font-sans selection:bg-orange-500/30 selection:text-orange-200">
      {/* Custom styles for animations not included in standard Tailwind */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes stampa-float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
          100% { transform: translateY(0px); }
        }
        @keyframes stampa-glow {
          0% { box-shadow: 0 0 15px rgba(234,88,12,0.2); }
          50% { box-shadow: 0 0 40px rgba(234,88,12,0.6); }
          100% { box-shadow: 0 0 15px rgba(234,88,12,0.2); }
        }
        @keyframes stampa-layer-scan {
          0% { top: -10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 110%; opacity: 0; }
        }
        @keyframes stampa-reveal {
          from { opacity: 0; transform: translateY(40px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes stampa-pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(234,88,12,0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 15px rgba(234,88,12,0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(234,88,12,0); }
        }
        @keyframes background-pan {
          from { background-position: 0% 0%; }
          to { background-position: 0% 100%; }
        }
        
        @keyframes stampa-shine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes stampa-nozzle-move {
          0% { transform: translateX(-15px); }
          50% { transform: translateX(15px); }
          100% { transform: translateX(-15px); }
        }
        @keyframes stampa-layer-build {
          0% { opacity: 0.1; box-shadow: none; }
          20% { opacity: 0.8; box-shadow: 0 0 10px rgba(234,88,12,0.8); }
          100% { opacity: 0.3; box-shadow: 0 0 2px rgba(234,88,12,0.2); }
        }
        
        .animate-fade-in-up {
          animation: fadeInUp 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          opacity: 0;
        }
        .stampa-float {
          animation: stampa-float 6s ease-in-out infinite;
        }
        .stampa-glow {
          animation: stampa-glow 3s ease-in-out infinite;
        }
        .stampa-pulse {
          animation: stampa-pulse 2s infinite;
        }
        .stampa-reveal-hidden {
          opacity: 0;
          transform: translateY(40px) scale(0.98);
        }
        .stampa-reveal-visible {
          animation: stampa-reveal 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .stampa-layer-bg {
          background-size: 100% 40px;
          animation: background-pan 20s linear infinite;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .animate-fade-in-up, .stampa-float, .stampa-glow, .stampa-pulse, .stampa-reveal-visible, .stampa-layer-bg, .stampa-shine, .stampa-nozzle-move, .stampa-layer-build {
            animation: none !important;
            transform: none !important;
            opacity: 1 !important;
          }
          .stampa-reveal-hidden {
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}} />

      <main>
        <LandingHero />
        <LandingStorytelling />
        <LandingFeatureGrid />
        <LandingComparison />
        <LandingRoadmap />
        <LandingTools />
        <LandingCTA />
      </main>
    </div>
  );
}
