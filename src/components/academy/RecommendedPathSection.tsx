"use client";

import React from "react";
import Link from "next/link";
import { Compass, Settings2 } from "lucide-react";
import { CourseCard } from "@/components/cards/course-card";
import { 
  getRecommendedCourseOrder, 
  UserProfile, 
  findBestLearningPath, 
  formatPrinterBrandLabel, 
  formatExperienceLevelLabel, 
  formatMainGoalLabel,
  formatCommercialStageLabel
} from "@/lib/learning-roadmaps";

interface RecommendedPathSectionProps {
  profile: UserProfile | null;
  learningPaths: any[];
  courses: any[];
}

export function RecommendedPathSection({ profile, learningPaths, courses }: RecommendedPathSectionProps) {
  if (courses.length === 0) return null;

  const bestDbPath = findBestLearningPath(profile, learningPaths);
  
  let roadmapTitle = "";
  let roadmapSubtitle = "";
  let roadmapChips: string[] = [];
  let roadmapCourses: any[] = [];
  
  if (bestDbPath && bestDbPath.learning_path_courses?.length > 0) {
    // DB Roadmap
    roadmapTitle = bestDbPath.name;
    roadmapSubtitle = bestDbPath.description;
    
    if (bestDbPath.printer_brand) roadmapChips.push(formatPrinterBrandLabel(bestDbPath.printer_brand));
    if (bestDbPath.experience_level) roadmapChips.push(formatExperienceLevelLabel(bestDbPath.experience_level));
    if (bestDbPath.main_goal) roadmapChips.push(formatMainGoalLabel(bestDbPath.main_goal));
    if (bestDbPath.commercial_stage) roadmapChips.push(formatCommercialStageLabel(bestDbPath.commercial_stage));
    if (roadmapChips.length === 0) roadmapChips.push("Ruta General");

    // Map courses
    const sortedDbCourses = [...bestDbPath.learning_path_courses].sort((a, b) => a.sort_order - b.sort_order);
    roadmapCourses = sortedDbCourses.map(lpc => {
      const c = courses.find(course => course.id === lpc.course_id);
      if (!c) return null;
      return {
        ...c,
        roadmap_reason: lpc.reason
      };
    }).filter(Boolean);

  } else {
    // Fallback hardcoded logic
    const fallbackRoadmap = getRecommendedCourseOrder(profile, courses);
    roadmapTitle = fallbackRoadmap.title;
    roadmapSubtitle = fallbackRoadmap.subtitle;
    roadmapChips = fallbackRoadmap.chips;
    roadmapCourses = fallbackRoadmap.recommendedCourses;
  }
  
  if (roadmapCourses.length === 0) return null;

  return (
    <div className="mb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-2">
            <Compass className="text-stampa-orange" size={24} /> {roadmapTitle}
          </h2>
          <p className="text-gray-400 text-sm">{roadmapSubtitle}</p>
          
          {roadmapChips.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {roadmapChips.map(chip => (
                <span key={chip} className="px-3 py-1 bg-white/5 border border-stampa-border rounded-full text-xs text-gray-300 font-medium">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
        
        <Link 
          href="/configuracion?tab=cuenta" 
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors py-2"
        >
          <Settings2 size={16} /> Editar preferencias
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {roadmapCourses.map((c, index) => (
          <div key={`rec-${c.id}`} className="relative group">
            <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-stampa-orange text-white flex items-center justify-center font-bold text-sm shadow-lg z-10 border-4 border-[#050505]">
              {index + 1}
            </div>
            <div className="rounded-3xl border border-[#ff6a00]/30 shadow-[0_0_15px_rgba(255,106,0,0.1)] overflow-hidden h-full">
              <CourseCard course={c} />
              {c.roadmap_reason && (
                <div className="bg-stampa-orange/10 px-4 py-3 text-xs text-stampa-orange font-medium border-t border-[#ff6a00]/20 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-stampa-orange animate-pulse" />
                  {c.roadmap_reason}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
