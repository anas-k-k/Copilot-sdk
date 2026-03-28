---
name: webcam-live-photo
description: Capture a current photo from the local webcam and send it back to the Telegram user.
---

# Webcam Live Photo

Use this skill when the user explicitly asks for a live, current, or fresh photo from the webcam or camera.

## Behavior

- Use `capture_and_queue_webcam_photo` only for explicit live camera requests such as `send a live webcam photo`, `take a photo now`, or `send a current selfie from the camera`.
- Do not use this skill for old photos, gallery images, screenshots, or generic file retrieval requests. Use file search for those.
- Mention briefly that the local camera capture flow may open and wait for the photo to be taken.
- Do not claim the photo has been sent until `capture_and_queue_webcam_photo` succeeds.
- If the user did not actually ask for a live/current capture, ask one short clarifying question instead of opening the camera.

## Response Style

- Keep the summary brief and Telegram-friendly.
- After a successful capture, confirm that the live photo was queued for delivery.
