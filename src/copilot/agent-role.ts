export const copilotAgentRoles = ["primary", "skill-installer"] as const;

export type CopilotAgentRole = (typeof copilotAgentRoles)[number];

export function getCopilotSessionKey(
  userId: string,
  role: CopilotAgentRole,
): string {
  return `${userId}:${role}`;
}
