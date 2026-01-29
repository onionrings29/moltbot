# Message Chunking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split long LLM responses into multiple shorter messages to avoid platform limits and improve readability.

**Architecture:** Add optional LLM-directed chunking via special markers (`[MSG]` or `<nl>`) that the backend parses to split messages before delivery. The system prompt instructs the LLM when/how to use markers, and a new chunking function in the delivery pipeline parses and respects them.

**Tech Stack:** TypeScript, existing chunking infrastructure (`src/auto-reply/chunk.ts`), system prompt builder (`src/agents/system-prompt.ts`), message handlers (`src/agents/pi-embedded-subscribe.handlers.messages.ts`)

---

## Task 1: Add configuration option for chunking mode

**Files:**
- Modify: `src/config/config.ts` (locate and extend `MoltbotConfig` type)
- Modify: `src/config/schema.ts` (add JSON schema for new config option)

**Step 1: Locate config type definition**

Search for `MoltbotConfig` interface and identify where `agents` or `defaults` configuration is defined.

**Step 2: Add chunking config to interface**

Add a new optional field to the agent defaults config:

```typescript
// In MoltbotConfig > agents > defaults
chunking?: {
  /** Enable LLM-directed chunking via special markers */
  enabled?: boolean;
  /** Markers that trigger message split (default: ["[MSG]", "<nl>"]) */
  markers?: string[];
  /** Minimum characters per chunk (default: 200) */
  minChunkSize?: number;
};
```

**Step 3: Update JSON schema**

Add corresponding JSON schema in `src/config/schema.ts` to match the new config structure.

**Step 4: Run tests**

```bash
pnpm test -- src/config
```

Expected: All existing config tests pass (new field is optional).

**Step 5: Commit**

```bash
git add src/config/config.ts src/config/schema.ts
git commit -m "config: add chunking option to agent defaults"
```

---

## Task 2: Create chunk marker parser utility

**Files:**
- Create: `src/auto-reply/chunk-markers.ts`

**Step 1: Write failing test**

Create `src/auto-reply/chunk-markers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseChunkMarkers, splitByChunkMarkers } from "./chunk-markers.js";

describe("chunk-markers", () => {
  describe("parseChunkMarkers", () => {
    it("should return empty array for undefined config", () => {
      expect(parseChunkMarkers(undefined)).toEqual([]);
    });

    it("should return default markers when enabled=true but no custom markers", () => {
      expect(parseChunkMarkers({ enabled: true })).toEqual(["[MSG]", "<nl>"]);
    });

    it("should return custom markers when provided", () => {
      expect(parseChunkMarkers({ enabled: true, markers: ["[SPLIT]", "---"] }))
        .toEqual(["[SPLIT]", "---"]);
    });

    it("should return empty array when enabled=false", () => {
      expect(parseChunkMarkers({ enabled: false })).toEqual([]);
    });
  });

  describe("splitByChunkMarkers", () => {
    it("should not split text without markers", () => {
      const result = splitByChunkMarkers("Hello world", ["[MSG]"]);
      expect(result).toEqual(["Hello world"]);
    });

    it("should split on [MSG] marker and remove it", () => {
      const result = splitByChunkMarkers("First part[MSG]Second part", ["[MSG]"]);
      expect(result).toEqual(["First part", "Second part"]);
    });

    it("should split on multiple markers", () => {
      const result = splitByChunkMarkers("One[MSG]Two<nl>Three", ["[MSG]", "<nl>"]);
      expect(result).toEqual(["One", "Two", "Three"]);
    });

    it("should handle markers at start/end", () => {
      const result = splitByChunkMarkers("[MSG]Start[MSG]End[MSG]", ["[MSG]"]);
      expect(result).toEqual(["", "Start", "End", ""]);
    });

    it("should trim whitespace around splits", () => {
      const result = splitByChunkMarkers("First  [MSG]  Second  ", ["[MSG]"]);
      expect(result).toEqual(["First", "Second"]);
    });

    it("should respect minChunkSize and merge small chunks", () => {
      const result = splitByChunkMarkers("A[MSG]B", ["[MSG]"], { minChunkSize: 5 });
      expect(result).toEqual(["AB"]);
    });

    it("should not merge chunks that exceed minChunkSize", () => {
      const result = splitByChunkMarkers("Long text here[MSG]Another long text", ["[MSG]"], { minChunkSize: 5 });
      expect(result).toEqual(["Long text here", "Another long text"]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test -- src/auto-reply/chunk-markers.test.ts
```

Expected: FAIL with "Cannot find module './chunk-markers'"

**Step 3: Implement the utility**

Create `src/auto-reply/chunk-markers.ts`:

```typescript
export type ChunkingConfig = {
  enabled?: boolean;
  markers?: string[];
  minChunkSize?: number;
};

const DEFAULT_MARKERS = ["[MSG]", "<nl>"] as const;
const DEFAULT_MIN_CHUNK_SIZE = 200;

export function parseChunkMarkers(config?: ChunkingConfig): string[] {
  if (!config?.enabled) return [];
  return config.markers && config.markers.length > 0
    ? [...config.markers]
    : [...DEFAULT_MARKERS];
}

export function splitByChunkMarkers(
  text: string,
  markers: string[],
  opts?: { minChunkSize?: number }
): string[] {
  if (!text || markers.length === 0) return [text];

  const minChunkSize = opts?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;

  // Escape markers for regex (they may contain special chars)
  const escapedMarkers = markers.map(m =>
    m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`(?:${escapedMarkers.join('|')})`, 'g');

  // Split on markers, removing them
  const parts = text.split(pattern).map(p => p.trim());

  // Filter out empty parts
  const nonEmpty = parts.filter(p => p.length > 0);

  if (nonEmpty.length === 0) return [text];
  if (nonEmpty.length === 1) return nonEmpty;

  // Merge chunks that are too small
  const merged: string[] = [];
  let current = "";

  for (const part of nonEmpty) {
    const candidate = current ? `${current}\n\n${part}` : part;

    if (current.length > 0 && candidate.length < minChunkSize) {
      // Merge with previous
      current = candidate;
    } else {
      // Emit previous if any
      if (current) merged.push(current);
      current = part;
    }
  }

  if (current) merged.push(current);

  return merged.length > 0 ? merged : [text];
}
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test -- src/auto-reply/chunk-markers.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/auto-reply/chunk-markers.ts src/auto-reply/chunk-markers.test.ts
git commit -m "feat: add chunk marker parser utility"
```

---

## Task 3: Integrate chunk marker parsing into delivery pipeline

**Files:**
- Modify: `src/infra/outbound/deliver.ts` (lines 200-400 approximately)
- Modify: `src/infra/outbound/payloads.ts` (normalization logic)

**Step 1: Write failing test**

Create test in `src/infra/outbound/deliver.test.ts` (or extend existing):

```typescript
import { describe, it, expect } from "vitest";
import { applyChunkMarkersToPayloads } from "./deliver.js";

describe("deliver - chunk markers", () => {
  it("should split payloads with [MSG] markers when chunking enabled", () => {
    const payloads = [
      { text: "First message[MSG]Second message[MSG]Third" }
    ];
    const result = applyChunkMarkersToPayloads(payloads, {
      enabled: true,
      markers: ["[MSG]"]
    });
    expect(result).toEqual([
      { text: "First message" },
      { text: "Second message" },
      { text: "Third" }
    ]);
  });

  it("should not split when chunking disabled", () => {
    const payloads = [
      { text: "First[MSG]Second" }
    ];
    const result = applyChunkMarkersToPayloads(payloads, {
      enabled: false
    });
    expect(result).toEqual([
      { text: "First[MSG]Second" }
    ]);
  });

  it("should handle payloads without markers", () => {
    const payloads = [
      { text: "Regular message" }
    ];
    const result = applyChunkMarkersToPayloads(payloads, { enabled: true });
    expect(result).toEqual([
      { text: "Regular message" }
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm test -- src/infra/outbound/deliver.test.ts
```

Expected: FAIL with "applyChunkMarkersToPayloads is not defined"

**Step 3: Implement integration in deliver.ts**

Add to `src/infra/outbound/deliver.ts`:

```typescript
import { parseChunkMarkers, splitByChunkMarkers } from "../../auto-reply/chunk-markers.js";

// ... existing imports ...

export function applyChunkMarkersToPayloads(
  payloads: ReplyPayload[],
  chunkingConfig?: ChunkingConfig
): ReplyPayload[] {
  const markers = parseChunkMarkers(chunkingConfig);
  if (markers.length === 0) return payloads;

  const result: ReplyPayload[] = [];

  for (const payload of payloads) {
    if (!payload.text) {
      result.push(payload);
      continue;
    }

    const chunks = splitByChunkMarkers(payload.text, markers, {
      minChunkSize: chunkingConfig?.minChunkSize
    });

    for (const chunk of chunks) {
      result.push({ ...payload, text: chunk });
    }
  }

  return result;
}
```

Then update `deliverOutboundPayloads` function (around line 197) to apply chunking:

```typescript
export async function deliverOutboundPayloads(params: {
  cfg: MoltbotConfig;
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  accountId?: string;
  payloads: ReplyPayload[];
  // ... rest of existing params ...
}): Promise<OutboundDeliveryResult[]> {
  const { cfg, channel, to, payloads } = params;

  // Apply chunk marker splitting BEFORE other processing
  const chunkingConfig = (cfg as any).agents?.defaults?.chunking;
  const normalizedPayloads = applyChunkMarkersToPayloads(payloads, chunkingConfig);

  // ... rest of existing function, now using normalizedPayloads ...
```

**Step 4: Run tests to verify they pass**

```bash
pnpm test -- src/infra/outbound/deliver.test.ts
```

Expected: All tests PASS

**Step 5: Run full test suite for outbound**

```bash
pnpm test -- src/infra/outbound/
```

**Step 6: Commit**

```bash
git add src/infra/outbound/deliver.ts src/infra/outbound/deliver.test.ts
git commit -m "feat: integrate chunk markers into outbound delivery"
```

---

## Task 4: Add chunking instructions to system prompt

**Files:**
- Modify: `src/agents/system-prompt.ts` (lines 180-240, messaging section)

**Step 1: Add chunking section builder function**

Add to `src/agents/system-prompt.ts` after `buildVoiceSection`:

```typescript
function buildChunkingSection(params: {
  isMinimal: boolean;
  chunkingEnabled?: boolean;
  chunkingMarkers?: string[];
}) {
  if (params.isMinimal || !params.chunkingEnabled) return [];
  const markers = params.chunkingMarkers ?? ["[MSG]", "<nl>"];
  const markerList = markers.map(m => `\`${m}\``).join(", ");
  return [
    "## Message Chunking",
    `For long responses, split your output into shorter messages using: ${markerList}`,
    `Example: "Here's the first part.${markers[0]}Here's the second part.${markers[0]}"`,
    `The markers will be removed and each part sent as a separate message.`,
    "",
  ];
}
```

**Step 2: Wire into buildAgentSystemPrompt**

Update function parameters (around line 176) to accept chunking config:

```typescript
export function buildAgentSystemPrompt(params: {
  // ... existing params ...
  /** Chunking configuration for LLM-directed message splitting */
  chunking?: {
    enabled?: boolean;
    markers?: string[];
  };
  // ... rest of params ...
}) {
```

Then update the lines array (after line 460, in the messaging section area) to include:

```typescript
  const lines = [
    "You are a personal assistant running inside Moltbot.",
    "",
    // ... existing sections ...
    ...buildVoiceSection({ isMinimal, ttsHint: params.ttsHint }),
    ...buildChunkingSection({
      isMinimal,
      chunkingEnabled: params.chunking?.enabled,
      chunkingMarkers: params.chunking?.markers,
    }),
    // ... continue with existing sections ...
  ];
```

**Step 3: Update call sites**

Find where `buildAgentSystemPrompt` is called and pass chunking config:

- `src/agents/pi-embedded-runner/system-prompt.ts` (check `buildEmbeddedSystemPrompt`)
- Any other locations that call `buildAgentSystemPrompt`

Example update in `pi-embedded-runner/system-prompt.ts`:

```typescript
export function buildEmbeddedSystemPrompt(params: {
  // ... existing params ...
  chunking?: { enabled?: boolean; markers?: string[] };
}): string {
  return buildAgentSystemPrompt({
    // ... existing spread ...
    chunking: params.chunking,
  });
}
```

**Step 4: Verify no test regressions**

```bash
pnpm test -- src/agents/
```

Expected: All agent tests pass

**Step 5: Commit**

```bash
git add src/agents/system-prompt.ts src/agents/pi-embedded-runner/system-prompt.ts
git commit -m "feat: add chunking instructions to system prompt"
```

---

## Task 5: Wire config through to system prompt builder

**Files:**
- Modify: `src/agents/pi-embedded-runner/run/attempt.ts` (lines 337-362, system prompt creation)
- Modify: `src/config/config.ts` (ensure config path is accessible)

**Step 1: Locate system prompt call site**

In `src/agents/pi-embedded-runner/run/attempt.ts`, find `buildEmbeddedSystemPrompt()` call around line 337-362.

**Step 2: Extract chunking config**

Add before the `buildEmbeddedSystemPrompt` call:

```typescript
// Extract chunking config from agent config
const chunkingConfig = (runtimeConfig as any)?.chunking;
```

**Step 3: Pass chunking to system prompt builder**

Update the `buildEmbeddedSystemPrompt` call:

```typescript
const systemPrompt = await buildEmbeddedSystemPrompt({
  // ... existing params ...
  chunking: chunkingConfig,
});
```

**Step 4: Add integration test**

Create `src/agents/integration/chunking.e2e.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt } from "../system-prompt.js";

describe("system prompt - chunking", () => {
  it("should include chunking instructions when enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      chunking: { enabled: true, markers: ["[SPLIT]"] }
    });
    expect(prompt).toContain("## Message Chunking");
    expect(prompt).toContain("[SPLIT]");
  });

  it("should not include chunking instructions when disabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      chunking: { enabled: false }
    });
    expect(prompt).not.toContain("## Message Chunking");
  });

  it("should use default markers when enabled but none specified", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      chunking: { enabled: true }
    });
    expect(prompt).toContain("[MSG]");
    expect(prompt).toContain("<nl>");
  });
});
```

**Step 5: Run tests**

```bash
pnpm test -- src/agents/integration/chunking.e2e.test.ts
```

Expected: All integration tests PASS

**Step 6: Commit**

```bash
git add src/agents/pi-embedded-runner/run/attempt.ts src/agents/integration/chunking.e2e.test.ts
git commit -m "feat: wire chunking config to system prompt"
```

---

## Task 6: Add documentation and examples

**Files:**
- Create: `docs/features/chunking.md`

**Step 1: Create feature documentation**

Create `docs/features/chunking.md`:

```markdown
# Message Chunking

Message chunking allows the LLM to split long responses into multiple shorter messages by using special markers.

## Configuration

Enable chunking in your Moltbot config:

\`\`\`json
{
  "agents": {
    "defaults": {
      "chunking": {
        "enabled": true,
        "markers": ["[MSG]", "<nl>"],
        "minChunkSize": 200
      }
    }
  }
}
\`\`\`

## Options

- **enabled**: Enable/disable chunking (default: `false`)
- **markers**: Array of marker strings that trigger splits (default: `["[MSG]", "<nl>"]`)
- **minChunkSize**: Minimum characters per chunk (default: `200`). Smaller chunks will be merged.

## How It Works

1. The system prompt instructs the LLM to use markers when writing long responses
2. The LLM includes markers like `[MSG]` where it wants message boundaries
3. The backend parses the response, removes markers, and sends each chunk as a separate message
4. Chunks smaller than `minChunkSize` are merged to avoid tiny fragments

## Example

With chunking enabled, the LLM might generate:

\`\`\`
Here's the first part of my answer.[MSG]Here's the second part with more details.[MSG]Finally, the conclusion.
\`\`\`

This gets delivered as three separate messages:

1. "Here's the first part of my answer."
2. "Here's the second part with more details."
3. "Finally, the conclusion."

## Use Cases

- **Long explanations**: Break down complex topics into digestible parts
- **Step-by-step guides**: Each step in its own message
- **Lists**: Send list items separately for easier reading
- **Platform limits**: Avoid hitting message length limits on some platforms
\`\`\``

**Step 2: Update docs index**

Add to `docs/features/index.md` or create reference in main docs.

**Step 3: Commit**

```bash
git add docs/features/chunking.md
git commit -m "docs: add message chunking feature documentation"
```

---

## Task 7: End-to-end testing

**Files:**
- Create: `test/e2e/chunking.e2e.test.ts`

**Step 1: Write e2e test**

Create comprehensive e2e test that simulates full flow:

```typescript
import { describe, it, expect } from "vitest";
import { buildAgentSystemPrompt } from "../../src/agents/system-prompt.js";
import { applyChunkMarkersToPayloads } from "../../src/infra/outbound/deliver.js";
import { splitByChunkMarkers } from "../../src/auto-reply/chunk-markers.js";

describe("chunking e2e", () => {
  it("should handle full chunking flow from prompt to delivery", () => {
    // 1. Build system prompt with chunking enabled
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test/workspace",
      chunking: { enabled: true, markers: ["[MSG]"], minChunkSize: 100 }
    });

    // Verify prompt includes instructions
    expect(prompt).toContain("## Message Chunking");
    expect(prompt).toContain("[MSG]");

    // 2. Simulate LLM response with markers
    const llmResponse = "First chunk[MSG]Second chunk[MSG]Third chunk";

    // 3. Parse markers
    const chunks = splitByChunkMarkers(llmResponse, ["[MSG]"], { minChunkSize: 100 });
    expect(chunks).toEqual(["First chunk", "Second chunk", "Third chunk"]);

    // 4. Apply to payloads
    const payloads = [{ text: llmResponse }];
    const result = applyChunkMarkersToPayloads(payloads, {
      enabled: true,
      markers: ["[MSG]"],
      minChunkSize: 100
    });

    expect(result).toEqual([
      { text: "First chunk" },
      { text: "Second chunk" },
      { text: "Third chunk" }
    ]);
  });

  it("should merge small chunks", () => {
    const text = "A[MSG]B[MSG]C";
    const chunks = splitByChunkMarkers(text, ["[MSG]"], { minChunkSize: 10 });
    expect(chunks).toEqual(["ABC"]);
  });

  it("should not merge large chunks", () => {
    const text = "Long first part[MSG]Long second part";
    const chunks = splitByChunkMarkers(text, ["[MSG]"], { minChunkSize: 5 });
    expect(chunks).toEqual(["Long first part", "Long second part"]);
  });
});
```

**Step 2: Run e2e tests**

```bash
pnpm test -- test/e2e/chunking.e2e.test.ts
```

Expected: All e2e tests PASS

**Step 3: Run full test suite**

```bash
pnpm test
```

Expected: All tests PASS (including existing tests)

**Step 4: Commit**

```bash
git add test/e2e/chunking.e2e.test.ts
git commit -m "test: add end-to-end chunking tests"
```

---

## Task 8: Manual testing checklist

**Files:**
- None (manual verification)

**Step 1: Enable chunking in test config**

Edit your local Moltbot config (`~/.clawdbot/clawdbot.json`):

```json
{
  "agents": {
    "defaults": {
      "chunking": {
        "enabled": true,
        "markers": ["[MSG]", "<nl>"]
      }
    }
  }
}
```

**Step 2: Restart gateway**

```bash
moltbot gateway restart
```

**Step 3: Send test prompts**

Via your preferred channel (Discord, Telegram, etc.):

1. Ask: "Tell me a long story about programming, split it into 3 parts using [MSG]"
2. Ask: "Count to 10, put each number on a separate line with <nl> markers"
3. Ask for a very long response (e.g., "Explain everything about TypeScript")

**Step 4: Verify behavior**

Check that:
- Markers are removed from delivered messages
- Each chunk arrives as a separate message
- Small chunks are merged appropriately
- System prompt includes chunking instructions

**Step 5: Test with chunking disabled**

Set `enabled: false` and verify markers pass through as plain text.

**Step 6: Document findings**

Note any edge cases or issues in a temporary file for potential fixes.

**Step 7: Commit config example**

```bash
git add docs/examples/chunking-config.json.example
git commit -m "docs: add chunking config example"
```

---

## Summary of Changes

**New Files:**
- `src/auto-reply/chunk-markers.ts` - Core chunk marker parser
- `src/auto-reply/chunk-markers.test.ts` - Unit tests
- `src/agents/integration/chunking.e2e.test.ts` - Integration tests
- `test/e2e/chunking.e2e.test.ts` - End-to-end tests
- `docs/features/chunking.md` - Feature documentation

**Modified Files:**
- `src/config/config.ts` - Add chunking config type
- `src/config/schema.ts` - Add chunking JSON schema
- `src/agents/system-prompt.ts` - Add chunking section to prompt
- `src/agents/pi-embedded-runner/system-prompt.ts` - Pass chunking config
- `src/agents/pi-embedded-runner/run/attempt.ts` - Wire config to prompt
- `src/infra/outbound/deliver.ts` - Apply chunk marker parsing

**Configuration Example:**

```json
{
  "agents": {
    "defaults": {
      "chunking": {
        "enabled": true,
        "markers": ["[MSG]", "<nl>"],
        "minChunkSize": 200
      }
    }
  }
}
```
