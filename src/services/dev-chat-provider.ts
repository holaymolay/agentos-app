import type { ConversationMessage, UserPreference } from "../shared/types.js";

export class DevChatProvider {
  respond(input: string, recentMessages: ConversationMessage[], preferences: UserPreference[]): string {
    const trimmed = input.trim();
    const preferenceHint = preferences.length > 0 ? ` Preferences loaded: ${preferences.map((item) => `${item.preferenceKey}=${item.value}`).join(", ")}.` : "";
    const contextHint = recentMessages.length > 0 ? ` Recent context messages: ${recentMessages.length}.` : "";
    return `Chat lane response: ${trimmed}.${preferenceHint}${contextHint}`.trim();
  }
}
