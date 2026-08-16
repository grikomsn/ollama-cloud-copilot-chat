import type { MessageMetrics, OllamaMessage, OllamaTool } from "./messages";

export function ollamaPromptMetrics(
  messages: readonly OllamaMessage[],
  tools: readonly OllamaTool[],
): MessageMetrics {
  const messageMetrics = messages.reduce<MessageMetrics>((total, message) => ({
    textChars: total.textChars + serializedMessageChars(message),
    imageCount: total.imageCount + (message.images?.length ?? 0),
  }), { textChars: 0, imageCount: 0 });
  return {
    textChars: messageMetrics.textChars + (tools.length ? JSON.stringify(tools).length : 0),
    imageCount: messageMetrics.imageCount,
  };
}

function serializedMessageChars(message: OllamaMessage): number {
  const withoutImageBytes = message.images
    ? { ...message, images: message.images.map(() => "") }
    : message;
  return JSON.stringify(withoutImageBytes).length;
}
