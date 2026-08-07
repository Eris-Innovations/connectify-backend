/**
 * Connecty generation pipeline (LangChain-style stages).
 * Stages: persist user → context pack → grounded generate → persist assistant → extract/summary.
 * Orchestrated by connecty.service; helpers live in sibling modules.
 */
export { buildContextPack } from './connecty.context-pack';
export { extractAndApplyFacts } from './fact-extractor';
export { maybeRefreshRunningSummary } from './connecty.summarizer';
export { sendConnectyMessage } from './connecty.service';
