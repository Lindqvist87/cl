import type {
  EditorialDisplayPriority,
  EditorialPriority
} from "@/lib/editorial/findingAggregation";
import type {
  aggregateEditorialWorkspaceData,
  NextEditorialActionDisplay
} from "@/lib/editorial/workspaceData";

type EditorialWorkspaceData = ReturnType<typeof aggregateEditorialWorkspaceData>;

export type AuthorPriorityCard = {
  id: string;
  title: string;
  importanceLabel: string;
  affectedParts: string[];
  whyItMatters: string;
  recommendedAction: string;
  targetSectionId: string | null;
};

export type AuthorStartCard = {
  heading: "Börja här";
  title: string;
  whyThisComesFirst: string;
  affectedParts: string[];
  firstConcreteStep: string;
  whatToIgnoreForNow: string;
  targetSectionId: string | null;
  primaryEnabled: boolean;
};

export type AuthorWorkspaceViewModel = {
  hero: {
    title: string;
    body: string;
  };
  start: AuthorStartCard;
  prioritySectionTitle: "Viktigast att arbeta med";
  priorityCards: AuthorPriorityCard[];
  workflowSteps: string[];
  details: {
    summaryLabel: "Visa detaljer";
    readinessLabel: "Analysen är redo";
    rawFindingsLabel: "Alla observationer";
    rewritePlanLabel: "Redigeringsplan";
    structureLabel: "Manusets delar";
  };
  mainSectionLabels: string[];
};

type AuthorPatternCopy = {
  title: string;
  whyItMatters: string;
  recommendedAction: string;
  firstConcreteStep: string;
  whatToIgnoreForNow: string;
};

const AUTHOR_PATTERN_COPY: Record<string, AuthorPatternCopy> = {
  "repeated-editorial-finding": {
    title: "Återkommande redigeringsmönster",
    whyItMatters:
      "När samma observation återkommer på flera ställen blir redigeringen starkare om du först bestämmer den gemensamma principen.",
    recommendedAction:
      "Formulera en redigeringsregel och använd den på de berörda delarna.",
    firstConcreteStep:
      "Öppna den första berörda delen och skriv en kort regel för hur mönstret ska hanteras.",
    whatToIgnoreForNow:
      "Vänta med att städa varje enskild observation tills den övergripande regeln är tydlig."
  },
  "fragment-sections": {
    title: "Möjliga falska avsnitt och fragment",
    whyItMatters:
      "Om importerade rubriker eller korta fragment behandlas som scener kan resten av analysen peka på fel saker.",
    recommendedAction:
      "Kontrollera manusets delning innan du gör lokala scenändringar.",
    firstConcreteStep:
      "Öppna strukturöversikten och bestäm vilka korta delar som ska slås ihop, döpas om eller behållas.",
    whatToIgnoreForNow:
      "Ignorera enstaka observationer om karaktär, konflikt eller rörelse på mycket korta delar tills strukturen är bekräftad."
  },
  "missing-character-anchor": {
    title: "Avsnitt behöver tydligare karaktärsfäste",
    whyItMatters:
      "Läsaren orienterar sig snabbare när varje berörd del visar vems vilja, blick eller roll som driver scenen.",
    recommendedAction:
      "Stabilisera protagonist, perspektiv och karaktärshierarki i de berörda delarna.",
    firstConcreteStep:
      "Börja i den första berörda delen och skriv vems vilja eller perspektiv som styr scenen.",
    whatToIgnoreForNow:
      "Vänta med språkputs och små formuleringar tills karaktärsfästet är klart."
  },
  "missing-conflict-pressure": {
    title: "Dramatiskt tryck saknas i flera avsnitt",
    whyItMatters:
      "Scener utan tydlig press, konflikt eller insats tappar framåtrörelse och gör senare stegring svagare.",
    recommendedAction:
      "Förtydliga vilket hinder, val eller vilken press som driver de berörda delarna.",
    firstConcreteStep:
      "Välj den första fulla scenen och skriv ut hinder, insats och beslutsslag innan du ändrar texten.",
    whatToIgnoreForNow:
      "Vänta med rytm, stilputs och mindre kontinuitetsrader tills scenens tryck går att läsa."
  },
  "missing-scene-movement": {
    title: "Scenerna behöver tydligare rörelse",
    whyItMatters:
      "När flera delar beskriver ett läge utan att något förändras kan berättelsen kännas stillastående.",
    recommendedAction:
      "Definiera före- och efterläget för varje berörd scen.",
    firstConcreteStep:
      "Skriv vad som förändras mellan första och sista stycket i den första berörda scenen.",
    whatToIgnoreForNow:
      "Vänta med meningsputs tills varje berörd scen har en tydlig vändning."
  },
  "abrupt-pov-shift": {
    title: "Perspektivskiften behöver förtydligas",
    whyItMatters:
      "Omarkerade perspektivskiften gör det svårare att förstå vems upplevelse som styr scenen.",
    recommendedAction:
      "Stabilisera perspektivet och markera avsiktliga övergångar tydligare.",
    firstConcreteStep:
      "Lista perspektivägaren för varje berörd del och lägg till övergångssignaler där ägandet byts.",
    whatToIgnoreForNow:
      "Vänta med lokala tydlighetsfixar som beror på vilket perspektiv scenen ska ha."
  },
  "unclear-transition": {
    title: "Övergångar behöver bära läsaren tydligare",
    whyItMatters:
      "Svaga övergångar kan få manuset att kännas splittrat även när enskilda scener fungerar.",
    recommendedAction:
      "Förtydliga tid, plats, orsak eller perspektivbyte mellan de berörda delarna.",
    firstConcreteStep:
      "Kartlägg läget före och efter den första berörda övergången innan du lägger till bindväv.",
    whatToIgnoreForNow:
      "Vänta med dubbla lokala övergångsnoteringar tills ordning och överlämning är bestämd."
  },
  "unclear-dramatic-contract": {
    title: "Läsarlöftet behöver bli tydligare",
    whyItMatters:
      "Om premiss och läsarlöfte är otydliga riskerar senare fixar att dra scenerna åt olika håll.",
    recommendedAction:
      "Formulera det dramatiska kontraktet innan du löser följdproblem i enskilda scener.",
    firstConcreteStep:
      "Skriv ett enmenings-löfte till läsaren och testa de första berörda delarna mot det.",
    whatToIgnoreForNow:
      "Vänta med isolerade lokala problem som kan ändras när kärnlöftet är satt."
  },
  "late-thriller-ignition": {
    title: "Berättelsens driv behöver starta tidigare",
    whyItMatters:
      "Om bokens motor syns för sent kan öppningen upplevas som uppställning innan berättelsen börjar röra sig.",
    recommendedAction:
      "Flytta den avgörande pressen eller berättelsemotorn tidigare i manuset.",
    firstConcreteStep:
      "Identifiera första oåterkalleliga presslag och avgör om det kan synas redan i öppningen.",
    whatToIgnoreForNow:
      "Låt mindre städning senare i manuset vänta tills öppningsmotorn är placerad."
  }
};

const WORKFLOW_STEPS = [
  "Börja med viktigaste strukturgreppet.",
  "Gå igenom de berörda delarna i texten.",
  "Spara beslut när du vet vilken riktning ändringen ska ha.",
  "Fortsätt till nästa prioriterade kort."
];

export function buildAuthorWorkspaceViewModel(
  workspace: EditorialWorkspaceData
): AuthorWorkspaceViewModel {
  const priorityCards = workspace.editorialPriorities
    .slice(0, 5)
    .map((priority) => buildAuthorPriorityCard(priority));
  const start = buildAuthorStartCard(workspace, priorityCards);
  const hero = buildHero(workspace);

  return {
    hero,
    start,
    prioritySectionTitle: "Viktigast att arbeta med",
    priorityCards,
    workflowSteps: WORKFLOW_STEPS,
    details: {
      summaryLabel: "Visa detaljer",
      readinessLabel: "Analysen är redo",
      rawFindingsLabel: "Alla observationer",
      rewritePlanLabel: "Redigeringsplan",
      structureLabel: "Manusets delar"
    },
    mainSectionLabels: [
      hero.title,
      start.heading,
      "Viktigast att arbeta med",
      "Arbetsgång",
      ...priorityCards.map((card) => card.importanceLabel)
    ]
  };
}

export function buildAuthorPriorityCard(
  priority: EditorialPriority
): AuthorPriorityCard {
  const copy = AUTHOR_PATTERN_COPY[priority.structuralPattern];

  return {
    id: priority.priorityId,
    title: copy?.title ?? priority.title,
    importanceLabel: importanceLabel(priority.displayPriority),
    affectedParts: affectedPartsForPriority(priority),
    whyItMatters: copy?.whyItMatters ?? priority.editorialImpact,
    recommendedAction: copy?.recommendedAction ?? priority.recommendedAction,
    targetSectionId:
      priority.affectedSectionIds[0] ??
      priority.representativeFindings.find((finding) => finding.sectionId)?.sectionId ??
      null
  };
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

function buildHero(workspace: EditorialWorkspaceData) {
  const summary = firstSentences(workspace.globalSummary ?? "", 4);

  if (summary) {
    return {
      title: workspace.editorialPriorities.length > 0
        ? "Här är det viktigaste att arbeta med"
        : "Manuset är analyserat",
      body: summary
    };
  }

  if (workspace.editorialPriorities.length > 0) {
    return {
      title: "Här är det viktigaste att arbeta med",
      body:
        "Analysen har hittat några återkommande mönster som är värda att ta i först. Börja med den tydligaste prioriteten och låt mindre puts vänta tills riktningen är satt."
    };
  }

  if (workspace.readiness.analysisStatus === "COMPLETED") {
    return {
      title: "Manuset är analyserat",
      body:
        "Det finns inga öppna prioriterade mönster att lyfta just nu. Du kan ändå granska alla observationer och manusets delar under detaljerna längre ned."
    };
  }

  return {
    title: "Analysen behöver mer underlag",
    body:
      "När manusanalysen är klar samlas helhetsbedömning, viktigaste prioritet och nästa steg här. Tills dess kan du kontrollera importerad struktur och tidigare observationer."
  };
}

function buildAuthorStartCard(
  workspace: EditorialWorkspaceData,
  priorityCards: AuthorPriorityCard[]
): AuthorStartCard {
  const action = workspace.nextAction;
  const display = workspace.nextActionDisplay;

  if (!action || !display) {
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
      whyThisComesFirst: hasAnyAnalysisData
        ? "De öppna observationerna pekar inte ut ett enskilt redigeringsgrepp som bör komma före allt annat."
        : "När analysen har mer underlag visas den viktigaste första åtgärden här.",
      affectedParts: ["Hela manuset"],
      firstConcreteStep: hasAnyAnalysisData
        ? "Öppna alla observationer och välj den del där du själv ser störst läsarfriktion."
        : "Kontrollera manusets delar och återkom när analysen är klar.",
      whatToIgnoreForNow:
        "Större omdisponeringar kan vänta tills det finns ett tydligt redigeringsmönster.",
      targetSectionId: null,
      primaryEnabled: false
    };
  }

  const sourcePriority = action.sourcePriorityId
    ? workspace.editorialPriorities.find(
        (priority) => priority.priorityId === action.sourcePriorityId
      )
    : undefined;
  const sourceCopy = sourcePriority
    ? AUTHOR_PATTERN_COPY[sourcePriority.structuralPattern]
    : undefined;
  const sourceCard = action.sourcePriorityId
    ? priorityCards.find((card) => card.id === action.sourcePriorityId)
    : undefined;

  return {
    heading: "Börja här",
    title: sourceCopy?.recommendedAction ?? action.actionTitle,
    whyThisComesFirst: whyThisComesFirst(display, sourcePriority),
    affectedParts: display.affectedSections.length > 0
      ? display.affectedSections.map(authorSectionLabel)
      : [authorSectionLabel(display.selectedSection)],
    firstConcreteStep:
      sourceCopy?.firstConcreteStep ?? display.suggestedFirstStep,
    whatToIgnoreForNow:
      sourceCopy?.whatToIgnoreForNow ??
      display.whatToIgnoreForNow ??
      "Vänta med språkputs och mindre lokala frågor tills den här riktningen är satt.",
    targetSectionId: action.targetChapter.id ?? sourceCard?.targetSectionId ?? null,
    primaryEnabled: true
  };
}

function whyThisComesFirst(
  display: NextEditorialActionDisplay,
  priority: EditorialPriority | undefined
) {
  if (priority) {
    const affectedCount = priority.affectedSectionLabels.length;
    const affectedText =
      affectedCount === 0
        ? "hela manuset"
        : `${affectedCount} ${affectedCount === 1 ? "del" : "delar"}`;

    return `${importanceLabel(
      priority.displayPriority
    )} eftersom mönstret berör ${affectedText} och påverkar hur läsaren tar sig vidare. Ta detta före mindre lokala justeringar.`;
  }

  const affectedText =
    display.affectedSections.length > 0
      ? display.affectedSections.map(authorSectionLabel).join(", ")
      : authorSectionLabel(display.selectedSection);

  return `Det här är den tydligaste öppna redigeringspunkten just nu och berör ${affectedText}. Börja här innan du går vidare till mindre observationer.`;
}

function affectedPartsForPriority(priority: EditorialPriority) {
  if (priority.affectedSectionLabels.length === 0) {
    return ["Hela manuset"];
  }

  const visible = priority.affectedSectionLabels
    .slice(0, 4)
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

function firstSentences(value: string, maxSentences: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [
    normalized
  ];

  return sentences.slice(0, maxSentences).join(" ").trim();
}
