import { STAMPY_APP_KNOWLEDGE, StampyKnowledgeItem } from "./app-knowledge";

export function findRelevantKnowledge(message: string): StampyKnowledgeItem[] {
  const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const q = normalize(message);
  const stopwords = ["de", "la", "el", "que", "para", "con", "una", "uno", "como", "hacer", "usar", "ver", "los", "las", "un", "del", "al", "y", "o", "en", "por"];
  
  const scoredItems = STAMPY_APP_KNOWLEDGE.map(item => {
    let score = 0;
    
    // Keyword match
    item.keywords.forEach(kw => {
      const normalizedKw = normalize(kw);
      if (normalizedKw && q.includes(normalizedKw)) {
        score += 5;
      }
    });
    
    // Title match
    const titleWords = normalize(item.title).split(/\s+/).filter(w => !stopwords.includes(w));
    titleWords.forEach(word => {
      if (word.length >= 4 && q.includes(word)) {
        score += 3;
      }
    });
    
    // Short Description match (exact phrase)
    if (item.shortDescription && q.includes(normalize(item.shortDescription))) {
      score += 2;
    }
    
    // When To Recommend match (exact phrase)
    item.whenToRecommend.forEach(reason => {
      if (reason && q.includes(normalize(reason))) {
        score += 2;
      }
    });

    return { item, score };
  });

  const relevantItems = scoredItems
    .filter(x => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (b.item.priority || 0) - (a.item.priority || 0);
    })
    .map(x => x.item);

  // Avoid duplicates (by id) and take top 3-5 (we take up to 5)
  const uniqueItems: StampyKnowledgeItem[] = [];
  const seenIds = new Set<string>();

  for (const item of relevantItems) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      uniqueItems.push(item);
    }
    if (uniqueItems.length >= 5) {
      break;
    }
  }

  return uniqueItems;
}
