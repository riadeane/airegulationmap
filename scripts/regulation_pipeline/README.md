# `regulation_pipeline` — backend architecture

The pipeline researches AI-regulation status for every country via the Claude API
and writes the four data files the frontend renders. It runs monthly from GitHub
Actions and on demand from the CLI.

```bash
python scripts/update_data.py --force --batch      # full run, 50% token pricing
python scripts/update_data.py --countries "Germany,France"
python scripts/update_data.py --dry-run --force    # preview, no writes
python -m regulation_pipeline --help               # (or: update-regulation-data, after pip install -e .)
```

The package is layered around a few classic patterns — **domain model**,
**repository**, **strategy**, and a **service** orchestrator — so each concern has
one home and is testable in isolation. Everything below reflects the code in this
directory.

---

## Layered architecture

Arrows mean *depends on / calls*. The top is the entry point; the bottom is the
shared foundation. Nothing in the foundation imports upward.

```mermaid
flowchart TD
    CLI["cli.py<br/>Typer CLI — flags, logging, wiring, exit codes"]

    CLI --> SVC["service.py<br/>PipelineService — orchestration"]
    CLI --> STRAT
    CLI --> REPO

    SVC --> STRAT["strategies.py<br/>ResearchStrategy (Sync / Batch)"]
    SVC --> REPO["repository.py<br/>Dataset — the four data stores"]
    SVC --> STALE["staleness.py<br/>StalenessPolicy"]

    STRAT --> API["api.py<br/>ResearchClient — request + parse"]
    STRAT --> BATCH["batch.py<br/>BatchRunner — submit / poll / classify"]

    API --> RETRY["retry.py<br/>call_with_retries"]
    API --> PROMPT["prompt.py<br/>RESEARCH_PROMPT"]

    REPO --> HIST["history.py<br/>snapshot append"]

    STRAT --> MODELS
    API --> MODELS
    REPO --> MODELS
    BATCH --> ERR

    subgraph foundation["Foundation (no upward imports)"]
        MODELS["models.py<br/>ResearchResult (pydantic)"]
        CFG["config.py<br/>Settings + constants"]
        ERR["errors.py<br/>FatalAPIError"]
        NAMES["names.py<br/>CountryNames"]
    end

    CLI --> CFG
    CLI --> NAMES
    REPO --> CFG
```

### Module map

| Module | Responsibility |
|--------|----------------|
| `cli.py` | Typer command: flags, logging setup, dependency wiring, exit codes |
| `service.py` | `PipelineService` — select → research → validate → persist |
| `strategies.py` | `ResearchStrategy` ABC + `SyncStrategy` / `BatchStrategy` |
| `api.py` | `ResearchClient` — build request params, parse the response |
| `batch.py` | `BatchRunner` — Message Batches submit/poll/classify + salvage |
| `retry.py` | Reusable transient-error retry policy |
| `prompt.py` | The research prompt template + rendering |
| `models.py` | `ResearchResult` pydantic model — schema, validation, projections |
| `repository.py` | `Dataset` — load/apply/validate/atomic-save the four stores |
| `history.py` | History snapshot append + change detection |
| `staleness.py` | `StalenessPolicy` — which countries need re-research |
| `names.py` | `CountryNames` — country-name normalization |
| `config.py` | `Settings` (repo-root paths) + field/threshold/priority constants |
| `errors.py` | `FatalAPIError` |

---

## End-to-end run

A single run, from invocation to written files. The strategy is a **generator**,
so each answer is validated and committed as it arrives — which is what lets a
fatal abort still save the countries completed so far.

```mermaid
sequenceDiagram
    autonumber
    actor U as User / GitHub Action
    participant CLI as cli.py
    participant SVC as PipelineService
    participant ST as ResearchStrategy
    participant API as Claude API
    participant DS as Dataset

    U->>CLI: update_data.py --batch --force
    CLI->>DS: Dataset.load(settings, names)
    CLI->>SVC: select(targets, force)
    SVC->>DS: scores_row / regulation_row per country
    SVC-->>CLI: to_update
    CLI->>SVC: run(strategy, to_update)

    loop for each yielded answer
        SVC->>ST: research(countries, reg_rows)
        ST->>API: messages.create / messages.batches
        API-->>ST: raw JSON (structured output)
        ST->>ST: ResearchResult.model_validate
        ST-->>SVC: (country, result | None)
        alt result is valid
            SVC->>DS: apply(country, result, today)
        else None / apply error
            SVC->>SVC: record as failed
        end
    end

    SVC->>DS: validate()
    SVC->>DS: save() — atomic temp + os.replace
    DS-->>U: scores.csv, regulation_data.csv, history.json, subscores.json
```

Exit codes: `0` success, `1` some countries failed, `2` fatal (systemic) — with
partial progress saved.

---

## Domain model

`ResearchResult` is the **single source of truth**: it generates the
structured-output JSON schema handed to the API, validates responses, and computes
every projection (dimension means, maturity composite, confidence). Each dimension
is four named sub-indicators (integers 1–5); the dimension score is their mean.

```mermaid
classDiagram
    class ResearchResult {
        +RegulationStatus regulation_status
        +PolicyLever policy_lever
        +GovernanceType governance_type
        +ActorInvolvement actor_involvement
        +EnforcementLevel enforcement_level
        +str specific_laws
        +str sources
        +str confidence
        +dimensions() dict
        +dimension_scores() dict
        +average_score() float
        +effective_confidence() str
        +output_schema() dict$
    }
    class Dimension {
        <<abstract>>
        +str key
        +str history_key
        +bool normative
        +str text
        +subindicators() tuple$
        +subscores() dict
        +score() float
    }
    Dimension <|-- RegulationStatus
    Dimension <|-- PolicyLever
    Dimension <|-- GovernanceType
    Dimension <|-- ActorInvolvement
    Dimension <|-- EnforcementLevel
    ResearchResult *-- "5" Dimension

    note for ResearchResult "average_score = mean of the three\nnormative dimensions only\n(governance_type & actor_involvement\nare descriptive, excluded)"
```

Scores are typed `Literal[1..5]` (rendered as an `enum` in the schema, since
structured outputs don't support `minimum`/`maximum`) with a `BeforeValidator` that
rejects booleans — so a malformed response raises instead of landing an empty CSV
cell.

---

## Strategy pattern

Two interchangeable research backends behind one generator interface. The service
never branches on sync-vs-batch — it just consumes `(country, result | None)`.

```mermaid
classDiagram
    class ResearchStrategy {
        <<abstract>>
        +research(countries, reg_rows) Iterator
    }
    class SyncStrategy {
        -ResearchClient client
        -int max_consecutive_failures
        +research(...) Iterator
    }
    class BatchStrategy {
        -ResearchClient client
        -BatchRunner runner
        +research(...) Iterator
    }
    ResearchStrategy <|-- SyncStrategy
    ResearchStrategy <|-- BatchStrategy
    PipelineService --> ResearchStrategy : uses
    SyncStrategy --> ResearchClient
    BatchStrategy --> ResearchClient
    BatchStrategy --> BatchRunner
```

- **`SyncStrategy`** — one call per country; aborts the run (`FatalAPIError`) after
  N consecutive failures of *any* kind (transient, unparseable, or schema-invalid).
- **`BatchStrategy`** — submits all countries at once (50% token pricing); per-request
  results mean a bad country costs one country, not the run — so there is no
  consecutive-failure abort.

---

## Repository and the data contract

The four stores always travel together, so one object owns them. `apply` folds a
validated result into all four; `save` writes them **atomically** (temp file +
`os.replace`) so an interrupted run can't leave a half-written file.

```mermaid
flowchart LR
    RES["ResearchResult<br/>(validated)"] -->|"apply(country, result, today)"| DS

    subgraph DS["Dataset (in-memory)"]
        direction TB
        S["scores"]
        R["regulation"]
        H["history"]
        SS["subscores"]
    end

    DS -->|save · atomic| F1["public/scores.csv"]
    DS -->|save · atomic| F2["public/regulation_data.csv"]
    DS -->|save · atomic| F3["public/history.json"]
    DS -->|save · atomic| F4["public/data/subscores.json"]

    F1 --> FE["Frontend loaders<br/>src/data/*.ts"]
    F2 --> FE
    F3 --> FE
    F4 --> FE
```

> **Byte-format is a contract.** CSVs use the csv module's `\r\n`; the JSON files
> have no trailing newline; `subscores.json` is `sort_keys=True`; `history.json`
> preserves snapshot key order. An unchanged run re-writes every file byte-for-byte
> identically (there's a test that asserts exactly this). Preserve this when
> touching `repository.py`.

---

## Staleness selection

`PipelineService.select` filters the target countries through `StalenessPolicy`
before any API call — the reference date is injected so a run has one consistent
"today".

```mermaid
flowchart TD
    A["country"] --> B{"--force?"}
    B -- yes --> U["needs update"]
    B -- no --> C{"regulation data<br/>all empty / NA?"}
    C -- yes --> U
    C -- no --> D{"confidence == low?"}
    D -- yes --> U
    D -- no --> E{"Last Updated missing<br/>or unparseable?"}
    E -- yes --> U
    E -- no --> F{"older than<br/>staleness_days (90)?"}
    F -- yes --> U
    F -- no --> K["skip (fresh)"]
```

---

## Batch lifecycle

`BatchRunner` submits, polls to completion, and classifies each result. On timeout
it **cancels and salvages** the requests that already succeeded (and were already
billed) instead of discarding the run.

```mermaid
stateDiagram-v2
    [*] --> Submitted: batches.create
    Submitted --> Polling
    Polling --> Polling: retrieve · in_progress
    Polling --> Ended: status == ended
    Polling --> Canceling: waited >= max_wait
    Canceling --> Ended: drain within grace
    Canceling --> AllRetryable: grace exhausted
    Ended --> Classify: results()
    Classify --> [*]: succeeded to messages<br/>invalid_request to fatal<br/>canceled/expired to retryable
    AllRetryable --> [*]

    note right of Classify
        research() then retries the
        retryable set once in a
        second, smaller batch
    end note
```

---

## Retry policy

`call_with_retries` wraps a single API call. The SDK's own retries are disabled
(`max_retries=0`) so these are the only attempts and every one is logged.

```mermaid
flowchart TD
    A["call()"] --> B{"exception?"}
    B -- none --> R["return result"]
    B -- "Auth / Permission / 4xx" --> F["raise FatalAPIError"]
    B -- "RateLimit / Timeout / Connection / 5xx" --> C{"last attempt?"}
    C -- yes --> N["return None"]
    C -- no --> D["sleep: Retry-After header,<br/>else exponential backoff + jitter"]
    D --> A
```

`Retry-After` is honored on **every** retryable error, including 5xx/overloaded.

---

## Testing & tooling

```bash
python -m pytest        # tests/pipeline/ — 90+ tests, no network (fakes throughout)
ruff check scripts/regulation_pipeline
pip install -e .        # installs the package + update-regulation-data console script
```

Every layer has a seam for testing: `Settings(root=tmp_path)` redirects all I/O,
strategies take a stub `ResearchClient`, the batch poll loop takes an injected
`sleep`, and the retry policy takes an injected clock. The CI workflow
(`.github/workflows/update-data.yml`) commits whatever data completed even when a
run reports failures, so a single failed country never discards the month's work.
