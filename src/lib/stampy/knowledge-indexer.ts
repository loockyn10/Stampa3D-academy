import { SupabaseClient } from "@supabase/supabase-js";
import { createEmbedding } from "./embeddings";
import { StampyKnowledgeChunk } from "./types";

export async function buildKnowledgeChunksFromSources(supabase: SupabaseClient): Promise<Omit<StampyKnowledgeChunk, "id" | "last_indexed_at" | "created_at" | "updated_at">[]> {
  const chunks: Omit<StampyKnowledgeChunk, "id" | "last_indexed_at" | "created_at" | "updated_at">[] = [];

  // 1. Contextos Stampy
  const { data: contexts } = await supabase
    .from("stampy_page_contexts")
    .select("*")
    .eq("is_active", true);

  if (contexts) {
    for (const ctx of contexts) {
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

  // 2. Cursos / Talleres Publicados
  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, description, status, course_kind, level, category")
    .eq("status", "published");

  if (courses) {
    for (const c of courses) {
      const sourceType = c.course_kind === "course" ? "course" : "workshop";
      chunks.push({
        source_type: sourceType,
        source_id: c.id,
        source_key: null,
        title: c.title,
        content: `Título: ${c.title}\nTipo: ${c.course_kind}\nNivel: ${c.level || 'General'}\nDescripción:\n${c.description || 'Sin descripción.'}`,
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

  // 3. Módulos Activos
  if (courses && courses.length > 0) {
    const publishedCourseIds = courses.map(c => c.id);
    const { data: modules } = await supabase
      .from("course_modules")
      .select("id, title, description, course_id, is_active, sort_order")
      .in("course_id", publishedCourseIds)
      .eq("is_active", true);

    if (modules) {
      for (const m of modules) {
        const parentCourse = courses.find(c => c.id === m.course_id);
        if (!parentCourse) continue;

        chunks.push({
          source_type: "module",
          source_id: m.id,
          source_key: null,
          title: m.title,
          content: `Curso: ${parentCourse.title}\nMódulo: ${m.title}\nDescripción:\n${m.description || 'Sin descripción.'}`,
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

    // 4. Clases Activas
    // Only grab classes where modules are active too
    if (modules && modules.length > 0) {
      const activeModuleIds = modules.map(m => m.id);
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, title, description, ai_summary, ai_topics, ai_problems, ai_level, ai_related_tool, is_ai_recommendable, module_id, is_active")
        .in("module_id", activeModuleIds)
        .eq("is_active", true);

      if (lessons) {
        for (const l of lessons) {
          if (l.is_ai_recommendable === false) continue; // skip if explicitly false

          const parentModule = modules.find(m => m.id === l.module_id);
          if (!parentModule) continue;
          
          const parentCourse = courses.find(c => c.id === parentModule.course_id);
          if (!parentCourse) continue;

          let content = `Curso: ${parentCourse.title}\nMódulo: ${parentModule.title}\nClase: ${l.title}\n`;
          if (l.ai_summary) content += `Resumen:\n${l.ai_summary}\n`;
          if (l.ai_topics && l.ai_topics.length > 0) content += `Temas: ${l.ai_topics.join(', ')}\n`;
          if (l.ai_problems && l.ai_problems.length > 0) content += `Problemas que resuelve: ${l.ai_problems.join(', ')}\n`;
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

      // 5. Transcripciones Ready
      if (lessons && lessons.length > 0) {
        const activeLessonIds = lessons.map(l => l.id);
        const { data: transcripts } = await supabase
          .from("lesson_transcripts")
          .select("lesson_id, transcript_text, status")
          .in("lesson_id", activeLessonIds)
          .eq("status", "ready");

        if (transcripts) {
          for (const t of transcripts) {
            if (!t.transcript_text) continue;
            
            const parentLesson = lessons.find(l => l.id === t.lesson_id);
            if (!parentLesson) continue;

            const parentModule = modules.find(m => m.id === parentLesson.module_id);
            if (!parentModule) continue;
            
            const parentCourse = courses.find(c => c.id === parentModule.course_id);
            if (!parentCourse) continue;

            // Chunk transcript if too large (simple chunking for now)
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
    }
  }

  return chunks;
}

export async function indexStampyKnowledge(supabase: SupabaseClient) {
  const startTime = Date.now();
  let chunksCreated = 0;
  let chunksUpdated = 0;
  let errors = 0;

  try {
    const chunks = await buildKnowledgeChunksFromSources(supabase);
    
    for (const chunk of chunks) {
      try {
        const embedding = await createEmbedding(chunk.content);
        
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

        const { data: existing } = await query.single();

        const payload = {
          ...chunk,
          embedding,
          last_indexed_at: new Date().toISOString(),
        };

        if (existing) {
          const { error: updateErr } = await supabase
            .from("stampy_knowledge_chunks")
            .update(payload)
            .eq("id", existing.id);
            
          if (updateErr) throw updateErr;
          chunksUpdated++;
        } else {
          const { error: insertErr } = await supabase
            .from("stampy_knowledge_chunks")
            .insert([payload]);
            
          if (insertErr) throw insertErr;
          chunksCreated++;
        }
      } catch (err) {
        console.error(`[Stampy Knowledge] Error indexing chunk ${chunk.title}:`, err);
        errors++;
      }
    }

  } catch (err) {
    console.error("[Stampy Knowledge] Fatal error in indexing:", err);
    throw err;
  }

  const durationMs = Date.now() - startTime;
  return { chunksCreated, chunksUpdated, errors, durationMs };
}
