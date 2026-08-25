import { SupabaseClient } from "@supabase/supabase-js";
import { createEmbedding } from "./embeddings";
import { StampyKnowledgeChunk } from "./types";

export interface BuildChunksResult {
  chunks: Omit<StampyKnowledgeChunk, "id" | "last_indexed_at" | "created_at" | "updated_at">[];
  stats: {
    sourcesFound: {
      stampy_context: number;
      course: number;
      workshop: number;
      module: number;
      lesson: number;
      lesson_transcript: number;
    };
    skippedEmpty: {
      coursesSkippedEmpty: number;
      workshopsSkippedEmpty: number;
      modulesSkippedEmpty: number;
      lessonsSkippedEmpty: number;
    };
  };
}

export async function buildKnowledgeChunksFromSources(supabase: SupabaseClient): Promise<BuildChunksResult> {
  const chunks: Omit<StampyKnowledgeChunk, "id" | "last_indexed_at" | "created_at" | "updated_at">[] = [];

  const sourcesFound = { stampy_context: 0, course: 0, workshop: 0, module: 0, lesson: 0, lesson_transcript: 0 };
  const skippedEmpty = { coursesSkippedEmpty: 0, workshopsSkippedEmpty: 0, modulesSkippedEmpty: 0, lessonsSkippedEmpty: 0 };

  // 1. Contextos Stampy
  try {
    const { data: contexts, error: ctxErr } = await supabase
      .from("stampy_page_contexts")
      .select("*");

    if (ctxErr) {
      console.error("[Stampy Indexer] Error fetching stampy_page_contexts", ctxErr);
    } else if (contexts) {
      sourcesFound.stampy_context = contexts.length;
      for (const ctx of contexts) {
        if (ctx.is_active === false) continue;
        if (!ctx.context || ctx.context.trim().length < 10) {
          // skippedEmpty not strictly required for contexts as they shouldn't be empty, but just in case
          continue;
        }

        chunks.push({
          source_type: "stampy_context",
          source_id: ctx.id,
          source_key: ctx.route_pattern,
          title: ctx.title,
          content: ctx.context,
          route: ctx.route_pattern,
          category: null,
          tags: [...(ctx.suggested_questions || []), ...(ctx.related_tools || [])],
          course_id: null,
          module_id: null,
          lesson_id: null,
          metadata: { match_type: ctx.match_type, priority: ctx.priority },
          is_active: true,
        });
      }
    }
  } catch (e) {
    console.error("[Stampy Indexer] Failed to process stampy_page_contexts", e);
  }

  // 2. Cursos / Talleres Publicados
  let courses: any[] = [];
  try {
    const { data: rawCourses, error: courseErr } = await supabase
      .from("courses")
      .select("*")
      .eq("status", "published");

    if (courseErr) {
      console.error("[Stampy Indexer] Error fetching courses", courseErr);
    } else if (rawCourses) {
      courses = rawCourses;
      for (const c of courses) {
        const isCourse = c.course_kind === "course";
        if (isCourse) sourcesFound.course++;
        else sourcesFound.workshop++;

        // Require a description to be considered "real content"
        if (!c.description || c.description.trim().length < 20) {
          if (isCourse) skippedEmpty.coursesSkippedEmpty++;
          else skippedEmpty.workshopsSkippedEmpty++;
          continue;
        }

        const sourceType = isCourse ? "course" : "workshop";
        chunks.push({
          source_type: sourceType,
          source_id: c.id,
          source_key: null,
          title: c.title,
          content: `Título: ${c.title}\nTipo: ${c.course_kind}\nNivel: ${c.level || 'General'}\nDescripción:\n${c.description}`,
          route: `/cursos/${c.id}`,
          category: c.category,
          tags: c.category ? [c.category] : [],
          course_id: c.id,
          module_id: null,
          lesson_id: null,
          metadata: { courseKind: c.course_kind, level: c.level },
          is_active: true,
        });
      }
    }
  } catch (e) {
    console.error("[Stampy Indexer] Failed to process courses", e);
  }

  // 3. Módulos Activos
  let modules: any[] = [];
  try {
    if (courses.length > 0) {
      const publishedCourseIds = courses.map(c => c.id);
      const { data: rawModules, error: modErr } = await supabase
        .from("course_modules")
        .select("*")
        .in("course_id", publishedCourseIds)
        .eq("is_active", true);

      if (modErr) {
        console.error("[Stampy Indexer] Error fetching course_modules", modErr);
      } else if (rawModules) {
        modules = rawModules;
        sourcesFound.module = modules.length;
        
        for (const m of modules) {
          const parentCourse = courses.find(c => c.id === m.course_id);
          if (!parentCourse) continue;

          // Require a description to index a module directly
          if (!m.description || m.description.trim().length < 15) {
            skippedEmpty.modulesSkippedEmpty++;
            continue;
          }

          chunks.push({
            source_type: "module",
            source_id: m.id,
            source_key: null,
            title: m.title,
            content: `Curso: ${parentCourse.title}\nMódulo: ${m.title}\nDescripción:\n${m.description}`,
            route: `/cursos/${parentCourse.id}`,
            category: parentCourse.category,
            tags: [],
            course_id: m.course_id,
            module_id: m.id,
            lesson_id: null,
            metadata: { courseTitle: parentCourse.title },
            is_active: true,
          });
        }
      }
    }
  } catch (e) {
    console.error("[Stampy Indexer] Failed to process course_modules", e);
  }

  // 4. Clases Activas
  let lessons: any[] = [];
  try {
    if (modules.length > 0) {
      const activeModuleIds = modules.map(m => m.id);
      const { data: rawLessons, error: lessErr } = await supabase
        .from("lessons")
        .select("*")
        .in("module_id", activeModuleIds)
        .eq("is_active", true);

      if (lessErr) {
        console.error("[Stampy Indexer] Error fetching lessons", lessErr);
      } else if (rawLessons) {
        lessons = rawLessons;
        sourcesFound.lesson = lessons.length;

        // Fetch transcripts to check if lesson has transcript
        const { data: transcripts } = await supabase
          .from("lesson_transcripts")
          .select("lesson_id, status")
          .in("lesson_id", lessons.map(l => l.id))
          .eq("status", "ready");

        for (const l of lessons) {
          if (l.is_ai_recommendable === false) continue;

          const hasDesc = l.description && l.description.trim().length > 10;
          const hasSummary = l.ai_summary && l.ai_summary.trim().length > 10;
          const hasTopics = l.ai_topics && l.ai_topics.length > 0;
          const hasProblems = l.ai_problems && l.ai_problems.length > 0;
          const hasTranscript = transcripts && transcripts.some(t => t.lesson_id === l.id);

          // Si no tiene nada de contenido útil, se omite
          if (!hasDesc && !hasSummary && !hasTopics && !hasProblems && !hasTranscript) {
            skippedEmpty.lessonsSkippedEmpty++;
            continue; // Not enough content to index
          }

          const parentModule = modules.find(m => m.id === l.module_id);
          if (!parentModule) continue;
          
          const parentCourse = courses.find(c => c.id === parentModule.course_id);
          if (!parentCourse) continue;

          let content = `Curso: ${parentCourse.title}\nMódulo: ${parentModule.title}\nClase: ${l.title}\n`;
          if (hasDesc) content += `Descripción:\n${l.description}\n`;
          if (hasSummary) content += `Resumen:\n${l.ai_summary}\n`;
          if (hasTopics) content += `Temas: ${l.ai_topics.join(', ')}\n`;
          if (hasProblems) content += `Problemas que resuelve: ${l.ai_problems.join(', ')}\n`;
          if (l.ai_related_tool) content += `Herramienta recomendada: ${l.ai_related_tool}\n`;

          const tags = [...(l.ai_topics || []), ...(l.ai_problems || [])];
          if (l.ai_related_tool) tags.push(l.ai_related_tool);

          chunks.push({
            source_type: "lesson",
            source_id: l.id,
            source_key: null,
            title: l.title,
            content: content,
            route: `/cursos/${parentCourse.id}`, // Default to course until exact lesson link
            category: parentCourse.category,
            tags: tags,
            course_id: parentCourse.id,
            module_id: parentModule.id,
            lesson_id: l.id,
            metadata: { 
              courseTitle: parentCourse.title, 
              moduleTitle: parentModule.title, 
              aiLevel: l.ai_level, 
              relatedTool: l.ai_related_tool 
            },
            is_active: true,
          });
        }
      }
    }
  } catch (e) {
    console.error("[Stampy Indexer] Failed to process lessons", e);
  }

  // 5. Transcripciones Ready
  try {
    if (lessons.length > 0) {
      const activeLessonIds = lessons.map(l => l.id);
      const { data: transcripts, error: trErr } = await supabase
        .from("lesson_transcripts")
        .select("*")
        .in("lesson_id", activeLessonIds)
        .eq("status", "ready");

      if (trErr) {
        console.error("[Stampy Indexer] Error fetching lesson_transcripts", trErr);
      } else if (transcripts) {
        for (const t of transcripts) {
          if (!t.transcript_text) continue;
          sourcesFound.lesson_transcript++;
          
          const parentLesson = lessons.find(l => l.id === t.lesson_id);
          if (!parentLesson) continue;

          const parentModule = modules.find(m => m.id === parentLesson.module_id);
          if (!parentModule) continue;
          
          const parentCourse = courses.find(c => c.id === parentModule.course_id);
          if (!parentCourse) continue;

          const maxLen = 1500;
          const words = t.transcript_text.split(/\s+/);
          let currentChunk = "";
          let chunkIndex = 0;

          for (const word of words) {
            if (currentChunk.length + word.length > maxLen) {
              chunks.push({
                source_type: "lesson_transcript",
                source_id: parentLesson.id,
                source_key: `chunk_${chunkIndex}`,
                title: `${parentLesson.title} - Transcripción pt.${chunkIndex+1}`,
                content: `Curso: ${parentCourse.title}\nMódulo: ${parentModule.title}\nClase: ${parentLesson.title}\nTranscripción parcial:\n${currentChunk}`,
                route: `/cursos/${parentCourse.id}`,
                category: parentCourse.category,
                tags: parentLesson.ai_topics || [],
                course_id: parentCourse.id,
                module_id: parentModule.id,
                lesson_id: parentLesson.id,
                metadata: { chunkIndex },
                is_active: true,
              });
              currentChunk = word + " ";
              chunkIndex++;
            } else {
              currentChunk += word + " ";
            }
          }
          if (currentChunk.trim().length > 0) {
             chunks.push({
              source_type: "lesson_transcript",
              source_id: parentLesson.id,
              source_key: `chunk_${chunkIndex}`,
              title: `${parentLesson.title} - Transcripción pt.${chunkIndex+1}`,
              content: `Curso: ${parentCourse.title}\nMódulo: ${parentModule.title}\nClase: ${parentLesson.title}\nTranscripción parcial:\n${currentChunk}`,
              route: `/cursos/${parentCourse.id}`,
              category: parentCourse.category,
              tags: parentLesson.ai_topics || [],
              course_id: parentCourse.id,
              module_id: parentModule.id,
              lesson_id: parentLesson.id,
              metadata: { chunkIndex },
              is_active: true,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("[Stampy Indexer] Failed to process lesson_transcripts", e);
  }

  console.log("[Stampy Indexer] sources and skips", { sourcesFound, skippedEmpty });

  return { chunks, stats: { sourcesFound, skippedEmpty } };
}

export async function indexStampyKnowledge(supabase: SupabaseClient) {
  console.log("[Stampy Indexer] reindex started");
  const startTime = Date.now();
  let chunksCreated = 0;
  let chunksUpdated = 0;
  let errors = 0;
  let chunksBuilt = 0;
  let sourcesFound = {};
  let skippedEmpty = {};
  
  try {
    const buildResult = await buildKnowledgeChunksFromSources(supabase);
    const chunks = buildResult.chunks;
    sourcesFound = buildResult.stats.sourcesFound;
    skippedEmpty = buildResult.stats.skippedEmpty;
    
    chunksBuilt = chunks.length;
    let processedCount = 0;

    for (const chunk of chunks) {
      try {
        let embedding;
        try {
          embedding = await createEmbedding(chunk.content);
        } catch (embedErr) {
          console.error(`[Stampy Indexer] Embedding failed for chunk: ${chunk.title}`, embedErr);
          errors++;
          continue; // Skip inserting if embedding fails
        }
        
        let query = supabase
          .from("stampy_knowledge_chunks")
          .select("id")
          .eq("source_type", chunk.source_type);
          
        if (chunk.source_id) {
          query = query.eq("source_id", chunk.source_id);
        } else {
          query = query.is("source_id", null);
        }
        
        if (chunk.source_key) {
          query = query.eq("source_key", chunk.source_key);
        } else {
          query = query.is("source_key", null);
        }

        const { data: existing, error: selectErr } = await query.maybeSingle();

        if (selectErr) {
           console.error("[Stampy Indexer] Error looking up chunk", selectErr);
           errors++;
           continue;
        }

        const payload = {
          ...chunk,
          embedding,
          last_indexed_at: new Date().toISOString(),
        };

        if (processedCount < 3) {
           console.log("[Stampy Indexer] upserting chunk", {
             source_type: chunk.source_type,
             source_id: chunk.source_id,
             title: chunk.title,
             contentChars: chunk.content.length,
             hasEmbedding: Array.isArray(embedding),
           });
        }

        if (existing) {
          const { error: updateErr } = await supabase
            .from("stampy_knowledge_chunks")
            .update(payload)
            .eq("id", existing.id);
            
          if (updateErr) {
            console.error("[Stampy Indexer] upsert failed (update)", {
              source_type: chunk.source_type,
              source_id: chunk.source_id,
              title: chunk.title,
              error: updateErr,
            });
            throw updateErr;
          }
          chunksUpdated++;
        } else {
          const { error: insertErr } = await supabase
            .from("stampy_knowledge_chunks")
            .insert([payload]);
            
          if (insertErr) {
            console.error("[Stampy Indexer] upsert failed (insert)", {
              source_type: chunk.source_type,
              source_id: chunk.source_id,
              title: chunk.title,
              error: insertErr,
            });
            throw insertErr;
          }
          chunksCreated++;
        }
      } catch (err) {
        console.error(`[Stampy Knowledge] Error indexing chunk ${chunk.title}:`, err);
        errors++;
      }
      processedCount++;
    }

  } catch (err) {
    console.error("[Stampy Knowledge] Fatal error in indexing:", err);
    throw err;
  }

  const durationMs = Date.now() - startTime;
  
  console.log("[Stampy Indexer] reindex finished", {
    sourcesFound,
    skippedEmpty,
    chunksBuilt,
    chunksCreated,
    chunksUpdated,
    errorsCount: errors,
    durationMs,
  });

  return { sourcesFound, skippedEmpty, chunksBuilt, chunksCreated, chunksUpdated, errorsCount: errors, durationMs };
}
