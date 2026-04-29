import { chapterRewriteRunner } from "@/src/inngest/functions/chapterRewriteRunner";
import { corpusImportRunner } from "@/src/inngest/functions/corpusImportRunner";
import { manuscriptPipelineRunner } from "@/src/inngest/functions/manuscriptPipelineRunner";
import { pipelineJobRunner } from "@/src/inngest/functions/pipelineJobRunner";
import { trendImportRunner } from "@/src/inngest/functions/trendImportRunner";

export const inngestFunctions = [
  manuscriptPipelineRunner,
  pipelineJobRunner,
  chapterRewriteRunner,
  corpusImportRunner,
  trendImportRunner
];
