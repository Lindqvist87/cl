import { AnalysisPassType } from "@prisma/client";
import { hasEditorModelKey, requestEditorJson } from "@/lib/ai/editorModel";
import {
  modelConfigForRole,
  type ModelRole,
  type ReasoningEffort
} from "@/lib/ai/modelConfig";
import { hashJson, hashText } from "@/lib/compiler/hash";
import { jsonInput } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { countWords } from "@/lib/text/wordCount";
import type { JsonRecord } from "@/lib/types";

const PROMPT_VERSION = "compiler-v1";

type StepOptions = {
  maxItems?: number;
};

type CompilerResult<T> = {
  json: T;
  rawText: string;
  model: string;
  reasoningEffort: ReasoningEffort;
};

type SceneDigest = JsonRecord & {
  summary?: string;
  scenePurpose?: string;
  emotionalMovement?: string;
  conflict?: string;
  tensionLevel?: number;
  characterAppearances?: unknown[];
  keyEvents?: unknown[];
  continuityFacts?: unknown[];
  openThreads?: unknown[];
  styleNotes?: string | string[];
  mustNotForget?: unknown[];
  uncertainties?: unknown[];
  sourceAnchors?: unknown[];
};

type ChapterCapsule = JsonRecord & {
  chapterSummary?: string;
  chapterFunction?: string;
  characterMovement?: unknown;
  plotMovement?: unknown;
  pacingAssessment?: string;
  continuityRisks?: unknown[];
  styleFingerprint?: unknown;
  revisionPressure?: unknown;
  mustPreserve?: unknown[];
  suggestedEditorialFocus?: unknown[];
};

type WholeBookMap = JsonRecord & {
  bookPremise?: string;
  whatTheBookIsTryingToBe?: string;
  structureMap?: unknown;
  mainArc?: unknown;
  characterArcs?: unknown;
  themeMap?: unknown;
  pacingCurve?: unknown;
  continuityRiskMap?: unknown;
  topStructuralIssues?: unknown[];
  topVoiceRisks?: unknown[];
  topCommercialRisks?: unknown[];
  revisionStrategy?: string;
  confidence?: number;
  uncertainties?: unknown[];
};

type NextBestActions = JsonRecord & {
  actions?: Array<{
    title?: string;
    reason?: string;
    scope?: string;
    chapterId?: string | null;
    priority?: number | string;
    impactOnWhole?: string;
    riskIfIgnored?: string;
    suggestedNextStep?: string;
  }>;
};

export async function compileSceneDigests(
  manuscriptId: string,
  options: StepOptions = {}
) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } }
    }
  });
  const scenes = await prisma.scene.findMany({
    where: { manuscriptId },
    orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
    include: {
      chapter: true,
      paragraphs: { orderBy: { globalOrder: "asc" } }
    }
  });
  const pending = [];

  for (const scene of scenes) {
    const sceneText = scene.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
    const inputHash = sceneDigestInputHash(manuscript, scene, sceneText);
    const existing = await prisma.compilerArtifact.findFirst({
      where: {
        manuscriptId,
        artifactType: "SCENE_DIGEST",
        inputHash
      }
    });

    if (!existing) {
      pending.push({ scene, sceneText, inputHash });
    }
  }

  const maxItems = normalizeMaxItems(options.maxItems, pending.length);
  let compiled = 0;

  for (const item of pending.slice(0, maxItems)) {
    const node = await prisma.manuscriptNode.findFirst({
      where: { manuscriptId, sceneId: item.scene.id, type: "SCENE" }
    });
    const result = await requestCompilerJson<SceneDigest>({
      role: "sceneAnalysis",
      stub: () => stubSceneDigest(item.scene.title, item.sceneText),
      system: [
        "You are compiling durable scene memory for an editorial manuscript system.",
        "Return strict JSON only.",
        "Use only this bounded scene and metadata.",
        "Do not analyze or rewrite the whole book."
      ].join(" "),
      user: JSON.stringify(
        {
          task: "Create a scene digest for persistent manuscript memory.",
          requiredShape: {
            summary: "short scene summary",
            scenePurpose: "why this scene exists",
            emotionalMovement: "emotional movement",
            conflict: "active conflict",
            tensionLevel: "0-1",
            characterAppearances: ["names and state changes"],
            keyEvents: ["important story events"],
            continuityFacts: ["facts to preserve"],
            openThreads: ["threads opened or still unresolved"],
            styleNotes: ["local voice/style observations"],
            mustNotForget: ["continuity-critical details"],
            uncertainties: ["anything unclear"],
            sourceAnchors: ["short source anchor labels only"]
          },
          manuscript: {
            title: manuscript.title,
            targetGenre: manuscript.targetGenre,
            targetAudience: manuscript.targetAudience
          },
          chapter: {
            id: item.scene.chapterId,
            title: item.scene.chapter.title,
            order: item.scene.chapter.order
          },
          scene: {
            id: item.scene.id,
            title: item.scene.title,
            order: item.scene.order,
            wordCount: item.scene.wordCount,
            text: item.sceneText
          }
        },
        null,
        2
      )
    });

    const artifact = await saveCompilerArtifact({
      manuscriptId,
      nodeId: node?.id,
      chapterId: item.scene.chapterId,
      sceneId: item.scene.id,
      artifactType: "SCENE_DIGEST",
      inputHash: item.inputHash,
      result
    });

    await saveSceneMemoryFromDigest({
      manuscriptId,
      nodeId: node?.id ?? null,
      chapterId: item.scene.chapterId,
      sceneId: item.scene.id,
      digest: result.json,
      sourceArtifactId: artifact.id
    });

    await prisma.manuscriptNode.updateMany({
      where: { manuscriptId, sceneId: item.scene.id, type: "SCENE" },
      data: {
        summaryShort: stringOrNull(result.json.summary),
        summaryLong: JSON.stringify({
          scenePurpose: result.json.scenePurpose,
          emotionalMovement: result.json.emotionalMovement,
          conflict: result.json.conflict
        }),
        metrics: jsonInput({ tensionLevel: result.json.tensionLevel })
      }
    });
    compiled += 1;
  }

  const remaining = Math.max(pending.length - compiled, 0);
  return { compiled, total: scenes.length, remaining, complete: remaining === 0 };
}

export async function extractNarrativeMemory(
  manuscriptId: string,
  options: StepOptions = {}
) {
  const artifacts = await prisma.compilerArtifact.findMany({
    where: { manuscriptId, artifactType: "SCENE_DIGEST", status: "COMPLETED" },
    orderBy: { createdAt: "asc" }
  });
  const maxItems = normalizeMaxItems(options.maxItems, artifacts.length);
  let refreshed = 0;

  for (const artifact of artifacts.slice(0, maxItems)) {
    if (!artifact.sceneId) {
      continue;
    }

    await saveSceneMemoryFromDigest({
      manuscriptId,
      nodeId: artifact.nodeId,
      chapterId: artifact.chapterId,
      sceneId: artifact.sceneId,
      digest: toRecord(artifact.output),
      sourceArtifactId: artifact.id
    });
    refreshed += 1;
  }

  const remaining = Math.max(artifacts.length - refreshed, 0);
  return {
    refreshed,
    total: artifacts.length,
    remaining,
    complete: remaining === 0
  };
}

export async function compileChapterCapsules(
  manuscriptId: string,
  options: StepOptions = {}
) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      profile: true
    }
  });
  const pending = [];

  for (const chapter of manuscript.chapters) {
    const sceneDigests = await prisma.compilerArtifact.findMany({
      where: {
        manuscriptId,
        chapterId: chapter.id,
        artifactType: "SCENE_DIGEST",
        status: "COMPLETED"
      },
      orderBy: { createdAt: "asc" }
    });
    const facts = await prisma.narrativeFact.findMany({
      where: { manuscriptId, chapterId: chapter.id, status: "ACTIVE" },
      take: 80
    });
    const events = await prisma.plotEvent.findMany({
      where: { manuscriptId, chapterId: chapter.id },
      take: 80
    });
    const inputPackage = {
      chapter: {
        id: chapter.id,
        title: chapter.title,
        chapterIndex: chapter.chapterIndex || chapter.order,
        wordCount: chapter.wordCount,
        summary: chapter.summary
      },
      sceneDigests: sceneDigests.map((artifact) => artifact.output),
      facts: facts.map(compactFact),
      events: events.map(compactEvent),
      profile: compactProfile(manuscript.profile),
      previousCapsule: await previousChapterCapsule(manuscriptId, chapter.order)
    };
    const inputHash = hashJson(inputPackage);
    const existing = await prisma.compilerArtifact.findFirst({
      where: { manuscriptId, artifactType: "CHAPTER_CAPSULE", inputHash }
    });

    if (!existing) {
      pending.push({ chapter, inputPackage, inputHash });
    }
  }

  const maxItems = normalizeMaxItems(options.maxItems, pending.length);
  let compiled = 0;

  for (const item of pending.slice(0, maxItems)) {
    const node = await prisma.manuscriptNode.findFirst({
      where: { manuscriptId, chapterId: item.chapter.id, type: "CHAPTER" }
    });
    const result = await requestCompilerJson<ChapterCapsule>({
      role: "chapterCompiler",
      stub: () => stubChapterCapsule(item.chapter.title, item.inputPackage),
      system: [
        "You compile one chapter capsule for persistent manuscript memory.",
        "Return strict JSON only.",
        "Use scene digests, local facts, events, and metrics. Do not request or infer the raw whole manuscript."
      ].join(" "),
      user: JSON.stringify(
        {
          task: "Compile a chapter capsule.",
          requiredShape: {
            chapterSummary: "chapter summary",
            chapterFunction: "structural function",
            characterMovement: "JSON summary",
            plotMovement: "JSON summary",
            pacingAssessment: "pacing assessment",
            continuityRisks: ["risks"],
            styleFingerprint: "JSON object",
            revisionPressure: "low | medium | high plus reason",
            mustPreserve: ["details"],
            suggestedEditorialFocus: ["focus areas"]
          },
          manuscript: {
            title: manuscript.title,
            targetGenre: manuscript.targetGenre,
            targetAudience: manuscript.targetAudience
          },
          context: item.inputPackage
        },
        null,
        2
      )
    });

    await saveCompilerArtifact({
      manuscriptId,
      nodeId: node?.id,
      chapterId: item.chapter.id,
      artifactType: "CHAPTER_CAPSULE",
      inputHash: item.inputHash,
      result
    });
    await prisma.manuscriptChapter.update({
      where: { id: item.chapter.id },
      data: {
        summary: stringOrNull(result.json.chapterSummary) ?? item.chapter.summary,
        status: "COMPILED"
      }
    });
    await prisma.manuscriptNode.updateMany({
      where: { manuscriptId, chapterId: item.chapter.id, type: "CHAPTER" },
      data: {
        summaryShort: stringOrNull(result.json.chapterSummary),
        summaryLong: JSON.stringify(result.json),
        metrics: jsonInput({
          revisionPressure: result.json.revisionPressure,
          styleFingerprint: result.json.styleFingerprint
        })
      }
    });
    compiled += 1;
  }

  const remaining = Math.max(pending.length - compiled, 0);
  return {
    compiled,
    total: manuscript.chapters.length,
    remaining,
    complete: remaining === 0
  };
}

export async function compileWholeBookMap(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: { profile: true }
  });
  const chapterCapsules = await prisma.compilerArtifact.findMany({
    where: { manuscriptId, artifactType: "CHAPTER_CAPSULE", status: "COMPLETED" },
    orderBy: { createdAt: "asc" }
  });
  const facts = await prisma.narrativeFact.findMany({
    where: { manuscriptId, status: "ACTIVE" },
    take: 120
  });
  const events = await prisma.plotEvent.findMany({
    where: { manuscriptId },
    take: 120
  });
  const inputPackage = {
    manuscript: {
      title: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience,
      wordCount: manuscript.wordCount,
      chapterCount: manuscript.chapterCount
    },
    profile: compactProfile(manuscript.profile),
    chapterCapsules: chapterCapsules.map((artifact) => artifact.output),
    facts: facts.map(compactFact),
    events: events.map(compactEvent)
  };
  const inputHash = hashJson(inputPackage);
  const existing = await prisma.compilerArtifact.findFirst({
    where: { manuscriptId, artifactType: "WHOLE_BOOK_MAP", inputHash }
  });

  if (existing) {
    return { reused: true };
  }

  const node = await prisma.manuscriptNode.findFirst({
    where: { manuscriptId, type: "BOOK" }
  });
  const result = await requestCompilerJson<WholeBookMap>({
    role: "wholeBookCompiler",
    stub: () => stubWholeBookMap(inputPackage),
    system: [
      "You compile a whole-book manuscript map from durable memory artifacts.",
      "Return strict JSON only.",
      "Do not ask for or assume raw full-manuscript text."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Compile the whole-book map.",
        requiredShape: {
          bookPremise: "premise",
          whatTheBookIsTryingToBe: "editorial identity",
          structureMap: "JSON map",
          mainArc: "main arc",
          characterArcs: "JSON map",
          themeMap: "JSON map",
          pacingCurve: "JSON curve",
          continuityRiskMap: "JSON map",
          topStructuralIssues: ["issues"],
          topVoiceRisks: ["risks"],
          topCommercialRisks: ["risks"],
          revisionStrategy: "strategy",
          confidence: "0-1",
          uncertainties: ["uncertainties"]
        },
        context: inputPackage
      },
      null,
      2
    )
  });

  await saveCompilerArtifact({
    manuscriptId,
    nodeId: node?.id,
    artifactType: "WHOLE_BOOK_MAP",
    inputHash,
    result
  });
  await prisma.manuscriptNode.updateMany({
    where: { manuscriptId, type: "BOOK" },
    data: {
      summaryShort:
        stringOrNull(result.json.bookPremise) ??
        stringOrNull(result.json.whatTheBookIsTryingToBe),
      summaryLong: JSON.stringify(result.json),
      metrics: jsonInput({
        confidence: result.json.confidence,
        topStructuralIssues: result.json.topStructuralIssues,
        topVoiceRisks: result.json.topVoiceRisks
      })
    }
  });

  return { wholeBookMap: true };
}

export async function createNextBestEditorialActions(manuscriptId: string) {
  const [wholeBookMap, chapterCapsules, findings, rewritePlan] =
    await Promise.all([
      prisma.compilerArtifact.findFirst({
        where: { manuscriptId, artifactType: "WHOLE_BOOK_MAP" },
        orderBy: { createdAt: "desc" }
      }),
      prisma.compilerArtifact.findMany({
        where: { manuscriptId, artifactType: "CHAPTER_CAPSULE" },
        orderBy: { createdAt: "asc" }
      }),
      prisma.finding.findMany({
        where: { manuscriptId, severity: { gte: 4 } },
        orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
        take: 50
      }),
      prisma.rewritePlan.findFirst({
        where: { manuscriptId },
        orderBy: { createdAt: "desc" }
      })
    ]);
  const inputPackage = {
    wholeBookMap: wholeBookMap?.output ?? {},
    chapterCapsules: chapterCapsules.map((artifact) => artifact.output),
    highSeverityFindings: findings.map((finding) => ({
      id: finding.id,
      chapterId: finding.chapterId,
      issueType: finding.issueType,
      severity: finding.severity,
      problem: finding.problem,
      recommendation: finding.recommendation
    })),
    rewritePlan: rewritePlan
      ? {
          id: rewritePlan.id,
          globalStrategy: rewritePlan.globalStrategy,
          chapterPlans: rewritePlan.chapterPlans
        }
      : null
  };
  const inputHash = hashJson(inputPackage);
  const existing = await prisma.compilerArtifact.findFirst({
    where: { manuscriptId, artifactType: "NEXT_BEST_ACTIONS", inputHash }
  });

  if (existing) {
    return { reused: true };
  }

  const result = await requestCompilerJson<NextBestActions>({
    role: "chiefEditor",
    stub: () => stubNextBestActions(inputPackage),
    system: [
      "You are the chief editor choosing next best editorial actions.",
      "Return strict JSON only.",
      "Base actions on compiler memory and findings. Do not generate chapter rewrites."
    ].join(" "),
    user: JSON.stringify(
      {
        task: "Create prioritized next best editorial actions.",
        requiredShape: {
          actions: [
            {
              title: "action title",
              reason: "why this matters",
              scope: "manuscript | chapter | scene",
              chapterId: "optional chapter id",
              priority: "1-5",
              impactOnWhole: "whole-book impact",
              riskIfIgnored: "risk",
              suggestedNextStep: "specific next step"
            }
          ]
        },
        context: inputPackage
      },
      null,
      2
    )
  });

  await saveCompilerArtifact({
    manuscriptId,
    artifactType: "NEXT_BEST_ACTIONS",
    inputHash,
    result
  });
  await createEditorialDecisionsFromActions(manuscriptId, result.json.actions ?? []);

  return { actionCount: result.json.actions?.length ?? 0 };
}

async function requestCompilerJson<T extends JsonRecord>(input: {
  role: ModelRole;
  system: string;
  user: string;
  stub: () => T;
}): Promise<CompilerResult<T>> {
  const roleConfig = modelConfigForRole(input.role);

  if (!hasEditorModelKey()) {
    const json = input.stub();
    return {
      json,
      rawText: JSON.stringify(json),
      model: "stub",
      reasoningEffort: "none"
    };
  }

  const result = await requestEditorJson<T>({
    role: input.role,
    system: input.system,
    user: input.user
  });

  return {
    json: result.json,
    rawText: result.rawText,
    model: result.model,
    reasoningEffort: roleConfig.reasoningEffort
  };
}

async function saveCompilerArtifact(input: {
  manuscriptId: string;
  nodeId?: string | null;
  chapterId?: string | null;
  sceneId?: string | null;
  chunkId?: string | null;
  artifactType: string;
  inputHash: string;
  result: CompilerResult<JsonRecord>;
}) {
  return prisma.compilerArtifact.upsert({
    where: {
      manuscriptId_artifactType_inputHash: {
        manuscriptId: input.manuscriptId,
        artifactType: input.artifactType,
        inputHash: input.inputHash
      }
    },
    create: {
      manuscriptId: input.manuscriptId,
      nodeId: input.nodeId,
      chapterId: input.chapterId,
      sceneId: input.sceneId,
      chunkId: input.chunkId,
      artifactType: input.artifactType,
      model: input.result.model,
      reasoningEffort: input.result.reasoningEffort,
      promptVersion: PROMPT_VERSION,
      inputHash: input.inputHash,
      output: jsonInput(input.result.json),
      rawText: input.result.rawText
    },
    update: {
      nodeId: input.nodeId,
      chapterId: input.chapterId,
      sceneId: input.sceneId,
      chunkId: input.chunkId,
      model: input.result.model,
      reasoningEffort: input.result.reasoningEffort,
      promptVersion: PROMPT_VERSION,
      output: jsonInput(input.result.json),
      rawText: input.result.rawText,
      status: "COMPLETED",
      error: null
    }
  });
}

async function saveSceneMemoryFromDigest(input: {
  manuscriptId: string;
  nodeId?: string | null;
  chapterId?: string | null;
  sceneId: string;
  digest: JsonRecord;
  sourceArtifactId: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.narrativeFact.deleteMany({
      where: { manuscriptId: input.manuscriptId, sceneId: input.sceneId }
    });
    await tx.characterState.deleteMany({
      where: { manuscriptId: input.manuscriptId, sceneId: input.sceneId }
    });
    await tx.plotEvent.deleteMany({
      where: { manuscriptId: input.manuscriptId, sceneId: input.sceneId }
    });
    await tx.styleFingerprint.deleteMany({
      where: { manuscriptId: input.manuscriptId, sceneId: input.sceneId }
    });

    const continuityFacts = arrayValue(input.digest.continuityFacts);
    if (continuityFacts.length > 0) {
      await tx.narrativeFact.createMany({
        data: continuityFacts.map((fact) => ({
          manuscriptId: input.manuscriptId,
          nodeId: input.nodeId,
          chapterId: input.chapterId,
          sceneId: input.sceneId,
          factType: "CONTINUITY",
          factText: factText(fact),
          subject: stringOrNull(toRecord(fact).subject),
          predicate: stringOrNull(toRecord(fact).predicate),
          object: stringOrNull(toRecord(fact).object),
          confidence: numberOrDefault(toRecord(fact).confidence, 0.7),
          sourceTextSnippet: stringOrNull(toRecord(fact).sourceTextSnippet),
          metadata: jsonInput({ sourceArtifactId: input.sourceArtifactId })
        }))
      });
    }

    const characters = arrayValue(input.digest.characterAppearances);
    if (characters.length > 0) {
      await tx.characterState.createMany({
        data: characters.map((character) => {
          const record = toRecord(character);
          const name =
            stringOrNull(record.characterName) ??
            stringOrNull(record.name) ??
            factText(character);

          return {
            manuscriptId: input.manuscriptId,
            nodeId: input.nodeId,
            chapterId: input.chapterId,
            sceneId: input.sceneId,
            characterName: name.slice(0, 240),
            canonicalName: stringOrNull(record.canonicalName) ?? name.slice(0, 240),
            goals: jsonInput(record.goals ?? null),
            fears: jsonInput(record.fears ?? null),
            knowledge: jsonInput(record.knowledge ?? null),
            secrets: jsonInput(record.secrets ?? null),
            relationships: jsonInput(record.relationships ?? null),
            emotionalState: stringOrNull(record.emotionalState),
            deltaFromPrevious: stringOrNull(record.deltaFromPrevious),
            confidence: numberOrDefault(record.confidence, 0.6),
            metadata: jsonInput({ sourceArtifactId: input.sourceArtifactId })
          };
        })
      });
    }

    const events = arrayValue(input.digest.keyEvents);
    if (events.length > 0) {
      await tx.plotEvent.createMany({
        data: events.map((event) => {
          const record = toRecord(event);
          return {
            manuscriptId: input.manuscriptId,
            nodeId: input.nodeId,
            chapterId: input.chapterId,
            sceneId: input.sceneId,
            eventText:
              stringOrNull(record.eventText) ??
              stringOrNull(record.text) ??
              factText(event),
            cause: stringOrNull(record.cause),
            consequence: stringOrNull(record.consequence),
            opensThread: stringOrNull(record.opensThread),
            closesThread: stringOrNull(record.closesThread),
            stakes: stringOrNull(record.stakes),
            affectedCharacters: jsonInput(record.affectedCharacters ?? null),
            confidence: numberOrDefault(record.confidence, 0.6),
            metadata: jsonInput({ sourceArtifactId: input.sourceArtifactId })
          };
        })
      });
    }

    await tx.styleFingerprint.create({
      data: {
        manuscriptId: input.manuscriptId,
        nodeId: input.nodeId,
        chapterId: input.chapterId,
        sceneId: input.sceneId,
        scopeType: "SCENE",
        dialogueRatio: numberOrDefault(input.digest.dialogueRatio, 0),
        avgSentenceLength: numberOrDefault(input.digest.avgSentenceLength, 0),
        dominantModes: jsonInput(input.digest.styleNotes ?? []),
        voiceRules: jsonInput(input.digest.mustNotForget ?? []),
        metrics: jsonInput({
          tensionLevel: input.digest.tensionLevel,
          uncertaintyCount: arrayValue(input.digest.uncertainties).length,
          sourceArtifactId: input.sourceArtifactId
        })
      }
    });
  });
}

async function createEditorialDecisionsFromActions(
  manuscriptId: string,
  actions: NonNullable<NextBestActions["actions"]>
) {
  await prisma.editorialDecision.createMany({
    data: actions.slice(0, 20).map((action) => ({
      manuscriptId,
      chapterId: stringOrNull(action.chapterId),
      title: action.title || "Review editorial action",
      rationale: action.reason,
      status: "NEEDS_REVIEW",
      scope: action.scope === "manuscript" ? "MANUSCRIPT" : "CHAPTER",
      metadata: jsonInput({
        priority: action.priority,
        impactOnWhole: action.impactOnWhole,
        riskIfIgnored: action.riskIfIgnored,
        suggestedNextStep: action.suggestedNextStep,
        source: "compiler-v1"
      })
    }))
  });
}

async function previousChapterCapsule(manuscriptId: string, chapterOrder: number) {
  const previousChapter = await prisma.manuscriptChapter.findFirst({
    where: { manuscriptId, order: { lt: chapterOrder } },
    orderBy: { order: "desc" }
  });
  if (!previousChapter) {
    return null;
  }

  const artifact = await prisma.compilerArtifact.findFirst({
    where: {
      manuscriptId,
      chapterId: previousChapter.id,
      artifactType: "CHAPTER_CAPSULE"
    },
    orderBy: { createdAt: "desc" }
  });

  return artifact?.output ?? null;
}

function sceneDigestInputHash(
  manuscript: {
    id: string;
    title: string;
    targetGenre?: string | null;
    targetAudience?: string | null;
  },
  scene: {
    id: string;
    title: string;
    order: number;
    chapterId: string;
    wordCount: number;
  },
  sceneText: string
) {
  return hashJson({
    promptVersion: PROMPT_VERSION,
    manuscript: {
      id: manuscript.id,
      title: manuscript.title,
      targetGenre: manuscript.targetGenre,
      targetAudience: manuscript.targetAudience
    },
    scene: {
      id: scene.id,
      chapterId: scene.chapterId,
      order: scene.order,
      title: scene.title,
      wordCount: scene.wordCount
    },
    textHash: hashText(sceneText)
  });
}

function stubSceneDigest(sceneTitle: string, text: string): SceneDigest {
  const wordCount = countWords(text);
  return {
    summary: `${sceneTitle} contains ${wordCount} words. Live scene digest pending OpenAI configuration.`,
    scenePurpose: "Persistent scene memory placeholder.",
    emotionalMovement: "Pending live analysis.",
    conflict: "Pending live analysis.",
    tensionLevel: 0.4,
    characterAppearances: [],
    keyEvents: [
      {
        eventText: `Scene stored with ${wordCount} words.`,
        confidence: 0.5
      }
    ],
    continuityFacts: [
      {
        factText: `Scene ${sceneTitle} exists in the imported manuscript.`,
        confidence: 0.8
      }
    ],
    openThreads: [],
    styleNotes: [],
    mustNotForget: [],
    uncertainties: ["Live model analysis is not configured."],
    sourceAnchors: []
  };
}

function stubChapterCapsule(title: string, inputPackage: JsonRecord): ChapterCapsule {
  return {
    chapterSummary: `${title} has ${
      arrayValue(inputPackage.sceneDigests).length
    } scene digest(s). Live chapter compilation pending OpenAI configuration.`,
    chapterFunction: "Chapter structure has been imported and stored.",
    characterMovement: {},
    plotMovement: {},
    pacingAssessment: "Pending live analysis.",
    continuityRisks: [],
    styleFingerprint: {},
    revisionPressure: "low until live analysis is configured",
    mustPreserve: [],
    suggestedEditorialFocus: ["Review live compiler output after configuring OpenAI."]
  };
}

function stubWholeBookMap(inputPackage: JsonRecord): WholeBookMap {
  const manuscript = toRecord(inputPackage.manuscript);
  return {
    bookPremise: `${manuscript.title ?? "Manuscript"} has been imported into compiler memory.`,
    whatTheBookIsTryingToBe: "Pending live whole-book compiler pass.",
    structureMap: {},
    mainArc: {},
    characterArcs: {},
    themeMap: {},
    pacingCurve: {},
    continuityRiskMap: {},
    topStructuralIssues: [],
    topVoiceRisks: [],
    topCommercialRisks: [],
    revisionStrategy: "Complete live compiler analysis before choosing structural rewrites.",
    confidence: 0.3,
    uncertainties: ["OpenAI compiler model is not configured."]
  };
}

function stubNextBestActions(inputPackage: JsonRecord): NextBestActions {
  const findings = arrayValue(inputPackage.highSeverityFindings);
  return {
    actions: [
      {
        title: findings.length
          ? "Review highest-severity findings"
          : "Review compiler memory",
        reason: findings.length
          ? `${findings.length} high-severity finding(s) need editorial review.`
          : "The manuscript is imported and ready for chapter-by-chapter review.",
        scope: "manuscript",
        priority: findings.length ? 4 : 2,
        impactOnWhole: "Sets the first focused editorial pass.",
        riskIfIgnored: "Revision work may start without prioritization.",
        suggestedNextStep: "Open the workspace and inspect chapter capsules."
      }
    ]
  };
}

function compactProfile(profile: unknown) {
  const record = toRecord(profile);
  return {
    wordCount: record.wordCount,
    chapterCount: record.chapterCount,
    avgChapterWords: record.avgChapterWords,
    dialogueRatio: record.dialogueRatio,
    expositionRatio: record.expositionRatio,
    actionRatio: record.actionRatio,
    pacingCurve: record.pacingCurve,
    styleFingerprint: record.styleFingerprint
  };
}

function compactFact(fact: {
  id: string;
  factType: string;
  factText: string;
  subject?: string | null;
  status?: string | null;
  confidence: number;
}) {
  return {
    id: fact.id,
    factType: fact.factType,
    subject: fact.subject,
    factText: fact.factText,
    status: fact.status,
    confidence: fact.confidence
  };
}

function compactEvent(event: {
  id: string;
  eventText: string;
  consequence?: string | null;
  opensThread?: string | null;
  closesThread?: string | null;
  confidence: number;
}) {
  return {
    id: event.id,
    eventText: event.eventText,
    consequence: event.consequence,
    opensThread: event.opensThread,
    closesThread: event.closesThread,
    confidence: event.confidence
  };
}

function factText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  const record = toRecord(value);
  return (
    stringOrNull(record.factText) ??
    stringOrNull(record.text) ??
    JSON.stringify(value)
  );
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMaxItems(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return Math.max(1, fallback);
  }

  return Math.max(1, Math.floor(value));
}
