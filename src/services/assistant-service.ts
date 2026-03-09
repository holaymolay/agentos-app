import { createId } from "../domain/ids.js";
import { classifyLane } from "../domain/lane.js";
import type { AgentOsKernel } from "../domain/kernel.js";
import type { ConversationMessage, HealthcheckMissionInput } from "../shared/types.js";
import { isoNow } from "../shared/time.js";
import { DevChatProvider } from "./dev-chat-provider.js";

export interface AssistantTurnResult {
  lane: "chat" | "mission";
  reply: string;
  missionId: string | null;
}

export class AssistantService {
  constructor(private readonly kernel: AgentOsKernel, private readonly chatProvider: DevChatProvider = new DevChatProvider()) {}

  async submitUserTurn(params: {
    content: string;
    requestedBy: string;
    interfaceChannel: string;
    missionInput?: HealthcheckMissionInput;
    nowIso?: string;
  }): Promise<AssistantTurnResult> {
    const nowIso = params.nowIso ?? isoNow();
    const userMessage: ConversationMessage = {
      messageId: createId("msg"),
      role: "user",
      content: params.content,
      lane: "chat",
      missionId: null,
      createdAt: nowIso,
    };
    await this.kernel.saveConversationMessage(userMessage);

    const laneDecision = classifyLane(params.content);
    if (laneDecision.lane === "chat") {
      const recentMessages = await this.kernel.getRecentConversationMessages(8);
      const preferences = await this.kernel.listUserPreferences();
      const reply = this.chatProvider.respond(params.content, recentMessages, preferences);
      await this.kernel.saveConversationMessage({
        messageId: createId("msg"),
        role: "assistant",
        content: reply,
        lane: "chat",
        missionId: null,
        createdAt: isoNow(),
      });
      return { lane: "chat", reply, missionId: null };
    }

    const created = await this.kernel.createMissionFromTurn({
      content: params.content,
      requestedBy: params.requestedBy,
      interfaceChannel: params.interfaceChannel,
      input: params.missionInput,
      nowIso,
    });
    await this.kernel.projectCommittedEvents();
    const reply = `Escalated to mission lane. Created mission ${created.mission.missionId} for skill.healthcheck@1.0.0.`;
    await this.kernel.saveConversationMessage({
      messageId: createId("msg"),
      role: "assistant",
      content: reply,
      lane: "mission",
      missionId: created.mission.missionId,
      createdAt: isoNow(),
    });
    return { lane: "mission", reply, missionId: created.mission.missionId };
  }
}
