---
name: homemate-switch-control
description: List available HomeMate smart switches and turn one switch or all switches on or off.
---

# HomeMate Switch Control

Use this skill when the user wants to inspect or control HomeMate smart switches.

## Behavior

- Use `homemate_connection_status` if HomeMate availability is uncertain.
- Use `homemate_list_switches` before acting when the user has not identified a single switch clearly.
- Present switches compactly with switch id, switch name, state, and online/offline status when available.
- Use `homemate_get_switch` when the user asks for the status of a single switch.
- Use `homemate_set_switch_state` only after you have a clear switch id or an exact switch name.
- If the request is to turn all switches on or off, use `queue_homemate_bulk_switch_state` instead of executing directly.
- Never claim a switch changed state unless the relevant HomeMate tool succeeded.
- If more than one switch could match the user request, ask the user to choose one exact switch.

## Response Style

- Keep the summary brief and Telegram-friendly.
- Prefer short numbered lists for switch candidates.
- Mention if a bulk action still needs a YES confirmation.
