const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const source = await prisma.source.upsert({
    where: { id: "seed-gutenberg" },
    update: {},
    create: {
      id: "seed-gutenberg",
      name: "Project Gutenberg",
      type: "GUTENBERG",
      baseUrl: "https://www.gutenberg.org",
      rightsNotes: "Seed metadata uses public-domain example text."
    }
  });

  let book = await prisma.corpusBook.findFirst({
    where: {
      sourceId: source.id,
      title: "Pride and Prejudice"
    }
  });

  if (!book) {
    book = await prisma.corpusBook.create({
      data: {
        sourceId: source.id,
        title: "Pride and Prejudice",
        author: "Jane Austen",
        language: "en",
        publicationYear: 1813,
        genre: "romance / social novel",
        sourceUrl: "https://www.gutenberg.org/ebooks/1342",
        rightsStatus: "PUBLIC_DOMAIN",
        allowedUses: {
          corpusBenchmarking: true,
          fullTextStorage: true,
          rewriteTraining: false
        },
        fullTextAvailable: true,
        ingestionStatus: "PROFILED",
        analysisStatus: "COMPLETED"
      }
    });

    const sample =
      "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.\n\nHowever little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families.";

    await prisma.corpusBookText.create({
      data: {
        bookId: book.id,
        rawText: sample,
        cleanedText: sample,
        wordCount: 52
      }
    });

    await prisma.corpusChunk.create({
      data: {
        bookId: book.id,
        chunkIndex: 0,
        paragraphIndex: 0,
        text: sample,
        tokenCount: 70,
        summary: "Public-domain opening hook example with social irony.",
        metrics: {
          dialogueRatio: 0,
          expositionRatio: 0.9,
          actionRatio: 0,
          introspectionRatio: 0.1
        }
      }
    });

    await prisma.bookProfile.create({
      data: {
        bookId: book.id,
        wordCount: 122189,
        chapterCount: 61,
        avgChapterWords: 2003,
        avgSentenceLength: 25.4,
        dialogueRatio: 0.32,
        expositionRatio: 0.5,
        actionRatio: 0.05,
        introspectionRatio: 0.13,
        lexicalDensity: 0.48,
        povEstimate: "third-person",
        tenseEstimate: "past",
        openingHookType: "social premise",
        pacingCurve: [],
        emotionalIntensityCurve: [],
        conflictDensityCurve: [],
        chapterEndingPatterns: [],
        styleFingerprint: {
          irony: "high",
          freeIndirectStyle: "noted"
        },
        genreMarkers: {
          courtship: true,
          socialClass: true
        },
        tropeMarkers: {
          enemiesToLovers: "proto-form"
        }
      }
    });
  }

  const existingTrend = await prisma.trendSignal.findFirst({
    where: {
      source: "Manual seed",
      category: "romantasy"
    }
  });

  if (!existingTrend) {
    await prisma.trendSignal.create({
      data: {
        source: "Manual seed",
        genre: "fantasy romance",
        category: "romantasy",
        listName: "Example metadata signal",
        signalDate: new Date("2026-01-01"),
        description:
          "Seed trend row for local testing. Replace with imported public metadata from approved sources before drawing market conclusions.",
        metadata: {
          confidence: "weak",
          copyrightedFullTextStored: false
        }
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
