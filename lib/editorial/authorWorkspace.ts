import type {
  EditorialDisplayPriority,
  EditorialPriority
} from "@/lib/editorial/findingAggregation";
import type { aggregateEditorialWorkspaceData } from "@/lib/editorial/workspaceData";

type EditorialWorkspaceData = ReturnType<typeof aggregateEditorialWorkspaceData>;

export type AuthorPriorityCard = {
  id: string;
  title: string;
  importanceLabel: string;
  whyItMatters: string;
  recommendedAction: string;
  affectedPartsPreview: string;
  targetSectionId: string | null;
};

export type AuthorStartCard = {
  heading: "Börja här";
  title: string;
  explanation: string;
  whyItMatters: string;
  firstConcreteStep: string;
  affectedPartsPreview: string;
  targetSectionId: string | null;
  primaryEnabled: boolean;
  primaryButtonLabel: "Visa första berörda del";
};

export type AuthorWorkspaceViewModel = {
  hero: {
    statusLabel: string;
    body: string;
  };
  start: AuthorStartCard;
  prioritySectionTitle: "Viktigast att arbeta med";
  priorityCards: AuthorPriorityCard[];
  details: {
    summaryLabel: "Detaljer";
    allObservationsLabel: "Alla observationer";
    sectionsLabel: "Manusets delar";
    rewritePlanLabel: "Redigeringsplan";
    importedStructureLabel: "Importerad struktur";
    rawDataLabel: "Analysunderlag";
  };
  mainSectionLabels: string[];
};

type AuthorPatternCopy = {
  title: string;
  whyItMatters: string;
  recommendedAction: string;
  firstConcreteStep: string;
};

const FALLBACK_COPY: AuthorPatternCopy = {
  title: "Redaktionellt mönster att se över",
  whyItMatters:
    "När samma typ av fråga återkommer i flera delar påverkar den ofta läsarens helhetsintryck mer än enstaka lokala rader.",
  recommendedAction:
    "Gå igenom den första berörda delen och formulera en tydlig redigeringsregel innan du justerar flera ställen.",
  firstConcreteStep:
    "Öppna första berörda del och skriv vad scenen behöver bära innan du ändrar formuleringar."
};

const AUTHOR_PATTERN_COPY: Record<string, AuthorPatternCopy> = {
  "repeated-editorial-finding": {
    title: "Återkommande redigeringsmönster",
    whyItMatters:
      "Samma observation återkommer på flera ställen, så redigeringen blir starkare om du först bestämmer den gemensamma principen.",
    recommendedAction:
      "Formulera en redigeringsregel och använd den på de berörda delarna.",
    firstConcreteStep:
      "Öppna första berörda del och skriv en kort regel för hur mönstret ska hanteras."
  },
  "fragment-sections": {
    title: "Möjliga falska avsnitt och fragment",
    whyItMatters:
      "Om rubriker eller korta fragment behandlas som scener kan analysen peka på fel saker.",
    recommendedAction:
      "Kontrollera manusets delning innan du gör lokala scenändringar.",
    firstConcreteStep:
      "Öppna strukturöversikten och bestäm vilka korta delar som ska slås ihop, döpas om eller behållas."
  },
  "missing-character-anchor": {
    title: "Avsnitt behöver tydligare karaktärsfäste",
    whyItMatters:
      "Läsaren orienterar sig snabbare när varje berörd del visar vems vilja, blick eller roll som driver scenen.",
    recommendedAction:
      "Stabilisera protagonist, perspektiv och karaktärshierarki i de berörda delarna.",
    firstConcreteStep:
      "Börja i första berörda del och skriv vems vilja eller perspektiv som styr scenen."
  },
  "missing-conflict-pressure": {
    title: "Dramatiskt tryck saknas i flera avsnitt",
    whyItMatters:
      "Scener utan tydlig press, konflikt eller insats tappar framåtrörelse och gör senare stegring svagare.",
    recommendedAction:
      "Förtydliga vilket hinder, val eller vilken press som driver de berörda delarna.",
    firstConcreteStep:
      "Välj första fulla scenen och skriv ut hinder, insats och beslutsslag innan du ändrar texten."
  },
  "missing-scene-movement": {
    title: "Scenerna behöver tydligare rörelse",
    whyItMatters:
      "När flera delar beskriver ett läge utan att något förändras kan berättelsen kännas stillastående.",
    recommendedAction:
      "Definiera före- och efterläget för varje berörd scen.",
    firstConcreteStep:
      "Skriv vad som förändras mellan första och sista stycket i första berörda scen."
  },
  "abrupt-pov-shift": {
    title: "Perspektivskiften behöver förtydligas",
    whyItMatters:
      "Omarkerade perspektivskiften gör det svårare att förstå vems upplevelse som styr scenen.",
    recommendedAction:
      "Stabilisera perspektivet och markera avsiktliga övergångar tydligare.",
    firstConcreteStep:
      "Lista perspektivägaren för varje berörd del och lägg till övergångssignaler där ägandet byts."
  },
  "unclear-transition": {
    title: "Övergångar behöver bära läsaren tydligare",
    whyItMatters:
      "Svaga övergångar kan få manuset att kännas splittrat även när enskilda scener fungerar.",
    recommendedAction:
      "Förtydliga tid, plats, orsak eller perspektivbyte mellan de berörda delarna.",
    firstConcreteStep:
      "Kartlägg läget före och efter första berörda övergång innan du lägger till bindväv."
  },
  "unclear-dramatic-contract": {
    title: "Läsarlöftet behöver bli tydligare",
    whyItMatters:
      "Om premiss och läsarlöfte är otydliga riskerar senare fixar att dra scenerna åt olika håll.",
    recommendedAction:
      "Formulera det dramatiska kontraktet innan du löser följdproblem i enskilda scener.",
    firstConcreteStep:
      "Skriv ett löfte till läsaren i en mening och testa de första berörda delarna mot det."
  },
  "late-thriller-ignition": {
    title: "Berättelsens driv behöver starta tidigare",
    whyItMatters:
      "Om bokens motor syns för sent kan öppningen upplevas som uppställning innan berättelsen börjar röra sig.",
    recommendedAction:
      "Flytta den avgörande pressen eller berättelsemotorn tidigare i manuset.",
    firstConcreteStep:
      "Identifiera första oåterkalleliga presslag och avgör om det kan synas redan i öppningen."
  }
};

export function buildAuthorWorkspaceViewModel(
  workspace: EditorialWorkspaceData
): AuthorWorkspaceViewModel {
  const priorityCards = disambiguateDuplicatePriorityCards(
    workspace.editorialPriorities
      .slice(0, 5)
      .map((priority) => buildAuthorPriorityCard(priority))
  );
  const start = buildAuthorStartCard(workspace, priorityCards);
  const hero = buildHero(workspace, priorityCards);

  return {
    hero,
    start,
    prioritySectionTitle: "Viktigast att arbeta med",
    priorityCards,
    details: {
      summaryLabel: "Detaljer",
      allObservationsLabel: "Alla observationer",
      sectionsLabel: "Manusets delar",
      rewritePlanLabel: "Redigeringsplan",
      importedStructureLabel: "Importerad struktur",
      rawDataLabel: "Analysunderlag"
    },
    mainSectionLabels: [
      hero.statusLabel,
      start.heading,
      start.primaryButtonLabel,
      "Viktigast att arbeta med",
      ...priorityCards.flatMap((card) => [
        card.importanceLabel,
        card.title,
        card.recommendedAction,
        card.affectedPartsPreview
      ])
    ]
  };
}

export function buildAuthorPriorityCard(
  priority: EditorialPriority
): AuthorPriorityCard {
  const copy = copyForPriority(priority);
  const affectedParts = affectedPartsForPriority(priority, 2);

  return {
    id: priority.priorityId,
    title: copy.title,
    importanceLabel: importanceLabel(priority.displayPriority),
    whyItMatters: copy.whyItMatters,
    recommendedAction: copy.recommendedAction,
    affectedPartsPreview: affectedParts.join(", "),
    targetSectionId:
      priority.affectedSectionIds[0] ??
      priority.representativeFindings.find((finding) => finding.sectionId)?.sectionId ??
      null
  };
}

function disambiguateDuplicatePriorityCards(cards: AuthorPriorityCard[]) {
  const titleCounts = cards.reduce<Map<string, number>>((counts, card) => {
    counts.set(card.title, (counts.get(card.title) ?? 0) + 1);
    return counts;
  }, new Map());
  const seen = new Map<string, number>();

  return cards.map((card) => {
    if ((titleCounts.get(card.title) ?? 0) < 2) {
      return card;
    }

    const index = (seen.get(card.title) ?? 0) + 1;
    seen.set(card.title, index);
    const context =
      card.affectedPartsPreview && card.affectedPartsPreview !== "Hela manuset"
        ? card.affectedPartsPreview
        : `prioritet ${index}`;

    return {
      ...card,
      title: `${card.title} (${context})`
    };
  });
}

export function importanceLabel(priority: EditorialDisplayPriority) {
  const labels: Record<EditorialDisplayPriority, string> = {
    critical: "Mycket hög viktighet",
    high: "Hög viktighet",
    medium: "Medelviktigt",
    low: "Lägre viktighet"
  };

  return labels[priority];
}

function buildHero(
  workspace: EditorialWorkspaceData,
  priorityCards: AuthorPriorityCard[]
) {
  const statusLabel =
    workspace.readiness.analysisStatus === "COMPLETED"
      ? "Analysen är klar"
      : workspace.readiness.analysisStatus === "RUNNING"
        ? "Analysen pågår"
        : "Analysen inväntar underlag";
  const priorityCount = priorityCards.length;
  const firstPriority = priorityCards[0];

  if (firstPriority) {
    return {
      statusLabel,
      body: [
        `Analysen lyfter ${priorityCount} ${priorityCount === 1 ? "prioriterat redigeringsområde" : "prioriterade redigeringsområden"}.`,
        `Viktigast just nu är ${firstPriority.title.toLowerCase()}.`,
        "Börja med första berörda del och låt rålistorna vila tills riktningen är tydlig."
      ].join(" ")
    };
  }

  if (workspace.readiness.analysisStatus === "COMPLETED") {
    return {
      statusLabel,
      body:
        "Analysen är klar och lyfter inga öppna prioriterade mönster just nu. Gå vidare genom att kontrollera detaljerna eller öppna manusets delar."
    };
  }

  return {
    statusLabel,
    body:
      "När analysen är klar samlas helhetsbild, första rekommendation och viktigaste redigeringsområden här."
  };
}

function buildAuthorStartCard(
  workspace: EditorialWorkspaceData,
  priorityCards: AuthorPriorityCard[]
): AuthorStartCard {
  const action = workspace.nextAction;
  const sourcePriority = action?.sourcePriorityId
    ? workspace.editorialPriorities.find(
        (priority) => priority.priorityId === action.sourcePriorityId
      )
    : workspace.editorialPriorities[0];
  const sourceCard = sourcePriority
    ? priorityCards.find((card) => card.id === sourcePriority.priorityId)
    : priorityCards[0];

  if (!action || !sourceCard) {
    const hasAnyAnalysisData = Boolean(
      workspace.globalSummary ||
        workspace.editorialPriorities.length ||
        workspace.keyIssues.length ||
        workspace.rewritePlanItems.length
    );

    return {
      heading: "Börja här",
      title: hasAnyAnalysisData
        ? "Ingen tydlig första prioritet just nu"
        : "Analysen saknar ännu en tydlig första prioritet",
      explanation: hasAnyAnalysisData
        ? "Det finns underlag att granska, men inget enskilt redigeringsgrepp behöver lyftas före allt annat."
        : "När analysen har mer underlag visas den tydligaste första åtgärden här.",
      whyItMatters:
        "En lugn startpunkt gör det lättare att välja rätt nivå innan du ändrar texten.",
      firstConcreteStep: hasAnyAnalysisData
        ? "Öppna detaljerna och välj den del där du själv ser störst läsarfriktion."
        : "Kontrollera manusets delar och återkom när analysen är klar.",
      affectedPartsPreview: "Hela manuset",
      targetSectionId: null,
      primaryEnabled: false,
      primaryButtonLabel: "Visa första berörda del"
    };
  }

  const copy = sourcePriority ? copyForPriority(sourcePriority) : FALLBACK_COPY;
  const affectedParts = sourcePriority
    ? affectedPartsForPriority(sourcePriority, 3)
    : ["Första berörda del"];

  return {
    heading: "Börja här",
    title: copy.recommendedAction,
    explanation:
      "Det här är den tydligaste första redigeringsrörelsen utifrån de samlade observationerna.",
    whyItMatters: copy.whyItMatters,
    firstConcreteStep: copy.firstConcreteStep,
    affectedPartsPreview: affectedParts.join(", "),
    targetSectionId: action.targetChapter.id ?? sourceCard.targetSectionId,
    primaryEnabled: true,
    primaryButtonLabel: "Visa första berörda del"
  };
}

function copyForPriority(priority: EditorialPriority) {
  return AUTHOR_PATTERN_COPY[priority.structuralPattern] ?? FALLBACK_COPY;
}

function affectedPartsForPriority(priority: EditorialPriority, limit: number) {
  if (priority.affectedSectionLabels.length === 0) {
    return ["Hela manuset"];
  }

  const visible = priority.affectedSectionLabels
    .slice(0, limit)
    .map(authorSectionLabel);
  const remaining = priority.affectedSectionLabels.length - visible.length;

  if (remaining > 0) {
    visible.push(`${remaining} till`);
  }

  return visible;
}

function authorSectionLabel(label: string) {
  return label
    .replace(/^Section\s+(\d+):/i, "Del $1:")
    .replace(/^Manuscript level$/i, "Hela manuset")
    .replace(/^Unlinked section$/i, "Ej kopplad del");
}
