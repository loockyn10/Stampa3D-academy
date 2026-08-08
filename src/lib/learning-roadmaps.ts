export interface UserProfile {
  main_printer_brand?: string | null;
  main_printer_model?: string | null;
  experience_level?: string | null;
  main_goal?: string | null;
  slicer_preference?: string | null;
  commercial_stage?: string | null;
  onboarding_completed?: boolean | null;
}

export { 
  formatPrinterBrandLabel, 
  formatExperienceLevelLabel, 
  formatMainGoalLabel,
  formatCommercialStageLabel
} from "./profile-options";

export interface RoadmapResult {
  recommendedCourses: any[];
  title: string;
  subtitle: string;
  chips: string[];
}

const normalize = (text: string | null | undefined) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .trim();
};

export function getRecommendedCourseOrder(profile: UserProfile | null, courses: any[]): RoadmapResult {
  const brand = profile?.main_printer_brand || "other";
  const goal = profile?.main_goal || "all";
  
  let title = "Ruta recomendada para empezar";
  let subtitle = "Completá tus preferencias para que podamos ajustar mejor tus recomendaciones.";
  let chips: string[] = [];

  const addChip = (label: string) => {
    if (!chips.includes(label)) chips.push(label);
  };

  // Helper arrays for printer priority
  let priorityRules: string[][] = [];

  if (brand === "bambu_lab") {
    title = "Tu ruta recomendada";
    subtitle = "Armamos esta ruta según tu impresora Bambu Lab y tu objetivo.";
    addChip("Bambu Lab");
    priorityRules = [
      ["ecosistema bambu", "bambu lab", "bambu handy", "makerworld"],
      ["fundamentos", "fundamentos express", "impresion 3d desde cero"],
      ["bambu studio", "bambu slicer"]
    ];
  } else if (brand === "flashforge") {
    title = "Tu ruta recomendada";
    subtitle = "Como tenés una Flashforge, te conviene empezar con fundamentos y después seguir con OrcaSlicer.";
    addChip("Flashforge");
    priorityRules = [
      ["fundamentos"],
      ["orca flashforge", "flashforge"],
      ["orca slicer"],
      ["calibracion"]
    ];
  } else if (brand === "none_yet") {
    title = "Tu ruta recomendada";
    subtitle = "Armamos esta ruta para empezar desde cero antes de elegir o configurar una impresora.";
    addChip("Sin impresora");
    priorityRules = [
      ["fundamentos"],
      ["impresion 3d desde cero"],
      ["primera impresion"],
      ["comprar impresora"],
      ["ecosistema"]
    ];
  } else {
    // creality, elegoo, anycubic, other
    title = "Tu ruta recomendada";
    subtitle = "Te armamos una ruta general para avanzar desde fundamentos hacia OrcaSlicer y calibración.";
    if (brand && brand !== "other") {
      addChip(brand.charAt(0).toUpperCase() + brand.slice(1));
    } else {
      addChip("Ruta General");
    }
    priorityRules = [
      ["fundamentos"],
      ["impresion 3d desde cero"],
      ["orca slicer"],
      ["calibracion"],
      ["slicer avanzado"]
    ];
  }

  // Goal keywords
  let goalKeywords: string[] = [];
  if (goal === "sell_products") {
    addChip("Vender productos");
    goalKeywords = ["vender", "negocio", "presupuestos", "productos", "costos", "calculadora", "taller rentable"];
  } else if (goal === "learn_slicer") {
    addChip("Aprender Slicer");
    goalKeywords = ["orca", "bambu studio", "slicer"];
  } else if (goal === "improve_quality") {
    addChip("Mejorar calidad");
    goalKeywords = ["calibracion", "calidad", "problemas", "troubleshooting", "flow", "temperatura"];
  } else if (goal === "manage_business") {
    addChip("Organizar taller");
    goalKeywords = ["stock", "presupuestos", "productos", "costos", "taller"];
  } else if (goal === "first_print") {
    addChip("Primera impresión");
    goalKeywords = ["primera impresion", "fundamentos", "desde cero"];
  } else if (goal === "all") {
    addChip("Un poco de todo");
  }

  // Add experience chip
  if (profile?.experience_level === "beginner") addChip("Empezando desde cero");
  if (profile?.experience_level === "basic") addChip("Algunas impresiones");
  if (profile?.experience_level === "intermediate") addChip("Quiero mejorar");
  if (profile?.experience_level === "advanced") addChip("Tengo experiencia");

  // Scoring courses
  const scoredCourses = courses.map((course) => {
    let score = 0;
    const titleNorm = normalize(course.title);
    const slugNorm = normalize(course.slug);
    const descNorm = normalize(course.description);
    const searchString = `${titleNorm} ${slugNorm}`;
    let matchedReason = "";

    // 1. Printer Priority Rules
    for (let i = 0; i < priorityRules.length; i++) {
      const keywords = priorityRules[i];
      const weight = 20 - i * 3; // e.g. 20, 17, 14, 11...
      
      const match = keywords.some(kw => searchString.includes(normalize(kw)));
      if (match) {
        score += weight;
        if (!matchedReason) matchedReason = "Recomendado para tu impresora";
        break; // Only match the highest priority level for the printer rule
      }
    }

    // 2. Goal Rules
    if (goalKeywords.length > 0) {
      const matchTitleSlug = goalKeywords.some(kw => searchString.includes(normalize(kw)));
      if (matchTitleSlug) {
        score += 10;
        if (!matchedReason) matchedReason = "Ideal para tu objetivo";
      } else {
        const matchDesc = goalKeywords.some(kw => descNorm.includes(normalize(kw)));
        if (matchDesc) {
          score += 4;
        }
      }
    }

    // 3. Fallback bonus for very generic starting courses if nothing else matched
    if (score === 0) {
      if (searchString.includes("fundamentos") || searchString.includes("desde cero")) {
        score += 2;
        matchedReason = "Base necesaria antes de avanzar";
      }
    }

    return {
      course,
      score,
      matchedReason
    };
  });

  // Filter courses with score > 0, sort by score descending
  let topMatches = scoredCourses
    .filter(sc => sc.score > 0)
    .sort((a, b) => b.score - a.score);

  // If no matches, fallback to generic courses or the first few published courses
  if (topMatches.length === 0) {
    // Try to find generic
    const generic = courses.filter(c => 
      normalize(c.title).includes("fundamentos") || 
      normalize(c.title).includes("desde cero")
    ).map(c => ({ course: c, score: 1, matchedReason: "Base necesaria antes de avanzar" }));
    
    if (generic.length > 0) {
      topMatches = generic;
    } else {
      // Just take the first 3
      topMatches = courses.slice(0, 3).map(c => ({ course: c, score: 1, matchedReason: "" }));
    }
  }

  // Take top 3 to 5 (let's say up to 4 to be clean)
  const recommended = topMatches.slice(0, 4).map(sc => {
    return {
      ...sc.course,
      roadmap_reason: sc.matchedReason
    };
  });

  return {
    recommendedCourses: recommended,
    title,
    subtitle,
    chips
  };
}

// Formatting functions removed and exported from profile-options

export function getLearningPathScore(profile: UserProfile | null, path: any): number {
  if (!profile) return path.is_default ? 0 : -1;

  let score = 0;
  
  // Printer Brand (+4)
  if (path.printer_brand) {
    if (path.printer_brand === profile.main_printer_brand || (path.printer_brand === "elegoo_fdm" && profile.main_printer_brand === "elegoo")) {
      score += 4;
    } else {
      return -1; // Mismatch
    }
  }

  // Experience Level (+3)
  if (path.experience_level) {
    if (path.experience_level === profile.experience_level) {
      score += 3;
    } else {
      return -1; // Mismatch
    }
  }

  // Main Goal (+3)
  if (path.main_goal) {
    if (path.main_goal === profile.main_goal) {
      score += 3;
    } else {
      return -1; // Mismatch
    }
  }



  // Commercial Stage (+2)
  if (path.commercial_stage) {
    if (path.commercial_stage === profile.commercial_stage) {
      score += 2;
    } else {
      return -1;
    }
  }

  return score;
}

export function findBestLearningPath(profile: UserProfile | null, learningPaths: any[]): any | null {
  if (!learningPaths || learningPaths.length === 0) return null;

  let bestPath = null;
  let highestScore = -1;
  let defaultPath = null;

  for (const path of learningPaths) {
    if (!path.is_active) continue;
    
    if (path.is_default && !defaultPath) {
      defaultPath = path;
    }

    const score = getLearningPathScore(profile, path);
    if (score > highestScore) {
      highestScore = score;
      bestPath = path;
    }
  }

  // If no specific match, use default path if exists
  if (highestScore === -1 && defaultPath) {
    return defaultPath;
  }

  // If match was found (even score 0 where everything was null but it wasn't default)
  if (highestScore > -1) {
    return bestPath;
  }

  return null;
}
