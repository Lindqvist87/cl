import { jsonInput } from "@/lib/json";
import { hashText } from "@/lib/compiler/hash";
import { prisma } from "@/lib/prisma";

export async function buildManuscriptNodes(manuscriptId: string) {
  const manuscript = await prisma.manuscript.findUniqueOrThrow({
    where: { id: manuscriptId },
    include: {
      chapters: {
        orderBy: { order: "asc" },
        include: {
          scenes: { orderBy: { order: "asc" } }
        }
      },
      chunks: {
        orderBy: { chunkIndex: "asc" }
      }
    }
  });

  const bookNode = await prisma.manuscriptNode.upsert({
    where: { key: nodeKey(manuscriptId, "BOOK", manuscriptId) },
    create: {
      manuscriptId,
      key: nodeKey(manuscriptId, "BOOK", manuscriptId),
      type: "BOOK",
      order: 0,
      title: manuscript.title,
      textHash: manuscript.originalText
        ? hashText(manuscript.originalText)
        : undefined,
      wordCount: manuscript.wordCount,
      metadata: jsonInput({
        targetGenre: manuscript.targetGenre,
        targetAudience: manuscript.targetAudience,
        sourceFileName: manuscript.sourceFileName
      })
    },
    update: {
      title: manuscript.title,
      textHash: manuscript.originalText
        ? hashText(manuscript.originalText)
        : undefined,
      wordCount: manuscript.wordCount,
      metadata: jsonInput({
        targetGenre: manuscript.targetGenre,
        targetAudience: manuscript.targetAudience,
        sourceFileName: manuscript.sourceFileName
      })
    }
  });

  let createdOrUpdated = 1;
  const chapterNodeIds = new Map<string, string>();
  const sceneNodeIds = new Map<string, string>();

  for (const chapter of manuscript.chapters) {
    const chapterNode = await prisma.manuscriptNode.upsert({
      where: { key: nodeKey(manuscriptId, "CHAPTER", chapter.id) },
      create: {
        manuscriptId,
        parentId: bookNode.id,
        key: nodeKey(manuscriptId, "CHAPTER", chapter.id),
        type: "CHAPTER",
        order: chapter.order,
        title: chapter.title,
        chapterId: chapter.id,
        textHash: hashText(chapter.text),
        wordCount: chapter.wordCount,
        metadata: jsonInput({
          chapterIndex: chapter.chapterIndex || chapter.order,
          heading: chapter.heading
        })
      },
      update: {
        parentId: bookNode.id,
        order: chapter.order,
        title: chapter.title,
        textHash: hashText(chapter.text),
        wordCount: chapter.wordCount,
        metadata: jsonInput({
          chapterIndex: chapter.chapterIndex || chapter.order,
          heading: chapter.heading
        })
      }
    });
    chapterNodeIds.set(chapter.id, chapterNode.id);
    createdOrUpdated += 1;

    for (const scene of chapter.scenes) {
      const sceneNode = await prisma.manuscriptNode.upsert({
        where: { key: nodeKey(manuscriptId, "SCENE", scene.id) },
        create: {
          manuscriptId,
          parentId: chapterNode.id,
          key: nodeKey(manuscriptId, "SCENE", scene.id),
          type: "SCENE",
          order: chapter.order * 1000 + scene.order,
          title: scene.title,
          chapterId: chapter.id,
          sceneId: scene.id,
          wordCount: scene.wordCount,
          metadata: jsonInput({
            marker: scene.marker,
            chapterOrder: chapter.order,
            sceneOrder: scene.order
          })
        },
        update: {
          parentId: chapterNode.id,
          order: chapter.order * 1000 + scene.order,
          title: scene.title,
          wordCount: scene.wordCount,
          metadata: jsonInput({
            marker: scene.marker,
            chapterOrder: chapter.order,
            sceneOrder: scene.order
          })
        }
      });
      sceneNodeIds.set(scene.id, sceneNode.id);
      createdOrUpdated += 1;
    }
  }

  for (const chunk of manuscript.chunks) {
    const parentId =
      (chunk.sceneId ? sceneNodeIds.get(chunk.sceneId) : undefined) ??
      chapterNodeIds.get(chunk.chapterId);

    await prisma.manuscriptNode.upsert({
      where: { key: nodeKey(manuscriptId, "CHUNK", chunk.id) },
      create: {
        manuscriptId,
        parentId,
        key: nodeKey(manuscriptId, "CHUNK", chunk.id),
        type: "CHUNK",
        order: 1_000_000 + chunk.chunkIndex,
        title: `Chunk ${chunk.chunkIndex + 1}`,
        chapterId: chunk.chapterId,
        sceneId: chunk.sceneId,
        chunkId: chunk.id,
        paragraphStart: chunk.paragraphStart ?? chunk.startParagraph,
        paragraphEnd: chunk.paragraphEnd ?? chunk.endParagraph,
        textHash: hashText(chunk.text),
        wordCount: chunk.wordCount,
        summaryShort: chunk.summary,
        metadata: jsonInput({
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          ...(toRecord(chunk.metadata) ?? {})
        })
      },
      update: {
        parentId,
        order: 1_000_000 + chunk.chunkIndex,
        chapterId: chunk.chapterId,
        sceneId: chunk.sceneId,
        paragraphStart: chunk.paragraphStart ?? chunk.startParagraph,
        paragraphEnd: chunk.paragraphEnd ?? chunk.endParagraph,
        textHash: hashText(chunk.text),
        wordCount: chunk.wordCount,
        summaryShort: chunk.summary,
        metadata: jsonInput({
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          ...(toRecord(chunk.metadata) ?? {})
        })
      }
    });
    createdOrUpdated += 1;
  }

  return {
    nodeCount: createdOrUpdated,
    chapterNodes: manuscript.chapters.length,
    sceneNodes: manuscript.chapters.reduce(
      (sum, chapter) => sum + chapter.scenes.length,
      0
    ),
    chunkNodes: manuscript.chunks.length
  };
}

export function nodeKey(manuscriptId: string, type: string, id: string) {
  return `${manuscriptId}:${type}:${id}`;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
