# pi-glm-nonstream

Non-streaming model-registry opt-in for [Pi](https://pi.dev).

Add `"nonstream": true` to a model's `compat` in `models.json`. The extension re-registers that provider **in place** so the original model reference (for example `occ-glm/glm-5.2`) uses `stream: false` requests while keeping the same provider name, model ID, base URL, API key, context window, and thinking settings.

## Install

```bash
git clone https://github.com/yiwenlu66/pi-glm-nonstream ~/.pi/agent/extensions/glm-nonstream
```

Or:

```bash
pi install yiwenlu66/pi-glm-nonstream
```

## Usage

Mark the model in `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "occ-glm": {
      "baseUrl": "https://www.micuapi.ai/v1",
      "apiKey": "$OCC_API_KEY",
      "api": "openai-completions",
      "models": [
        {
          "id": "glm-5.2",
          "reasoning": true,
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "compat": {
            "thinkingFormat": "zai",
            "nonstream": true
          }
        }
      ]
    }
  }
}
```

Then use the original model reference:

```bash
pi --model occ-glm/glm-5.2
```

No shadow provider needs to be selected.

## Why

Some OpenAI-compatible proxies emit broken streaming tool-call deltas for GLM-5.2: argument chunks arrive at new indices without ID/name carry-over, so Pi's normal streaming parser treats one tool call as several malformed tool calls. Non-streaming responses return the complete `tool_calls` object and are structurally correct.

## Mechanism

At load time, the extension:

1. Reads `~/.pi/agent/models.json`
2. Finds providers with models marked `compat.nonstream: true`
3. Re-registers the same provider name with the same models
4. Routes only flagged models to a custom `streamSimple` implementation
5. Sends `stream: false` to `/chat/completions`
6. Converts the single-shot response to Pi's `AssistantMessageEventStream`

Unflagged models in the same provider keep their original API.

## Verified

Verified with `occ-glm/glm-5.2`: a `bash` tool call (`ls -la`) executed correctly, returned output, and the model summarized it without malformed tool fragments.

## License

MIT
