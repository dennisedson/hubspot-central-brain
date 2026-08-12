// Filled in after running: npm run provision
// The provision script outputs the values to paste into this file.
export const PORTAL_CONFIG = {
  content: {
    objectTypeId: process.env.CONTENT_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId: process.env.CONTENT_PIPELINE_ID ?? 'FILL_IN',
    stageIds: {
      idea: process.env.CONTENT_STAGE_IDEA ?? 'FILL_IN',
      outline: process.env.CONTENT_STAGE_OUTLINE ?? 'FILL_IN',
      drafting: process.env.CONTENT_STAGE_DRAFTING ?? 'FILL_IN',
      editing: process.env.CONTENT_STAGE_EDITING ?? 'FILL_IN',
      review: process.env.CONTENT_STAGE_REVIEW ?? 'FILL_IN',
      published: process.env.CONTENT_STAGE_PUBLISHED ?? 'FILL_IN',
      archived: process.env.CONTENT_STAGE_ARCHIVED ?? 'FILL_IN',
    },
  },
  changelog: {
    objectTypeId: process.env.CHANGELOG_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId: process.env.CHANGELOG_PIPELINE_ID ?? 'FILL_IN',
    stageIds: {
      identified: process.env.CHANGELOG_STAGE_IDENTIFIED ?? 'FILL_IN',
      drafting: process.env.CHANGELOG_STAGE_DRAFTING_CL ?? 'FILL_IN',
      reviewing: process.env.CHANGELOG_STAGE_REVIEWING ?? 'FILL_IN',
      published: process.env.CHANGELOG_STAGE_PUBLISHED_CL ?? 'FILL_IN',
    },
  },
};
