---
name: webcam-live-video
description: Record a live video from the local webcam and send it back to the Telegram user when they say stop.
---

# Webcam Live Video Recording

Use this skill when the user explicitly asks to start a live video recording from the webcam or camera.

## Behavior

- Use `start_webcam_video_recording` only for explicit live video requests such as `record a video from my webcam`, `start live video feed`, or `start recording from my camera`.
- Do not use this skill for photos, screenshots, old files, or generic file retrieval. Use the webcam photo skill or file search for those.
- After starting the recording, inform the user that the video is being recorded and they can say "stop" at any time to end the recording and receive the video.
- The outer bot will automatically detect when the user says stop, end, finish, or done and will stop the recording and send the video. You do not need to actively monitor for the stop command.
- If the user explicitly asks to stop a recording through Copilot rather than directly, use `stop_webcam_video_recording` to stop it and queue the video for delivery.
- Only one recording can be active per user at a time.
- Do not claim the video has been sent until the recording is actually stopped and the file exists.

## Response Style

- Keep the summary brief and Telegram-friendly.
- After starting, confirm that recording has begun and mention how to stop it.
- After stopping, confirm the video was queued for delivery and mention the approximate duration.
