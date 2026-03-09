import type { LaneDecision } from "../shared/types.js";

const missionPatterns = [
  /\bhealthcheck\b/i,
  /\b(run|check)\s+(a\s+)?health/i,
  /\bdiagnostic(s)?\b/i,
  /\bruntime posture\b/i,
  /\bremediation\b/i,
  /\bsystem check\b/i,
];

export function classifyLane(content: string): LaneDecision {
  const normalized = content.trim();
  const matched = missionPatterns.find((pattern) => pattern.test(normalized));
  if (matched) {
    return {
      lane: "mission",
      reason: `Matched governed mission trigger: ${matched}`,
      missionRequired: true,
      matchedSkillVersionId: "skill.healthcheck@1.0.0",
    };
  }

  return {
    lane: "chat",
    reason: "No governed trigger matched; request stays conversational.",
    missionRequired: false,
    matchedSkillVersionId: null,
  };
}
