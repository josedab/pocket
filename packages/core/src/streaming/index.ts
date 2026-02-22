export {
  StreamingPipeline,
  StreamingPipelineBuilder,
  createStreamingPipeline,
} from './streaming-pipeline.js';

export type {
  AggregateOp,
  PipelineStage,
  PipelineStats,
  StreamingPipelineConfig,
  WindowConfig,
  WindowResult,
} from './streaming-pipeline.js';

export { ChangeStreamAdapter, createChangeStreamAdapter } from './change-stream-adapter.js';

export type { ChangeStreamAdapterConfig } from './change-stream-adapter.js';
