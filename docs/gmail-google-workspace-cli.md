# Gmail Via Google Workspace CLI

This app can expose Gmail to the Copilot session and Telegram commands by shelling out to `gws`, the Google Workspace CLI from https://github.com/googleworkspace/cli.

## Install and authenticate `gws`

Install the CLI into this workspace or globally:

```bash
npm install @googleworkspace/cli
```

Then authenticate it. The fastest path is:

```bash
gws auth setup
gws auth login -s gmail
```

If you do not have `gcloud`, follow the repo's manual OAuth flow, save `client_secret.json` under `~/.config/gws`, and run:

```bash
gws auth login -s gmail
```

You can verify auth with:

```bash
gws auth status
```

## Required environment variables

- `GOOGLE_WORKSPACE_CLI_COMMAND`: the CLI executable name or full path
- `GOOGLE_WORKSPACE_CLI_ARGS`: optional base args added to every CLI invocation
- `GMAIL_STATUS_ARGS`: optional command template used by `/gmailstatus`
- `GMAIL_LIST_ARGS`: command template used by `gmail_list_messages` and `/gmaillist`
- `GMAIL_READ_ARGS`: command template used by `gmail_read_message` and `/gmailread`
- `GMAIL_SEND_ARGS`: command template used by `gmail_send_message`
- `GMAIL_COMMAND_TIMEOUT_MS`: optional timeout for Gmail CLI calls, default `30000`

## Template placeholders

The Gmail command templates support these placeholders:

- `{query}`
- `{maxResults}`
- `{messageId}`
- `{to}`
- `{cc}`
- `{bcc}`
- `{subject}`
- `{body}`

## Example

These templates match the current `gws` helper commands:

```env
GOOGLE_WORKSPACE_CLI_COMMAND=gws
GOOGLE_WORKSPACE_CLI_ARGS=
GMAIL_STATUS_ARGS=auth status
GMAIL_LIST_ARGS=gmail +triage --format=json --query={query} --max={maxResults}
GMAIL_READ_ARGS=gmail +read --id={messageId} --format=json
GMAIL_SEND_ARGS=gmail +send --to={to} --cc={cc} --bcc={bcc} --subject="{subject}" --body="{body}"
```

Notes:

- Empty placeholder assignments such as `--cc=` and `--bcc=` are stripped before execution.
- `/gmaillist` defaults to `gws gmail +triage` behavior when no query is supplied.
- `gws` returns structured JSON for auth status and the Gmail helper commands used here.
- On Windows, prefer `GOOGLE_WORKSPACE_CLI_COMMAND=gws` or the package entrypoint, not a manually hardcoded `.cmd` shim path.

## Telegram commands

- `/gmailstatus`
- `/gmaillist [query]`
- `/gmailread <messageId>`

Natural-language Gmail requests can also use the Copilot tools once the CLI is configured.
