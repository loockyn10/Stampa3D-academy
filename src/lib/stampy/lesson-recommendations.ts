import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StampyKnowledgeIntent,
  StampyKnowledgeIntentType,
} from "./knowledge-intent";

type UnknownRecord = Record<string, unknown>;

export interface StampyLessonCandidate {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string | null;
  isActive: boolean;
  isPublished: boolean;
  isAiRecommendable: boolean;
  aiSummary: string | null;
  aiTopics: string[];
  aiProblems: string[];
  aiLevel: string | null;
  moduleActive: boolean;
  courseId: string;
  courseSlug: string | null;
  courseTitle: string;
  courseStatus: string;
  courseKind: string | null;
  transcriptReady: boolean;
  transcriptText: string;
  transcriptSegmentsCount: number;
  indexedTranscriptContent: string;
}

export interface StampyLessonRecommendation {
  id: string;
  title: string;
  description: string | null;
  ai_summary: string | null;
  ai_level: string | null;
  score: number;
  href: string;
  courseTitle: string;
  courseKind: string | null;
  course_modules: {
    courses: {
      id: string;
      slug: string | null;
      title: string;
      status: string;
      course_kind: string | null;
    };
  };
}

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstRelation(value: unknown): UnknownRecord | null {
  if (Array.isArray(value)) {
    return value.length > 0 && value[0] && typeof value[0] === "object"
      ? (value[0] as UnknownRecord)
      : null;
  }
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hasUsefulVideo(value: string | null): boolean {
  const video = normalize(value);
  return Boolean(
    video &&
      video !== "pendiente" &&
      video !== "proximamente" &&
      video !== "sin video" &&
      video !== "null" &&
      video !== "todo"
  );
}

const STOP_WORDS = new Set([
  "algo",
  "como",
  "cual",
  "cuando",
  "donde",
  "esto",
  "hacer",
  "para",
  "porque",
  "puedo",
  "quiero",
  "sobre",
  "tengo",
  "tenes",
  "video",
  "clase",
  "curso",
  "impresion",
  "impresora",
]);

const QUERY_EXPANSIONS: Array<{ signals: string[]; terms: string[] }> = [
  {
    signals: ["stringing", "hilos"],
    terms: ["stringing", "hilos", "retraccion", "humedad"],
  },
  {
    signals: ["primera capa", "se despega", "no pega"],
    terms: ["primera capa", "adherencia", "offset", "nivelacion", "cama"],
  },
  {
    signals: ["warping", "se levanta"],
    terms: ["warping", "deformacion", "adherencia", "temperatura", "cama"],
  },
  {
    signals: ["soporte", "soportes"],
    terms: ["soporte", "soportes", "interfaz", "voladizo"],
  },
  {
    signals: ["subextrusion", "under extrusion"],
    terms: ["subextrusion", "under extrusion", "flujo", "boquilla"],
  },
  {
    signals: ["sobreextrusion", "over extrusion"],
    terms: ["sobreextrusion", "over extrusion", "flujo"],
  },
];

export function getStampyKnowledgeQueryTerms(query: string): string[] {
  const normalized = normalize(query);
  const terms = new Set(
    normalized
      .split(" ")
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
  );

  for (const expansion of QUERY_EXPANSIONS) {
    if (expansion.signals.some((signal) => normalized.includes(signal))) {
      expansion.terms.forEach((term) => terms.add(normalize(term)));
    }
  }

  return Array.from(terms).filter(Boolean);
}

export function isStampyLessonCandidateEligible(
  candidate: StampyLessonCandidate
): boolean {
  if (
    !candidate.isActive ||
    !candidate.isPublished ||
    !candidate.isAiRecommendable ||
    !candidate.moduleActive ||
    candidate.courseStatus !== "published"
  ) {
    return false;
  }

  const hasDescription = normalize(candidate.description).length >= 40;
  const hasTranscript =
    candidate.transcriptReady &&
    (normalize(candidate.transcriptText).length >= 50 ||
      candidate.transcriptSegmentsCount > 0);
  const hasIndexedTranscript =
    normalize(candidate.indexedTranscriptContent).length >= 80;

  return (
    hasUsefulVideo(candidate.videoUrl) ||
    hasDescription ||
    hasTranscript ||
    hasIndexedTranscript
  );
}

function scoreCandidate(
  candidate: StampyLessonCandidate,
  queryTerms: string[]
): number {
  const title = normalize(candidate.title);
  const topics = normalize(candidate.aiTopics.join(" "));
  const problems = normalize(candidate.aiProblems.join(" "));
  const summary = normalize(candidate.aiSummary);
  const description = normalize(candidate.description);
  const transcript = normalize(
    `${candidate.transcriptText} ${candidate.indexedTranscriptContent}`
  );
  let score = 0;

  for (const term of queryTerms) {
    if (title.includes(term)) score += 6;
    if (problems.includes(term)) score += 5;
    if (topics.includes(term)) score += 5;
    if (summary.includes(term)) score += 3;
    if (description.includes(term)) score += 2;
    if (transcript.includes(term)) score += 4;
  }

  return score;
}

export function rankStampyLessonRecommendations({
  candidates,
  query,
  limit = 2,
}: {
  candidates: StampyLessonCandidate[];
  query: string;
  limit?: number;
}): StampyLessonRecommendation[] {
  const queryTerms = getStampyKnowledgeQueryTerms(query);
  if (queryTerms.length === 0) return [];

  return candidates
    .filter(isStampyLessonCandidateEligible)
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, queryTerms) }))
    .filter(({ score }) => score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 0), 2))
    .map(({ candidate, score }) => {
      const href = `/cursos/${candidate.courseSlug || candidate.courseId}`;
      return {
        id: candidate.id,
        title: candidate.title,
        description: candidate.description,
        ai_summary: candidate.aiSummary,
        ai_level: candidate.aiLevel,
        score,
        href,
        courseTitle: candidate.courseTitle,
        courseKind: candidate.courseKind,
        course_modules: {
          courses: {
            id: candidate.courseId,
            slug: candidate.courseSlug,
            title: candidate.courseTitle,
            status: candidate.courseStatus,
            course_kind: candidate.courseKind,
          },
        },
      };
    });
}

function mapLessonCandidate(
  lesson: UnknownRecord,
  chunksByLesson: Map<string, string>
): StampyLessonCandidate | null {
  const module = firstRelation(lesson.course_modules);
  const course = firstRelation(module?.courses);
  const transcript = firstRelation(lesson.lesson_transcripts);
  const id = typeof lesson.id === "string" ? lesson.id : "";
  const courseId = typeof course?.id === "string" ? course.id : "";
  const title = typeof lesson.title === "string" ? lesson.title : "";
  const courseTitle = typeof course?.title === "string" ? course.title : "";
  if (!id || !courseId || !title || !courseTitle) return null;

  return {
    id,
    title,
    description: typeof lesson.description === "string" ? lesson.description : null,
    videoUrl: typeof lesson.video_url === "string" ? lesson.video_url : null,
    isActive: lesson.is_active === true,
    isPublished: lesson.is_published === true,
    isAiRecommendable: lesson.is_ai_recommendable === true,
    aiSummary: typeof lesson.ai_summary === "string" ? lesson.ai_summary : null,
    aiTopics: asStringArray(lesson.ai_topics),
    aiProblems: asStringArray(lesson.ai_problems),
    aiLevel: typeof lesson.ai_level === "string" ? lesson.ai_level : null,
    moduleActive: module?.is_active === true,
    courseId,
    courseSlug: typeof course?.slug === "string" ? course.slug : null,
    courseTitle,
    courseStatus: typeof course?.status === "string" ? course.status : "",
    courseKind: typeof course?.course_kind === "string" ? course.course_kind : null,
    transcriptReady: transcript?.status === "ready",
    transcriptText:
      typeof transcript?.transcript_text === "string"
        ? transcript.transcript_text
        : "",
    transcriptSegmentsCount: Number(transcript?.segments_count ?? 0),
    indexedTranscriptContent: chunksByLesson.get(id) ?? "",
  };
}

export async function findStampyLessonRecommendations({
  supabase,
  query,
  limit = 2,
}: {
  supabase: SupabaseClient;
  query: string;
  intent?: StampyKnowledgeIntent | null;
  limit?: number;
}): Promise<StampyLessonRecommendation[]> {
  try {
    const { data: rawLessons, error } = await supabase
      .from("lessons")
      .select(`
        id,
        title,
        description,
        video_url,
        is_active,
        is_published,
        is_ai_recommendable,
        ai_summary,
        ai_topics,
        ai_problems,
        ai_level,
        lesson_transcripts (
          status,
          segments_count
        ),
        course_modules!inner (
          id,
          is_active,
          courses!inner (
            id,
            slug,
            title,
            status,
            course_kind
          )
        )
      `)
      .eq("is_active", true)
      .eq("is_published", true)
      .eq("is_ai_recommendable", true)
      .eq("course_modules.is_active", true)
      .eq("course_modules.courses.status", "published")
      .limit(150);

    if (error || !rawLessons || rawLessons.length === 0) {
      if (error) {
        console.error(
          "[Stampy] lesson recommendation query failed",
          error.message.substring(0, 200)
        );
      }
      return [];
    }

    const lessonIds = rawLessons
      .map((lesson) => (typeof lesson.id === "string" ? lesson.id : null))
      .filter((id): id is string => Boolean(id));
    const chunksByLesson = new Map<string, string>();

    if (lessonIds.length > 0) {
      const { data: chunks, error: chunksError } = await supabase
        .from("stampy_knowledge_chunks")
        .select("lesson_id, source_type, content")
        .in("lesson_id", lessonIds)
        .eq("source_type", "lesson_transcript")
        .eq("is_active", true);

      if (chunksError) {
        console.error(
          "[Stampy] lesson recommendation chunks unavailable",
          chunksError.message.substring(0, 200)
        );
      } else {
        for (const chunk of chunks ?? []) {
          if (typeof chunk.lesson_id !== "string") continue;
          const previous = chunksByLesson.get(chunk.lesson_id) ?? "";
          const content = typeof chunk.content === "string" ? chunk.content : "";
          chunksByLesson.set(chunk.lesson_id, `${previous} ${content}`.trim());
        }
      }
    }

    const candidates = rawLessons
      .map((lesson) => mapLessonCandidate(lesson as UnknownRecord, chunksByLesson))
      .filter((candidate): candidate is StampyLessonCandidate => Boolean(candidate));

    return rankStampyLessonRecommendations({ candidates, query, limit });
  } catch (error) {
    console.error(
      "[Stampy] lesson recommendation failed",
      String(error).substring(0, 200)
    );
    return [];
  }
}

const RECOMMENDATION_INTENTS = new Set<StampyKnowledgeIntentType>([
  "technical_troubleshooting",
  "slicer_help",
  "material_help",
  "printer_calibration",
  "business_help",
  "course_recommendation",
  "general_3d_question",
]);

export function buildStampyLessonRecommendationText({
  recommendations,
  intent,
}: {
  recommendations: StampyLessonRecommendation[];
  intent: StampyKnowledgeIntent | null;
}): string {
  if (!intent || !RECOMMENDATION_INTENTS.has(intent.type)) return "";

  if (recommendations.length === 0) {
    return "No encontré una clase específica que coincida con esta consulta.";
  }

  if (recommendations.length === 1) {
    const recommendation = recommendations[0];
    return `Te recomiendo ver: ${recommendation.title} dentro de ${recommendation.courseTitle}.`;
  }

  return `También te pueden servir:\n${recommendations
    .slice(0, 2)
    .map(
      (recommendation) =>
        `- ${recommendation.title} dentro de ${recommendation.courseTitle}`
    )
    .join("\n")}`;
}
