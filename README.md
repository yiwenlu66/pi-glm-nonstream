# pi-glm-nonstream

Non-streaming provider for GLM-5.2 (or any model) on [Pi](https://pi.dev).

Adds a `"nonstream": true` compat flag to `models.json`. When the extension loads, it reads your model registry and creates a non-streaming variant that uses `stream: false` requests. No env vars, no hard-coded provider names, no separate config.

## Install

```bash
git clone https://github.com/yiwenlu66/pi-glm-nonstream ~/.pi/agent/extensions/glm-nonstream
```

Or:

```bash
pi install yiwenlu66/pi-glm-nonstream
```

## Usage

Add `"nonstream": true` to any model's `compat` in `models.json`:

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

Then select the non-streaming variant:

```bash
pi --model occ-glm-nonstream/glm-5.2
```

The extension auto-discovers any provider whose models have `compat.nonstream: true` and registers a `<provider>-nonstream` shadow with the same config. The original streaming provider is unaffected.

## Why

Some proxies emit broken streaming tool-call deltas (argument chunks arrive at new indices without ID carry-over). Non-streaming responses are always correctly structured. The original issue was with GLM-5.2 through micuapi.ai.

## How it works

1. Reads your `~/.pi/agent/models.json` at load time
2. Finds providers whose models have `"nonstream": true` in `compat`
3. Registers a shadow `<provider>-nonstream` with a custom `streamSimple`
4. The `streamSimple` sends `stream: false` requests and converts the single-shot response to Pi's event stream

## License

MIT
