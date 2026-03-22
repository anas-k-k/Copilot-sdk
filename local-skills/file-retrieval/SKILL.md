---
name: file-retrieval
description: Search local files by loose text patterns and send a selected file back to the Telegram user.
---

# File Retrieval

Use this skill when the user asks for a local file from their machine, such as identity documents, resumes, invoices, screenshots, or reports.

## Behavior

- Interpret the user's request semantically. Queries like `my adhar card image or doc` may match file names, folder paths, or supported document text.
- Use `search_local_files` first.
- Present the best matches compactly with file name, path, match reason, and size.
- If multiple matches are returned, ask the user to choose one specific file.
- Only call `queue_telegram_file_send` after the user clearly selects a single file.
- Do not claim a file has been sent until `queue_telegram_file_send` succeeds.

## Response Style

- Keep the summary brief and Telegram-friendly.
- Prefer short numbered lists for candidate files.
- Mention whether a match came from the filename, path, or file content when that helps the user decide.
