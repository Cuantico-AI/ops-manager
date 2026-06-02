# Assistable v3 — Cuantico Internal Reference

**Status:** Living doc, v2. Built from `docs.assistable.ai` (v3 reference + Platform / Build / Deploy / Monitor sections) and the v3 OpenAPI 3.1 spec as of June 2026. SDK / CLI / MCP are all generated from the same v3 OpenAPI spec; UI-only surfaces (webhook URLs, active tag bindings, snapshots) are flagged explicitly.

**Authoritative index:** `https://docs.assistable.ai/llms.txt`.

**Legal note on policy recommendations:** the DNC / TCPA / per-vertical posture guidance in this doc is operational framework, not legal advice. Confirm with counsel before locking in policy for regulated verticals (mortgage, insurance, real estate).

---

## TL;DR — what this enables

The v3 surface confirms the **Bot Factory triangle** (GHL MCP + n8n MCP + Assistable MCP/SDK) is real and most of it is fully programmable. After auditing the wider docs:

- **Assistants** have versions + revert via API — the safe-deploy primitive for Taylor across the fleet.
- **Outbound voice** is one API call (`createCall` with `variables`) — Live Event Automation, Emily, Jordan all become templated.
- **Knowledge bases** are fully programmable (text + FAQ + URL + file sources, Q&A trainings, voice-toggle).
- **Tools** map to a clean "LLM function call wrapped in an API call" model — templatable across the fleet.
- **Variable-driven templating** (`{{custom_values.*}}`, `{{contact.*}}`, `{{location.*}}`) means **one Taylor template serves all 40 sub-accounts** with zero per-account script editing. This is the piece that makes Bot Factory deployable at scale.
- **Three friction points remain UI-only:** webhook URL config, active tag bindings, snapshot ID list. Workaround under evaluation: build a template assistant once with all three wired, then `duplicateAssistant` and verify whether the duplicate inherits these bindings.
- **Snapshots are forward-only** — they solve new-client onboarding but not fleet-wide updates of existing 40 sub-accounts. The unique value of ops-manager Phase 6 is updating the existing fleet, which snapshots can't do.

---

## Architecture mental model

### Hierarchy

```
Workspace (Cuantico agency)
└── Sub-account (one per client — ~40 total)
    └── Assistants (voice + chat bots)
        ├── Prompt (variable-driven template)
        ├── Knowledge base(s)
        ├── Tools
        └── Phone number(s)
```

Mirrors GHL deliberately. Each sub-account has its own wallet, phone numbers, KBs, tools, and active tags.

### The contact-tag state machine

Every AI interaction (chat or voice) is gated by GHL contact tags. This is the safety and routing layer.

| Active tag present? | `ai_off` present? | `ai_replying` present? | Result |
|---|---|---|---|
| No | – | – | AI silent (default opt-out) |
| Yes | Yes | – | Manually muted |
| Yes | No | Yes | Generating in-flight |
| Yes | No | No | Ready to engage |

- **Active tag presence** = opt-in. No active tag means AI is silent regardless of anything else.
- **Active tag *identity*** = router. Different active tags route to different assistant + phone number pairs. One tag = one bot.
- **`ai_off`** = hard kill switch, overrides active tag. Voice AI requires an explicit IVR conditional to honor this; chat AI honors it natively.
- **`ai_replying`** = in-flight signal. Added when generation starts, removed when message hits CRM. Used to detect stuck states.

### The three-leg Taylor stack

```
Assistant = Prompt + KB + Tools
            │       │     │
            └── variable-driven template (custom_values + contact + location)
                    │
                    └── per-vertical KB (text + FAQ + URL + file sources)
                          │
                          └── shared tool library (assignTool to bind)
```

All three legs are programmable via v3 API. The same template can resolve to 40 different runtime configurations because variables pull from each sub-account's GHL data at call time.

### Deployment model: snapshot for spawn, API for everything after

| Surface | Native primitive | ops-manager Phase 6 role |
|---|---|---|
| New sub-account onboarding | Snapshots (template auto-clone, forward-only) | Trigger snapshot, then API-wire the rest |
| Fleet-wide template updates across existing 40 | None | **The unique Phase 6 unlock** |
| KB / tool / variable seeding | None at snapshot level | API-driven per sub-account |
| Per-client divergence | Manual UI | API-driven via versioned overrides |
| Webhook URL config | UI-only per assistant | Build-once template + duplicate (TBD) |
| Active tag bindings | UI-only per assistant/number | Build-once template + duplicate (TBD) |

---

## Auth model

| Variable / Flag | Required | Purpose |
|---|---|---|
| `ASSISTABLE_API_KEY` | yes | Bearer key. Format `ask_live_…` (prod), `ask_test_…`, `ask_staging_…`, `ask_dev_…`. SHA-256 hashed at rest. |
| `ASSISTABLE_SUBACCOUNT_ID` | no | Default `X-Subaccount-Id` header. Required on multi-subaccount keys unless overridden per-call. |
| `ASSISTABLE_BASE_URL` | no | Default `https://api.assistable.ai`. |

**Subaccount resolution order:** `X-Subaccount-Id` header → `subaccount_id` in body → `location_id` in body (legacy GHL alias).

**Scopes are `resource:action`** (e.g. `assistants:read`, `calls:create`). Role presets: `read_only`, `read_write`, `admin`, `custom`. Missing scope → 403 `forbidden`. Unauthorized subaccount → 403 `subaccount_forbidden`. Bad/expired key or IP block → 401 `unauthorized`.

**Rate limits:** 150 req / 10s burst + 100k / day, **per workspace+subaccount, not per key.** `X-RateLimit-*` headers on every response. 429 returns `Retry-After` (seconds).

**Cuantico credential rule:** never store `ask_live_…` keys in n8n credential nodes or workflow expressions (Slack log exposure risk). Store encrypted in the ops-manager Postgres `secrets` table, query at workflow start — same pattern as GHL PITs.

**Open question (architecturally important):** keys are documented as "bound to a workspace and one or more sub-accounts." Whether one key can hold all 40 sub-accounts in scope simultaneously — or whether we need 40 separate keys — determines the `secrets` table schema. Verify before Phase 6 implementation.

---

## Operation surface

**15 resource groups, ~85 operations.** Every row is callable via REST, SDK, CLI, or MCP. All accept optional `X-Subaccount-Id` header.

### Assistants — `assistants:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listAssistants | `GET /v3/assistants` | `assistants:list` |
| createAssistant | `POST /v3/assistants` | `assistants:create` |
| getAssistant | `GET /v3/assistants/{id}` | `assistants:read` |
| updateAssistant | `PATCH /v3/assistants/{id}` | `assistants:update` |
| deleteAssistant | `DELETE /v3/assistants/{id}` | `assistants:delete` |
| archiveAssistant | `POST /v3/assistants/{id}/archive` | `assistants:update` |
| unarchiveAssistant | `POST /v3/assistants/{id}/unarchive` | `assistants:update` |
| duplicateAssistant | `POST /v3/assistants/{id}/duplicate` | `assistants:create` |
| **listAssistantVersions** | `GET /v3/assistants/{id}/versions` | `assistants:read` |
| **revertAssistantVersion** | `POST /v3/assistants/{id}/versions/{version_id}/revert` | `assistants:update` |
| listAssistantNotes | `GET /v3/assistants/{id}/notes` | `assistants:read` |
| createAssistantNote | `POST /v3/assistants/{id}/notes` | `assistants:create` |
| deleteAssistantNote | `DELETE /v3/assistants/{id}/notes/{note_id}` | `assistants:delete` |

Key assistant fields: `id`, `name`, `description`, `model` (AIModel enum), `prompt`, `temperature` (0–2), `voiceId`, `assistantType` (STANDARD / FLOW_BUILDER), `language` (BCP-47), `voiceEnabled`, `folderId`, `inboundGreeting`, `outboundGreeting`, `archived`. **Default model is `KIMI_K2_5`.** **Not exposed in `updateAssistant` body:** `pre_call_webhook`, `post_call_webhook`, active tag bindings — these are UI-only.

### Assistant folders — `assistants:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listAssistantFolders | `GET /v3/assistant-folders` | `assistants:list` |
| createAssistantFolder | `POST /v3/assistant-folders` | `assistants:create` |
| updateAssistantFolder | `PATCH /v3/assistant-folders/{id}` | `assistants:update` |
| deleteAssistantFolder | `DELETE /v3/assistant-folders/{id}` | `assistants:delete` |
| assignAssistantsToFolder | `POST /v3/assistant-folders/{id}/assign` | `assistants:update` |
| removeAssistantsFromFolder | `POST /v3/assistant-folders/{id}/remove` | `assistants:update` |

### Voices — `voices:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listVoices | `GET /v3/voices` | `voices:list` |
| getVoiceFilterOptions | `GET /v3/voices/filter-options` | `voices:read` |
| getVoiceStats | `GET /v3/voices/stats` | `voices:read` |
| getVoice | `GET /v3/voices/{id}` | `voices:read` |
| updateVoiceAllowCopy | `PATCH /v3/voices/{id}/allow-copy` | `voices:update` |

Voice cloning is **UI-only** (no upload endpoint in v3). API exposes browsing, filtering, stats, and the allow-copy toggle on custom voices.

### Contacts — `contacts:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listContacts | `GET /v3/contacts` | `contacts:list` |
| createContact | `POST /v3/contacts` | `contacts:create` |
| getContact | `GET /v3/contacts/{id}` | `contacts:read` |
| updateContact | `PATCH /v3/contacts/{id}` | `contacts:update` |
| deleteContact (archive) | `DELETE /v3/contacts/{id}` | `contacts:delete` |
| permanentlyDeleteContact | `POST /v3/contacts/{id}/permanent-delete` | `contacts:delete` |
| listContactNotes | `GET /v3/contacts/{id}/notes` | `contacts:read` |
| createContactNote | `POST /v3/contacts/{id}/notes` | `contacts:create` |
| deleteContactNote | `DELETE /v3/contacts/{id}/notes/{note_id}` | `contacts:delete` |
| listContactInteractions | `GET /v3/contacts/{id}/interactions` | `contacts:read` |

Two-stage delete: `DELETE` archives, `permanent-delete` hard-deletes. Useful audit pattern.

### Tags — `tags:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listTags | `GET /v3/tags` | `tags:list` |
| createTag | `POST /v3/tags` | `tags:create` |
| getTag | `GET /v3/tags/{id}` | `tags:read` |
| updateTag | `PATCH /v3/tags/{id}` | `tags:update` |
| deleteTag | `DELETE /v3/tags/{id}` | `tags:delete` |
| permanentlyDeleteTag | `POST /v3/tags/{id}/permanent-delete` | `tags:delete` |

Note: these are Assistable-managed tags, not GHL contact tags. The active tag / `ai_off` / `ai_replying` system uses GHL contact tags, managed in GHL.

### Phone numbers — `numbers:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listPhoneNumbers | `GET /v3/phone-numbers` | `numbers:list` |
| getPhoneNumber | `GET /v3/phone-numbers/{id}` | `numbers:read` |
| updatePhoneNumber | `PATCH /v3/phone-numbers/{id}` | `numbers:update` |
| assignPhoneNumber | `POST /v3/phone-numbers/{id}/assign` | `numbers:update` |

Fields: `number`, `type`, `sipUri`, `assistantId`, `callerId`, `callingUri`, `answerWaitTime` (0–300s), `hdVoiceEnabled`, `isLegacy`. No provisioning op — numbers are added via UI or upstream (Telnyx / Twilio / Vonage SIP), then managed here.

### Number pools — `numbers:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listNumberPools | `GET /v3/number-pools` | `numbers:list` |
| createNumberPool | `POST /v3/number-pools` | `numbers:create` |
| getNumberPool | `GET /v3/number-pools/{id}` | `numbers:read` |
| updateNumberPool | `PATCH /v3/number-pools/{id}` | `numbers:update` |
| deleteNumberPool | `DELETE /v3/number-pools/{id}` | `numbers:delete` |
| addNumbersToPool | `POST /v3/number-pools/{id}/add-numbers` | `numbers:update` |
| removeNumbersFromPool | `POST /v3/number-pools/{id}/remove-numbers` | `numbers:update` |

### Appointments — `appointments:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listAppointments | `GET /v3/appointments` | `appointments:list` |
| createAppointment | `POST /v3/appointments` | `appointments:create` |
| getAppointment | `GET /v3/appointments/{id}` | `appointments:read` |
| updateAppointment | `PATCH /v3/appointments/{id}` | `appointments:update` |

`from` and `to` required on list (ISO datetime range). Statuses: `SCHEDULED`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`, `RESCHEDULED`.

### Tools — `tools:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listTools | `GET /v3/tools` | `tools:list` |
| createTool | `POST /v3/tools` | `tools:create` |
| listToolCategories | `GET /v3/tools/categories` | `tools:read` |
| getTool | `GET /v3/tools/{id}` | `tools:read` |
| updateTool | `PATCH /v3/tools/{id}` | `tools:update` |
| deleteTool | `DELETE /v3/tools/{id}` | `tools:delete` |
| copyTool | `POST /v3/tools/{id}/copy` | `tools:create` |
| **assignTool** | `POST /v3/tools/{id}/assign` | `tools:update` |
| **removeTool** | `POST /v3/tools/{id}/remove` | `tools:update` |
| listAssistantTools | `GET /v3/assistants/{id}/tools` | `tools:read` |

Tool body: `name` (`^[a-zA-Z0-9_-]+$`, ≤64 chars), `description`, `category`, `tool_type` (FUNCTION / CUSTOM / END_CALL / PRESS_DIGIT / TRANSFER_CALL), `url`, `http_method`, `headers` (Bearer Token supported), `parameters` (JSON Schema), `required_params`, `speak_during_execution`, `speak_after_execution`, `execution_message_description`, `transfer_prompt`.

11 pre-built tool patterns documented under `build/custom-tools/*`: Calculate Distance, Call from SMS, Multi-Calendar Booking, Save Address, Scrape Website, Screenshot Website, Search the Web, Send Conversation Summary, Submit Support Ticket, Update Contact in GHL, Managing Tools. Pull specific patterns on demand when building.

### Knowledge base — `knowledge:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listKnowledgeBases | `GET /v3/knowledge-bases` | `knowledge:list` |
| createKnowledgeBase | `POST /v3/knowledge-bases` | `knowledge:create` |
| getKnowledgeBase | `GET /v3/knowledge-bases/{id}` | `knowledge:read` |
| updateKnowledgeBase | `PATCH /v3/knowledge-bases/{id}` | `knowledge:update` |
| archiveKnowledgeBase | `DELETE /v3/knowledge-bases/{id}` | `knowledge:delete` |
| createTextSource | `POST /v3/knowledge-bases/{id}/sources/text` | `knowledge:create` |
| createFaqSource | `POST /v3/knowledge-bases/{id}/sources/faq` | `knowledge:create` |
| createUrlSource | `POST /v3/knowledge-bases/{id}/sources/url` | `knowledge:create` |
| createFileSource | `POST /v3/knowledge-bases/{id}/sources/file` | `knowledge:create` |
| renameKnowledgeSource | `PATCH /v3/knowledge-bases/{id}/sources/{source_id}` | `knowledge:update` |
| deleteKnowledgeSource | `DELETE /v3/knowledge-bases/{id}/sources/{source_id}` | `knowledge:delete` |
| listQueryTrainings | `GET /v3/knowledge-bases/{id}/query-trainings` | `knowledge:read` |
| createQueryTraining | `POST /v3/knowledge-bases/{id}/query-trainings` | `knowledge:create` |
| updateQueryTraining | `PATCH /v3/knowledge-bases/{id}/query-trainings/{training_id}` | `knowledge:update` |
| deleteQueryTraining | `DELETE /v3/knowledge-bases/{id}/query-trainings/{training_id}` | `knowledge:delete` |
| toggleQueryTraining | `POST /v3/knowledge-bases/{id}/query-trainings/{training_id}/toggle` | `knowledge:update` |
| assignKnowledgeBase | `POST /v3/knowledge-bases/{id}/assign` | `knowledge:update` |
| removeKnowledgeBase | `POST /v3/knowledge-bases/{id}/remove` | `knowledge:update` |
| enableKnowledgeBaseVoice | `POST /v3/knowledge-bases/{id}/voice/enable` | `knowledge:update` |
| disableKnowledgeBaseVoice | `POST /v3/knowledge-bases/{id}/voice/disable` | `knowledge:update` |
| listAssistantKnowledgeBases | `GET /v3/assistants/{id}/knowledge-bases` | `knowledge:read` |

File source takes a pre-signed `file_url` + `filename` + `mime_type` — we bring our own storage (R2/S3).

### Conversations — `conversations:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listConversations | `GET /v3/conversations` | `conversations:list` |
| getConversationStats | `GET /v3/conversations/stats` | `conversations:read` |
| getConversation | `GET /v3/conversations/{id}` | `conversations:read` |
| updateConversation | `PATCH /v3/conversations/{id}` | `conversations:update` |
| deleteConversation | `DELETE /v3/conversations/{id}` | `conversations:delete` |
| listConversationCalls | `GET /v3/conversations/{id}/calls` | `conversations:read` |

Updateable: `status`, `summary`, `is_archived`, `is_favorite`, `lead_quality`, `user_sentiment`.

### Messages — `messages:*`

| Operation | Method · Path | Scope |
|---|---|---|
| listConversationMessages | `GET /v3/conversations/{id}/messages` | `messages:list` |
| createMessage | `POST /v3/messages` | `messages:create` |

### Chat — `chat:*`

| Operation | Method · Path | Scope |
|---|---|---|
| createChatCompletion | `POST /v3/chat/completions` | `chat:create` |

AI-driven response on existing conversation. Pass `assistant_id` + `conversation_id` (+ optional `additional_instructions`), get back reply text. Useful when piping inbound through n8n / Claude before letting Assistable respond.

### Calls — `calls:*`

| Operation | Method · Path | Scope |
|---|---|---|
| createCall | `POST /v3/calls` | `calls:create` |
| listCalls | `GET /v3/calls` | `calls:list` |
| getCallStats | `GET /v3/calls/stats` | `calls:read` |
| getCall | `GET /v3/calls/{id}` | `calls:read` |

`createCall` body: `assistant_id`, `to` (E.164), optional `from`, `contact_id`, `variables` (template key-values injected into prompt/greeting). Returns `{ call_id, from, to, path }`.

`getCall` returns the full analytics payload — transcript, transcriptObject, callAnalysis, latencyAverages, calledTools, callCost, variables, callLegs, recordingUrls, plus duration, sentiment, summary, disconnection reason.

### Flows — `flows:*`

| Operation | Method · Path | Scope |
|---|---|---|
| createFlow | `POST /v3/flows` | `flows:create` |

Only create is in the public v3 surface. List/update/delete may exist but aren't documented — Flow Builder appears to be primarily UI-driven (13 doc pages under `build/flow-builder/*`).

### Legacy "GHL-Safe" surface

Three additional OpenAPI specs alongside the v3 main: `chat-api.json`, `calling-api.json`, `assistant-api.json`. These are legacy flat endpoints (`make-ai-call-ghl-safe`, `agent-chat-completion-ghl-safe`, etc.) designed for direct use from GHL workflow webhooks. Don't build new integrations against these — prefer v3 — but they exist for backwards compat with older Cuantico builds.

---

## Enums (reference)

**AIModel** (assistant `model` field)
OpenAI: `GPT_5`, `GPT_5_NANO`, `GPT_5_MINI`, `GPT_5_1`, `GPT_5_2`, `GPT_5_4`, `GPT_4_1`, `GPT_4_1_NANO`, `GPT_4_1_MINI`, `GPT_4O`, `GPT_4O_MINI`, `GPT_4_TURBO`, `GPT_4`, `GPT_3_5_TURBO`
Anthropic: `CLAUDE_4_1_OPUS`, `CLAUDE_4_SONNET`, `CLAUDE_3_7_SONNET`, `CLAUDE_HAIKU_4_5`, `CLAUDE_3_5_HAIKU`, `CLAUDE_3_SONNET`, `CLAUDE_3_HAIKU`
Google: `GEMINI_2_5_FLASH`, `GEMINI_2_0_FLASH`, `GEMINI_2_0_FLASH_LITE`
Other: `KIMI_K2_5` (default), `QWEN_3_235B_A22B`, `CUSTOM`

**Voice provider:** `ELEVENLABS`, `OPENAI`, `DEEPGRAM`, `PLAYHT`, `CUSTOM`, `RIME`, `MINIMAX`, `ENSEMBLE`

**Assistant type:** `STANDARD` (prompt-driven, default), `FLOW_BUILDER` (node/flow driven)

**Tool type:** `FUNCTION` (chat/LLM, default), `CUSTOM` (voice with URL), `END_CALL`, `PRESS_DIGIT`, `TRANSFER_CALL`

**HTTP method (tools):** `GET`, `POST` (default), `PUT`, `PATCH`, `DELETE`

**Conversation channel:** `SMS`, `EMAIL`, `VOICE`, `WHATSAPP`, `WEBCHAT`, `FACEBOOK`, `INSTAGRAM`, `GMB`, `LIVE_CHAT`, `CUSTOM`

**Message type:** `TEXT` (default), `IMAGE`, `VIDEO`, `AUDIO`, `FILE`, `LOCATION`, `CONTACT`, `SYSTEM`, `TOOL_CALL`, `TOOL_RESULT`, `FUNCTION_CALL`, `FUNCTION_RESULT`

**Call status:** `QUEUED`, `INITIATED`, `RINGING`, `IN_PROGRESS`, `COMPLETED`, `BUSY`, `FAILED`, `NO_ANSWER`, `CANCELED`

**Appointment status:** `SCHEDULED`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW`, `RESCHEDULED`

**Lead quality:** `HOT`, `WARM`, `COLD`, `UNQUALIFIED`

**User sentiment:** `POSITIVE`, `NEUTRAL`, `NEGATIVE`, `MIXED`

**Error codes:** `validation_error` (400, with `details[]`), `subaccount_required` (400), `unauthorized` (401), `forbidden` (403), `subaccount_forbidden` (403), `not_found` (404), `rate_limited` (429), `call_failed` (502), `chat_failed` (502)

---

## Variable-driven templating (the multi-tenant unlock)

Syntax: `{{variable_name}}`. Resolved at runtime from the active sub-account's data. Six namespaces:

| Namespace | Pulls from | Examples |
|---|---|---|
| **Session** | Runtime context | `{{location_id}}`, `{{contact_id}}`, `{{assistant_id}}`, `{{channel}}`, `{{direction}}`, `{{timezone}}` |
| **`right_now.*`** | Computed at execution | `{{right_now.day_name}}`, `{{right_now.current_time}}`, `{{right_now.mon_date}}` through `sun_date`, `{{right_now.tomorrow_date}}` |
| **`contact.*`** | GHL contact record | `{{contact.first_name}}`, `{{contact.tags}}`, `{{contact.timezone}}`, `{{contact.notes}}` |
| **`location.*`** | GHL location settings | `{{location.business.name}}`, `{{location.first_name}}`, `{{location.phone}}`, `{{location.social.facebook}}` |
| **`user.*`** | Assigned agent | `{{user.name}}`, `{{user.email}}`, `{{user.role}}` |
| **`custom_values.*`** | GHL custom values | `{{custom_values.company_name}}`, `{{custom_values.booking_link}}`, `{{custom_values.office_hours}}` |

### Why this is the multi-tenant unlock

Because `location.*` and `custom_values.*` resolve from each sub-account's own GHL data at call time, **one Taylor template can serve all 40 sub-accounts with zero per-account editing.** Same prompt string deployed everywhere, different runtime resolution per sub-account.

### Standard Cuantico `custom_values` to pre-seed in every GHL sub-account

Becomes part of the GHL snapshot we apply on new client onboarding.

**Universal (all clients):**
`company_name`, `timezone`, `booking_link`, `office_hours`, `bot_name`, `support_email`, `transfer_number`

**Mortgage vertical:**
`loan_officer_nmls`, `compliance_disclaimer`, `service_areas`, `product_lineup`, `state_licenses`

**Real estate vertical:**
`service_areas`, `mls_id`, `team_lead_name`, `brokerage_name`, `license_number`

**Insurance vertical:**
`producer_license`, `state_of_business`, `carriers_offered`, `lines_of_business`

### Taylor template skeleton (illustrative)

```text
You are {{custom_values.bot_name}}, an AI receptionist for
{{custom_values.company_name}}.

[Identity]
You work for {{location.business.name}}.
Owner: {{location.first_name}} {{location.last_name}}.
Business hours: {{custom_values.office_hours}}.
Booking link: {{custom_values.booking_link}}.

[Compliance — mortgage vertical]
NMLS: {{custom_values.loan_officer_nmls}}.
Service areas: {{custom_values.service_areas}}.
Disclaimer: {{custom_values.compliance_disclaimer}}.

[Task Flow]
Greet {{contact.first_name}} naturally given it's {{right_now.day_name}}
{{right_now.current_time}} in {{contact.timezone}}.

If {{contact.tags}} includes 'pre-approved', skip qualification.
Otherwise ask about [...]
```

Deploy once, runs everywhere. Combine with `createCall.variables` for per-call overrides (e.g., Live Event Automation injects `event_name`, `event_date`, `register_link` per call).

### `memory` variable — worth investigating

The variable reference lists `{{memory}}` as "Persistent memory content." Implies Assistable has built-in conversational memory at the contact level. Could replace some of what Cuantico currently does with GHL custom fields for conversation state. Worth a test before Phase 6 scoping.

---

## DNC compliance & lead attribution

Operational framework, not legal advice. Confirm with counsel.

### How Assistable's three-layer screen works

Every outbound call passes through:

1. **Lead attribution check** — GHL knows the lead source?
   - Known source → DNC screening bypassed (documented relationship exists)
   - Unknown source → continue to layer 2
2. **Assistable internal DNC list** — prior opt-outs / prior flags → blocked
3. **National + state DNC registries** → blocked if listed

### The operational lever: lead attribution hygiene

Properly source-tagged GHL leads (form fills, organic inquiry, documented marketing channel) bypass DNC entirely. Untagged "unknown source" leads run the full screen. **GHL lead source quality directly drives call success rate.** Should be part of standard Cuantico onboarding QA: every new client sub-account audited for lead source attribution before AI outbound is enabled.

### Bypass mechanisms

| Bypass | When to use | Cuantico posture |
|---|---|---|
| Full account opt-out | REI / pure cold-outreach, client accepts TCPA liability | Never default. Requires explicit client legal sign-off. |
| Per-import bypass | Vetted lists where DNC clearance is verified upstream | Sparingly. Document the chain of trust. |

**TCPA exposure: up to $51,744 per call.** This is not a hypothetical.

### Per-vertical posture (Cuantico recommendation)

| Vertical | DNC posture | Rationale |
|---|---|---|
| Mortgage | Full screening ON | TCPA + state lending regs |
| Real estate | Full screening ON | TCPA + state rules |
| Insurance | Full screening ON | TCPA + Reassigned Numbers Database compliance |
| REI / cold outreach | Bypass possible | Operator assumes liability — requires signed acknowledgment |

### Error monitoring pattern

Every GHL workflow that uses Make AI Call must include an If/Else branch checking `return_an_error = true` and surfacing `error_message`. Routes to Slack alert via ops-manager webhook. Ships in the standard Cuantico GHL snapshot.

### Two call paths share the same DNC pipeline

| Path | Use case |
|---|---|
| GHL workflow Make AI Call action | Most client-facing automations |
| v3 API `createCall` | ops-manager / n8n-driven outbound (Live Event Automation, etc.) |

Both presumably hit the same three-layer screen — worth confirming in testing before relying on it for the API path.

---

## Webhooks & post-call data pipeline

### Configuration

**Webhook URLs are UI-only.** Configured per-assistant under Call Settings → Pre-Call Webhook / Post-Call Webhook. Not exposed in the v3 `updateAssistant` body. This is a meaningful Phase 6 friction point.

### Integration model

```
Assistable
    │
    ├── Pre-Call Webhook (POST) ──► GHL Inbound Webhook ──► GHL Workflow
    │                                                            │
    │                                                            └── (optional) n8n hop ──► ops-manager
    │
    └── Post-Call Webhook (POST) ──► GHL Inbound Webhook ──► GHL Workflow
                                                                 │
                                                                 ├── Find Contact by Contact ID
                                                                 ├── Update custom fields
                                                                 ├── Log note
                                                                 └── (optional) forward to n8n/ops-manager
```

Not direct-to-n8n. Every post-call automation gets a GHL workflow hop. The clean pattern: one GHL workflow per sub-account that fans out (update CRM + log + forward to ops-manager via n8n step).

### Pre-call payload (minimal)

```json
{
  "to": "+15551234567",
  "from": "+15559876543",
  "contactId": "contact_abc123"
}
```

Workflows must `Find Contact by Contact ID` first to enrich.

### Post-call payload (rich)

| Field | Type | Notes |
|---|---|---|
| `call_id` | string | |
| `call_type` | string | e.g., `voice` |
| `direction` | string | `inbound` / `outbound` |
| `to`, `from` | E.164 strings | |
| `contact_id` | string | |
| `disconnection_reason` | string | e.g., `completed` |
| `user_sentiment` | enum | POSITIVE / NEUTRAL / NEGATIVE / MIXED |
| `call_summary` | string | AI-generated |
| `call_completion` | string | e.g., `complete` |
| **`assistant_task_completion`** | string | **structured task-success signal** (e.g., `success`) |
| `recording_url` | URL | |
| `call_time_ms` / `call_time_seconds` | int | |
| `full_transcript` | string | full text |
| `start_timestamp` / `end_timestamp` | ISO datetime | |

**`assistant_task_completion`** is worth flagging — it's a structured success/failure signal not visible in the documented `getCall` API response shape. Could be derived server-side, exposed only via webhook. Worth verifying: if it's available in `getCall` too, ops-manager can poll for it; if webhook-only, we have to capture it via the GHL workflow hop.

### Standard custom fields to create in every Cuantico GHL sub-account

Maps the post-call payload to CRM contact fields. Ships in the snapshot.

- Conversation Summary (Multi-line Text)
- AI Conversation Transcript (Multi-line Text)
- Last Call ID (Single Line)
- Last Call Recording URL (Single Line)
- Lead Quality (Dropdown: HOT/WARM/COLD/UNQUALIFIED)
- User Sentiment (Dropdown: POSITIVE/NEUTRAL/NEGATIVE/MIXED)
- Assistant Task Completion (Single Line)
- Last Call Timestamp (Date/Time)

---

## Baseline Cuantico GHL workflow stack

Six workflows that ship in every new client sub-account's GHL snapshot. Together they make the API-driven assistant layer safe in production.

| # | Workflow | Trigger | Action |
|---|---|---|---|
| 1 | **AI Stuck Detection** | Tag `ai_replying` added | Wait 45s → check tag still present → if yes: Slack alert via ops-manager webhook, auto-remove tag |
| 2 | **Human Takeover Detection** | Conversation assigned to human user | Apply `ai_off` tag |
| 3 | **Human Handback** | Conversation closed or reassigned to AI | Remove `ai_off` tag |
| 4 | **Pre-Call Webhook Receiver** | Assistable pre-call webhook | Find Contact by Contact ID, set in-flight markers |
| 5 | **Post-Call Webhook Receiver** | Assistable post-call webhook | Find Contact → write transcript / summary / sentiment / task_completion to custom fields → log note → (optional) n8n forward to ops-manager |
| 6 | **IVR AI Switch** | Inbound voice call | If contact tag does NOT include `ai_off` → proceed with AI; else → route to human |
| 7 | **Blocked-Call Error Alert** | Make AI Call action returns error | Slack alert with `error_message` to ops-manager — pairs with DNC compliance |

(Yes, that's seven. Numbering is approximate; #7 is the DNC error pattern, technically a paired sub-workflow but worth listing separately.)

---

## CLI Reference (`@assistableai/cli`)

```bash
npm install -g @assistableai/cli
assistableai login --api-key ask_live_… --subaccount <sid>
assistableai whoami       # show active creds, key masked
assistableai logout       # delete stored creds (~/.assistableai/config.json, mode 0600)
```

Resolution precedence: explicit flag → env var → stored config.

```bash
assistableai assistants list --limit 10
assistableai assistants get <id> --json
assistableai contacts list -s <other-sid>           # one-off subaccount
assistableai contacts create -d '{"first_name":"Ada","email":"ada@x.com"}'
echo '{"name":"Support bot"}' | assistableai assistants create --data-file -
```

Global flags: `--json` (raw envelope), `-s/--subaccount`, `--api-key`, `--base-url`, `-d/--data`, `--data-file`. Errors → stderr + non-zero exit (composes in pipelines).

---

## MCP Server Reference (`@assistableai/mcp`)

```json
{
  "mcpServers": {
    "assistableai": {
      "command": "npx",
      "args": ["-y", "@assistableai/mcp"],
      "env": {
        "ASSISTABLE_API_KEY": "ask_live_…",
        "ASSISTABLE_SUBACCOUNT_ID": "<sid>"
      }
    }
  }
}
```

Config files: Claude Desktop → `claude_desktop_config.json`; Cursor → `.cursor/mcp.json`; Claude Code → `claude mcp add` or project `.mcp.json`.

Sanity check: `ASSISTABLE_API_KEY=ask_live_… npx -y @assistableai/mcp` — exits with error if key missing.

Single-subaccount stdio constraint: for multi-account orchestration, wrap in ops-manager rather than spawning per-account MCP servers.

---

## TypeScript SDK Reference (`@assistableai/sdk`)

```ts
import { configure, listAssistants } from "@assistableai/sdk";

configure({
  apiKey: process.env.ASSISTABLE_API_KEY!,
  subaccountId: process.env.ASSISTABLE_SUBACCOUNT_ID, // optional default
});

// Envelope: { data, error, request_id } — always log request_id on errors
const { data, error, request_id } = await listAssistants({ limit: 10 });

// Per-call subaccount override (ops-manager pattern)
await listAssistants(
  { limit: 10 },
  { "X-Subaccount-Id": subaccountId }
);
```

Path params positional; query/body typed objects. Always log `request_id` on errors.

---

## Cuantico integration patterns

### 1. Safe deployment via versions + revert

Every `updateAssistant` mutation creates a version. To deploy Taylor safely:

```ts
async function deployWithRollback(
  subaccountId: string,
  assistantId: string,
  updates: AssistantUpdate
) {
  configure({ apiKey: await getKey(subaccountId) });
  const headers = { "X-Subaccount-Id": subaccountId };

  // 1. Capture pre-deploy version id for rollback
  const { data: pre } = await listAssistantVersions(assistantId, headers);
  const lastGood = pre[0].id;

  // 2. Push update
  const { data, error, request_id } = await updateAssistant(
    assistantId, updates, headers
  );

  await auditLog({
    action: "assistable.deploy",
    subaccountId, assistantId, lastGoodVersion: lastGood,
    request_id, error,
  });

  // 3. revertAssistantVersion(assistantId, lastGood, headers) to roll back
  return { data, error, request_id, lastGood };
}
```

Slack approval gate → deploy → "Bot Factory: deployed v12 (prev v11 saved for rollback)". One-tap rollback if the new version breaks.

### 2. Taylor template deployment

```ts
async function deployTaylor(subaccountId: string, vars: TaylorVars) {
  configure({ apiKey: await getKey(subaccountId) });
  const headers = { "X-Subaccount-Id": subaccountId };

  // The prompt is the variable-driven template — same string across all 40 accounts
  const prompt = TAYLOR_TEMPLATE;

  const { data: asst } = await createAssistant({
    name: vars.botName,
    prompt,
    model: "CLAUDE_HAIKU_4_5",
    temperature: 0,
    assistant_type: "STANDARD",
    language: "en",
    voice_enabled: true,
    voice_id: vars.voiceId,
    inbound_greeting: vars.inboundGreeting,
    outbound_greeting: vars.outboundGreeting,
  }, headers);

  // Attach standard Taylor tools (end_call, transfer_call, press_digit, ...) by id
  for (const toolId of TAYLOR_TOOL_IDS) {
    await assignTool(toolId, { assistant_id: asst.id }, headers);
  }

  // Bind a number from the sub-account's pool
  await assignPhoneNumber(vars.phoneNumberId, { assistant_id: asst.id }, headers);

  // Attach KB if provided
  if (vars.knowledgeBaseId) {
    await assignKnowledgeBase(vars.knowledgeBaseId, { assistant_id: asst.id }, headers);
  }

  // Webhook URLs + active tag binding still require UI hop — see Phase 6 friction
  return asst;
}
```

### 3. Live Event Automation — outbound voice via `createCall`

```ts
await createCall({
  assistant_id: vars.assistantIdForSlot,
  to: lead.phoneE164,
  contact_id: lead.contactId,
  variables: {
    first_name: lead.firstName,
    event_name: vars.eventName,
    event_date: vars.eventDate,
    register_link: vars.registerLink,
  },
}, { "X-Subaccount-Id": subaccountId });
```

The `variables` map gets injected into the prompt/greeting templates — no per-call script editing. Same primitive serves Emily (AAML), future outbound campaigns.

### 4. Bulk operations across 40 accounts (rate-limit-aware)

Burst is 150/10s **per subaccount**, so parallelize across accounts, serialize within each one.

```ts
async function fleetOp<T>(accounts: string[], op: (sid: string) => Promise<T>) {
  return Promise.all(accounts.map(sid =>
    perAccountQueue.add(sid, async () => {
      try { return await op(sid); }
      catch (err) {
        if (err.code === "rate_limited") {
          await sleep(err.retryAfter * 1000);
          return await op(sid);
        }
        throw err;
      }
    })
  ));
}
```

Predictive throttling: pause the per-account queue when `X-RateLimit-Remaining < 20`.

### 5. ops-manager Phase 6 scoping (read-only first)

Mirror Phase 2's safety model.

**Read-only skills** (`*:list`, `*:read`):
- `assistable.list-assistants <account>`
- `assistable.list-calls <account> [filters]`
- `assistable.get-call-stats <account>`
- `assistable.list-conversations <account>`
- `assistable.list-knowledge-bases <account>`
- `assistable.list-tools <account>`

**Slash commands (read-only first):**
- `/ops asst list <account>`
- `/ops calls today <account>` (status filter, sentiment breakdown)
- `/ops kb list <account>`

**Mutations gated by `BYPASS_APPROVAL=false`:**
- `assistable.deploy-taylor <account> <template>` → Slack approval → deploy
- `assistable.revert-assistant <account> <id> <version>` → one-tap rollback
- `assistable.assign-kb <account> <kb> <asst>`

**Derived metrics (ops-manager-owned, not passthrough):**
- Per-sub-account blocked-call rate (from Blocked-Call Error Alert workflow)
- Per-number health metrics aggregated from `listCalls` + `getCallStats` (since Assistable's Number Intelligence is monthly-cadence and UI-only)
- Stuck-state count (from AI Stuck Detection workflow)
- Per-bot task completion rate (from `assistant_task_completion`)

Every Assistable response's `request_id` lands in `audit_log` alongside the slash command + Slack user that triggered it.

### 6. Knowledge base provisioning pipeline (new client onboarding)

```ts
const { data: kb } = await createKnowledgeBase(
  { name: `${client.name} — Production KB` }, headers
);

await createTextSource(kb.id, {
  name: "Company overview", text: client.companyOverview,
}, headers);

await createFaqSource(kb.id, {
  name: "Sales FAQ", faqs: client.intake.faqs,
}, headers);

for (const url of client.intake.policyUrls) {
  await createUrlSource(kb.id, { name: new URL(url).hostname, url }, headers);
}

for (const file of client.intake.uploadedDocs) {
  await createFileSource(kb.id, {
    name: file.title, file_url: file.signedUrl,
    filename: file.filename, mime_type: file.mimeType, file_size: file.size,
  }, headers);
}

await enableKnowledgeBaseVoice(kb.id, headers);
await assignKnowledgeBase(kb.id, { assistant_id: bot.id }, headers);
```

Half-day of UI clicks → 90-second script.

---

## Phase 6 friction points (UI-only, blocks full automation)

| Friction | What it blocks | Workaround |
|---|---|---|
| **Webhook URLs (pre/post-call)** | End-to-end programmatic deploy | Pre-wire webhooks in a template assistant once, use `duplicateAssistant`, verify duplicate inherits |
| **Active tag bindings** (tag → assistant + phone number) | Inbound routing automation | Same — template + duplicate, verify inheritance |
| **Voice cloning / upload** | API-driven custom voice creation | UI-only; accept this, manage custom voices manually |
| **Snapshot Assistant ID list** | Rotating templates programmatically | Likely UI-only; verify if there's an undocumented API path |
| **Flow Builder beyond `createFlow`** | Visual flow management via API | UI-driven; treat Flow Builder bots as a separate manual workflow |
| **Number Intelligence metrics** | Live phone health signal | Monthly + UI only; derive our own metrics from `listCalls` |

**Critical test before Phase 6 implementation:** stand up a template assistant in a sandbox sub-account with pre-/post-call webhook URLs and active tag bindings configured. Call `duplicateAssistant` and verify the duplicate carries: (a) webhook URLs, (b) active tag binding, (c) tool assignments, (d) KB assignment, (e) phone number assignment. If yes — Bot Factory deployment is 100% API-driven via template-and-duplicate. If no — each of those becomes a required manual step in our deploy flow and we need a different strategy.

---

## Open questions

Tracking what's still unresolved after the docs audit.

1. **Key scoping at the workspace level.** Can one `ask_live_…` key be scoped to all 40 sub-accounts simultaneously, or do we need 40 separate keys? Determines `secrets` table schema. Verify in Assistable admin UI.
2. **`assistant_task_completion` in `getCall`.** Is the structured task-success signal exposed in the `getCall` API response, or webhook-only? Affects whether we can poll for it or must capture via GHL workflow hop.
3. **`duplicateAssistant` inheritance.** Does duplicating an assistant carry: webhook URLs, active tag bindings, tool assignments, KB assignment, phone assignment? This is the highest-priority test before Phase 6 implementation.
4. **DNC pipeline on `createCall`.** Does the v3 API `createCall` route through the same three-layer DNC screen as the GHL Make AI Call action? Verify before relying on it for compliance.
5. **`memory` variable.** What's the persistence model? Per-contact? Per-conversation? Cross-conversation? Could replace some GHL custom field state.
6. **Multi-tag behavior on active tags.** If a contact has two active tags simultaneously, which assistant handles them? First-match? Last-applied? Undefined? Enforce single-tag-per-contact as a Cuantico invariant until verified.
7. **Snapshot Assistant ID API.** Is the agency snapshot's assistant template list manageable via API, or strictly the Agency tab UI?
8. **Flows surface.** Beyond `createFlow`, is there list/update/delete via API, or is Flow Builder strictly UI-managed?

---

## Quick reference card

```bash
# CLI
npm i -g @assistableai/cli
assistableai login --api-key ask_live_… --subaccount <sid>
assistableai assistants list --limit 10
assistableai calls stats --json
```

```ts
// SDK — the only pattern you'll write 90% of the time
import { configure, /* op */ } from "@assistableai/sdk";
configure({ apiKey: process.env.ASSISTABLE_API_KEY! });

const { data, error, request_id } = await someOp(
  args,
  { "X-Subaccount-Id": sid }   // per-call override = the fleet pattern
);

if (error) {
  await auditLog({ action, sid, request_id, error });
  if (error.code === "rate_limited") { /* honor Retry-After */ }
}
```

```text
Phase 6 default scope set (read-only):
  assistants:list, assistants:read
  voices:list, voices:read
  contacts:list, contacts:read
  tags:list, tags:read
  numbers:list, numbers:read
  appointments:list, appointments:read
  tools:list, tools:read
  knowledge:list, knowledge:read
  conversations:list, conversations:read
  messages:list
  calls:list, calls:read

Elevate per-skill to :create / :update / :delete behind BYPASS_APPROVAL gates.
```

```text
Tag state machine (memorize this):
  No active tag                       → AI silent (default)
  ai_off present                      → AI silent (override)
  active tag present, no ai_off       → AI engages
  ai_replying present                 → generation in-flight
  ai_replying still present after 45s → stuck, alert + auto-clear
```

```text
DNC posture (Cuantico policy, pending legal sign-off):
  Mortgage / Real estate / Insurance  → Full screening ON, no bypass
  REI / cold outreach                 → Bypass allowed with signed acknowledgment
  All paths                           → Make AI Call error alert workflow required
```

---

*Maintained by Cuantico ops. Update on: spec changes, Phase 6 milestones, new docs findings, or when `llms.txt` reveals operations not captured here.*
