# Manuscript Reading Architecture

This document defines the future manuscript reading architecture for the app after imported manuscript structure can be inspected and trusted. It is a product and technical planning document only. It does not change runtime behavior, UI behavior, routes, Prisma schema, tests, or pipeline behavior.

## Product Goal

The app should read a full manuscript like an editor, not like a one-off text completion tool. It should build a durable editorial understanding of the book, then use that understanding to guide revision.

The target experience is that the app can:

- Understand the book as a whole: premise, genre expectations, structure, major arcs, themes, promises, and payoffs.
- Understand chapters and sections: what each unit contributes, where it sits in the larger argument or story, and whether it advances the manuscript.
- Understand scenes and chunks: local purpose, dramatic movement, information flow, character state changes, pacing, style, and continuity facts.
- Track characters across the manuscript: goals, relationships, emotional state, knowledge state, decisions, contradictions, and unresolved threads.
- Track continuity: timeline, locations, objects, names, facts, rules, world details, and causal dependencies.
- Track pacing: intensity, scene density, exposition load, repetition, escalation, and recovery.
- Track style and voice: point of view, tense, diction, sentence texture, dialogue habits, imagery, rhythm, and recurring stylistic constraints.
- Track theme: stated and implied thematic material, recurring motifs, argument progression, and places where theme is underdeveloped or overexplained.
- Identify editorial problems: structural gaps, unclear causality, weak scene function, inconsistency, repetition, missing setup, missing payoff, tonal drift, and voice risk.
- Guide the user through revision with the next-best editorial action, including why it matters, what evidence supports it, and what decision is needed from the author.

The app should behave as an editorial operating system for full manuscripts. Its core output is not only analysis, but an evolving revision map that helps the author decide what to do next.

## Analysis Levels

### Chunk Level

A chunk is the smallest analysis unit used for volume processing. It may be a scene, partial scene, section slice, or bounded text span produced by the import/chunking pipeline.

Chunk-level analysis should extract:

- A concise summary of what happens or what is argued.
- The chunk's local function, such as setup, escalation, reveal, reflection, transition, reversal, exposition, argument, evidence, or payoff.
- Point-of-view and tense signals.
- Character appearances and local character states.
- New or changed continuity facts.
- Open questions introduced or carried forward.
- Pacing signals, including intensity, density, momentum, and exposition load.
- Style and voice observations, especially unusual deviations from nearby text.
- Potential editorial findings that can be evaluated at higher levels.

Chunk analysis should be cheap, repeatable, and narrow. It should avoid global conclusions unless the evidence is explicit in the chunk.

### Section and Chapter Level

A section or chapter is the first level where the app should reason about shape, movement, and internal coherence.

Section/chapter analysis should produce:

- A section summary built from chunk summaries and selected source excerpts.
- A map of scenes or functional beats.
- The section's role in the manuscript.
- Character movement across the section.
- Continuity updates and contradictions detected within the section.
- Pacing shape: opening state, escalation, midpoint movement, ending state, and drag points.
- Setup/payoff activity within the section.
- Repetition, redundancy, or missing transitions.
- Editorial findings ranked by severity and confidence.
- Dependencies on earlier or later sections.

This level should decide whether the section is doing useful manuscript work. It should not assume the whole-book answer is available, but it should prepare structured evidence for whole-book synthesis.

### Whole-Book Level

Whole-book analysis should synthesize the durable outputs of lower levels instead of rereading the entire raw manuscript every time.

Whole-book analysis should produce:

- A book-level summary.
- Structural map of parts, chapters, sections, scenes, and major turns.
- Primary and secondary arcs.
- Global character arcs and relationship arcs.
- Theme map and motif map.
- Pacing map across the full manuscript.
- Setup/payoff map.
- Continuity risk register.
- Style and voice profile.
- Priority-ranked editorial findings.
- Global rewrite plan.
- Next-best editorial action.

Whole-book synthesis should resolve conflicts between lower-level findings, identify patterns that are invisible locally, and decide which issues matter most for revision.

### Character Level

Character analysis should be entity-centered and cumulative.

For each important character, the app should track:

- Names, aliases, roles, and relationships.
- First appearance and key appearances.
- Goals, motivations, fears, wounds, or core arguments, depending on genre.
- Knowledge state over time.
- Emotional state over time.
- Relationship state over time.
- Decisions and consequences.
- Promises made to the reader about the character.
- Setups and payoffs tied to the character.
- Apparent contradictions or continuity risks.
- Arc summary and unresolved arc questions.

Character state should be versioned or traceable to manuscript locations so later changes can update the record without losing evidence.

### Continuity Level

Continuity analysis should maintain a structured fact layer over the manuscript.

Continuity tracking should include:

- Timeline facts.
- Location facts.
- Character facts.
- Object and prop facts.
- World, rule, or setting facts.
- Backstory facts.
- Cause-and-effect dependencies.
- Naming and terminology consistency.
- Open continuity questions.
- Contradictions, confidence, and evidence locations.

Continuity findings should distinguish between confirmed contradictions, possible ambiguity, and intentional mystery. The app should ask for author decisions when intent cannot be inferred safely.

### Style and Voice Level

Style and voice analysis should protect the manuscript's existing artistic identity.

Style/voice analysis should produce:

- POV profile.
- Tense profile.
- Dialogue profile.
- Prose rhythm profile.
- Diction and register profile.
- Imagery and metaphor patterns.
- Sentence-level tendencies.
- Allowed roughness or deliberate stylistic signatures.
- Voice drift warnings.
- Voice lock constraints for rewrite suggestions.

The style layer should be descriptive before it is prescriptive. Its job is to preserve intentional voice while identifying places where the prose works against the author's apparent design.

### Rewrite Planning Level

Rewrite planning should translate analysis into decisions and scoped actions.

Rewrite planning should produce:

- A global rewrite plan organized by priority.
- Chapter-level revision goals.
- Scene-level or chunk-level intervention candidates.
- Dependencies between revisions.
- Decision points that require author input.
- Accepted, rejected, and deferred editorial decisions.
- A next-best editorial action with rationale and evidence.
- Rewrite context packages for any suggested edits.

Rewrite planning should prefer structural and causal fixes before line-level rewriting. It should avoid generating prose until the relevant structure is trustworthy and the author has accepted the direction.

## Model Orchestration

The architecture should use multiple model roles instead of sending every task to one model. Exact model names should remain configuration-driven where the project uses environment variables for model selection.

### Volume Model

Use a small, cheap model for high-volume work.

Good responsibilities:

- Chunk summaries.
- Entity mentions.
- Basic scene or chunk function labels.
- Local continuity fact extraction.
- Pacing signal extraction.
- Style signal extraction.
- Candidate issue detection.
- Embedding-adjacent classification or labeling tasks.

The volume model should produce constrained structured outputs. It should not make final editorial judgments for the whole manuscript.

### Section Editor Model

Use a stronger model for chapter and section analysis.

Good responsibilities:

- Combine chunk outputs into section-level summaries.
- Identify section structure and movement.
- Judge scene function within a chapter.
- Detect chapter-level continuity issues.
- Produce chapter-level pacing and character movement.
- Rank local editorial findings.
- Prepare chapter evidence for whole-book synthesis.

The section editor model should receive chapter-specific context packages, not the whole manuscript by default.

### Chief Editor Model

Use the strongest model as the chief editor.

Good responsibilities:

- Whole-book synthesis.
- Priority ranking across competing issues.
- Conflict resolution between lower-level analyses.
- Global rewrite planning.
- Next-best editorial action.
- Editorial decision framing.
- High-risk rewrite suggestions when structure, context, and voice lock are available.

The chief editor model should act on curated context packages. It should see enough evidence to reason well, but it should not reread the entire raw manuscript for every request.

### Orchestration Principles

- Store intermediate analysis so models can build on durable outputs.
- Prefer structured outputs with stable schemas for downstream use.
- Keep raw manuscript excerpts small and targeted.
- Re-run only invalidated analysis when manuscript text or structure changes.
- Escalate to stronger models when a decision affects global structure, author voice, or multiple manuscript systems.
- Track confidence and evidence locations for editorial findings.
- Keep author decisions as first-class state.

## Data Outputs to Store

The app should persist stable, composable outputs that can support future analysis, UI inspection, and revision workflows.

Recommended durable outputs:

- Chunk summaries.
- Section summaries.
- Chapter summaries.
- Whole-book summary.
- Scene functions.
- Section and chapter functions.
- Character states.
- Character arcs.
- Relationship states.
- Continuity facts.
- Continuity contradictions and open questions.
- Unresolved editorial findings.
- Resolved editorial findings.
- Pacing map.
- Setup/payoff map.
- Theme map.
- Motif map.
- Style profile.
- Voice lock.
- Global rewrite plan.
- Chapter rewrite plans.
- Next-best editorial action.
- Rewrite context packages or enough stored ingredients to reproduce them.
- Accepted decisions.
- Rejected decisions.
- Deferred decisions.
- Evidence references back to manuscript structure.
- Analysis provenance, including model role, prompt version, input version, and timestamp.

These outputs should be designed for invalidation. If a chunk changes, chunk-level outputs should be replaced, section-level outputs should be marked stale, and whole-book synthesis should know which inputs changed.

## Context Package Design

The strongest model should avoid reading the entire raw manuscript every time. Instead, the app should assemble context packages that contain the smallest useful set of structured analysis, evidence, constraints, and author decisions for the requested task.

A context package should generally include:

- Task goal.
- Relevant manuscript structure.
- Stable summaries.
- Selected source excerpts.
- Current findings and decisions.
- Character and continuity state relevant to the task.
- Style profile and voice lock when prose suggestions are possible.
- Known constraints and non-goals.
- Required output shape.

### Chapter Analysis Package

Purpose: analyze one chapter or section in context.

Inputs:

- Chapter metadata and position in the book.
- Chunk summaries for the chapter.
- Selected raw excerpts for key openings, endings, turns, and flagged chunks.
- Previous chapter summary.
- Next chapter summary if available.
- Relevant character states before and after the chapter.
- Relevant continuity facts entering the chapter.
- Current style profile and POV/tense expectations.

Outputs:

- Chapter summary.
- Chapter function.
- Scene or beat map.
- Character movement.
- Continuity updates and risks.
- Pacing observations.
- Editorial findings with evidence.
- Chapter-level revision candidates.

### Global Book Synthesis Package

Purpose: synthesize the manuscript as a whole.

Inputs:

- Manuscript structure map.
- Section/chapter summaries.
- Scene functions.
- Character arc summaries.
- Continuity risk register.
- Pacing map.
- Theme and motif map.
- Style profile.
- Existing unresolved findings.
- Accepted, rejected, and deferred decisions.

Outputs:

- Whole-book summary.
- Global structure assessment.
- Priority-ranked editorial findings.
- Conflict resolution notes.
- Global rewrite plan.
- Recommended next-best editorial action.

### Next-Best Editorial Action Package

Purpose: decide the single most useful next action for the author.

Inputs:

- Current global rewrite plan.
- Unresolved findings ranked by severity, confidence, and dependency.
- Author decisions to date.
- Recently completed actions.
- Blocked or deferred items.
- Manuscript areas with stale analysis.
- User goal or current workspace focus if known.

Outputs:

- One next-best editorial action.
- Why this action matters now.
- Evidence summary.
- Expected impact.
- Dependencies.
- Suggested author decision, if needed.
- Alternative action if the author rejects the recommendation.

### Rewrite Suggestion Package

Purpose: generate a scoped rewrite suggestion after structure and author intent are clear.

Inputs:

- Specific target passage or scene.
- Local chunk and section summaries.
- Scene function and intended revision goal.
- Relevant character states and continuity facts.
- Accepted author decisions.
- Voice lock.
- POV and tense constraints.
- Nearby manuscript excerpts for style continuity.
- Explicit instruction to preserve author voice.

Outputs:

- Rewrite goal.
- Minimal suggested revision.
- Explanation of what changed and why.
- Risks or assumptions.
- Optional alternatives when the decision is creative rather than corrective.

Rewrite packages should be narrow. They should not invite broad stylistic replacement of the manuscript.

### Continuity Check Package

Purpose: evaluate whether a proposed change or existing passage conflicts with established facts.

Inputs:

- Target passage, scene, or proposed change.
- Relevant continuity facts.
- Character knowledge states.
- Timeline and location state.
- Related prior and later scenes.
- Accepted author decisions.
- Known intentional mysteries or unreliable narration markers.

Outputs:

- Confirmed continuity conflicts.
- Possible ambiguities.
- No-conflict confirmation when appropriate.
- Evidence references.
- Suggested fix paths.
- Author decision questions where intent is unclear.

## Safety and Voice-Lock Principles

The app should protect the author's voice and creative authority.

Core principles:

- Preserve point of view unless the author explicitly asks to change it.
- Preserve tense unless the author explicitly asks to change it.
- Preserve character perspective, knowledge limits, and narrative distance.
- Do not simplify prose unnecessarily.
- Do not smooth away intentional roughness, fragmentation, rhythm, dialect, register, or stylistic pressure.
- Prefer structural suggestions before stylistic overwriting.
- Prefer diagnosis before rewrite.
- Prefer targeted edits before broad replacement.
- Use manuscript context for rewrites.
- Do not imitate corpus authors.
- Use reference material only for pattern awareness, comparison, or craft framing, not mimicry.
- Label assumptions when author intent is uncertain.
- Ask for author decisions before making changes that alter meaning, voice, chronology, characterization, or theme.

Voice lock should be a durable set of constraints built from the manuscript itself and accepted author preferences. It should inform rewrite suggestions, continuity checks, and editorial recommendations.

## Implementation Phases

### Phase 1: Import Inspector / Structure UI

Build the UI that lets users inspect imported manuscript structure before deeper analysis depends on it.

Expected outcome:

- Users can see detected parts, chapters, sections, scenes, and chunks.
- Users can identify obvious structure problems.
- The app has a trusted source of structure for later analysis.

### Phase 2: Deterministic Structure Validation

Add deterministic validation before model analysis.

Expected outcome:

- Detect missing titles, duplicate labels, empty sections, suspicious chunk boundaries, malformed hierarchy, and ordering issues.
- Separate parser/import problems from editorial problems.
- Prevent expensive analysis when structure is not trustworthy.

### Phase 3: Chunk and Section Summaries

Add the first durable reading layer.

Expected outcome:

- Generate and persist chunk summaries.
- Generate and persist section/chapter summaries.
- Extract scene functions, character mentions, continuity facts, and pacing signals.
- Mark stale summaries when source text or structure changes.

### Phase 4: Whole-Book Synthesis

Add global manuscript understanding.

Expected outcome:

- Synthesize section outputs into whole-book summary and structure map.
- Produce character arcs, pacing map, theme map, setup/payoff map, and continuity risk register.
- Rank unresolved editorial findings globally.

### Phase 5: Next-Best Editorial Action

Turn analysis into an editorial workflow.

Expected outcome:

- Recommend the highest-value next action.
- Explain evidence, impact, and dependencies.
- Distinguish actions the app can support from decisions the author must make.

### Phase 6: Decision Loop

Make author decisions durable.

Expected outcome:

- Track accepted, rejected, and deferred recommendations.
- Feed decisions back into future analysis.
- Avoid repeatedly suggesting rejected directions.
- Use accepted decisions as constraints for rewrite planning.

### Phase 7: Echo Engine

Detect and manage recurrence across the manuscript.

Expected outcome:

- Track repeated motifs, phrases, images, ideas, beats, and emotional patterns.
- Distinguish intentional echo from accidental repetition.
- Connect setup/payoff, theme development, and stylistic recurrence.
- Suggest where echoes should be strengthened, reduced, moved, or clarified.

### Phase 8: Rewrite Context Packages

Enable safe, scoped rewrite suggestions.

Expected outcome:

- Build context packages for targeted rewrite tasks.
- Include voice lock, local manuscript context, continuity state, and author decisions.
- Generate minimal, purpose-driven suggestions.
- Keep rewrite suggestions traceable to accepted editorial goals.

### Phase 9: Corpus and Reference Pattern Support

Add optional reference support after the manuscript-native architecture works.

Expected outcome:

- Support reference patterns for craft comparison, genre expectations, and structural analysis.
- Avoid mass corpus ingestion as a default path.
- Avoid imitating corpus authors.
- Keep the manuscript and author voice as the primary source of truth.

## Non-Goals for Now

The current architecture should explicitly avoid:

- Training a model.
- Mass corpus ingestion.
- One giant prompt with the whole manuscript.
- Rewriting before structure is trustworthy.
- Replacing the author's voice.
- Treating model output as authoritative without evidence.
- Building final prose generation before the decision loop and voice lock exist.
- Making irreversible editorial decisions without author confirmation.

## Planning-Only PR Note

The PR body for this change should state that it is a planning-only document. It should also state that no runtime code, UI code, Prisma schema, routes, tests, package files, or pipeline behavior were changed.
