import { STAMPY_APP_KNOWLEDGE, StampyKnowledgeItem } from "./app-knowledge";

export function findRelevantKnowledge(message: string): StampyKnowledgeItem[] {
  const q = message.toLowerCase();
  
  const scoredItems = STAMPY_APP_KNOWLEDGE.map(item => {
    let score = 0;
    
    // Keyword match
    item.keywords.forEach(kw => {
      if (q.includes(kw.toLowerCase())) {
        score += 5;
      }
    });
    
    // Title match
    const titleWords = item.title.toLowerCase().split(/\s+/);
    titleWords.forEach(word => {
      if (word.length > 3 && q.includes(word)) {
        score += 3;
      }
    });
    
    // Short Description match
    if (q.includes(item.shortDescription.toLowerCase())) {
      score += 2;
    }
    
    // When To Recommend match
    item.whenToRecommend.forEach(reason => {
      if (q.includes(reason.toLowerCase())) {
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
