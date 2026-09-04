export type StampyReplyHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type StampyReplyIsolationResult = {
  content: string;
  removedPrefixes: number;
};

function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asksToRepeatPreviousReply(message: string): boolean {
  const normalized = normalizeIntentText(message);
  return /\b(repeti|repite|recordame|cita|copia|mostrame de nuevo|decime de nuevo)\b/.test(
    normalized,
  );
}

function startsWithCompleteReply(value: string, previousReply: string): boolean {
  if (!value.startsWith(previousReply) || value.length <= previousReply.length) {
    return false;
  }

  return /\s/.test(value.charAt(previousReply.length));
}

export function isolateCurrentStampyReply({
  answer,
  history,
  userMessage,
}: {
  answer: string;
  history: StampyReplyHistoryMessage[];
  userMessage: string;
}): StampyReplyIsolationResult {
  let content = answer.trim();
  if (!content || asksToRepeatPreviousReply(userMessage)) {
    return { content, removedPrefixes: 0 };
  }

  const previousAssistantReplies = history
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.trim())
    .filter((previousReply) => previousReply.length >= 8)
    .reverse();

  let removedPrefixes = 0;
  let removedInPass = true;

  while (removedInPass && content) {
    removedInPass = false;
    for (const previousReply of previousAssistantReplies) {
      if (!startsWithCompleteReply(content, previousReply)) continue;

      const remainder = content.slice(previousReply.length).trimStart();
      if (!remainder) continue;

      content = remainder;
      removedPrefixes += 1;
      removedInPass = true;
      break;
    }
  }

  return { content, removedPrefixes };
}
