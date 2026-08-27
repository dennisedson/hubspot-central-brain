import { Client } from '@hubspot/api-client';

const client = new Client({ accessToken: process.env.HUBSPOT_ACCESS_KEY });

async function listAllSchemas(): Promise<void> {
  const response = await (client.crm.schemas.coreApi as any).getAll(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log('\nExisting custom schemas:');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response.results?.forEach((s: any) => console.log(`  name=${s.name} label=${s.labels?.singular} objectTypeId=${s.objectTypeId}`));
}

async function findExistingSchema(name: string, singularLabel: string): Promise<string | null> {
  const response = await (client.crm.schemas.coreApi as any).getAll(false); // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = response.results?.find((s: any) => s.name === name || s.labels?.singular === singularLabel);
  return match?.objectTypeId ?? null;
}

async function findExistingPipeline(objectTypeId: string, label: string): Promise<any | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await client.crm.pipelines.pipelinesApi.getAll(objectTypeId);
  return response.results.find((p: any) => p.label === label) ?? null; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function printPipelineBlock(name: string, pipeline: any): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(`      ${name}: {`);
  console.log(`        pipelineId: '${pipeline.id}',`);
  console.log(`        stageIds: {`);
  pipeline.stages.forEach((s: { label: string; id: string }) =>
    console.log(`          ${s.label.toLowerCase()}: '${s.id}',`),
  );
  console.log(`        },`);
  console.log(`      },`);
}

function printVideoConfig(objectTypeId: string, pipeline: any): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(`\n  Paste this into src/app/lib/portal-config.ts → video:`);
  console.log(`    video: {`);
  console.log(`      objectTypeId: '${objectTypeId}',`);
  console.log(`      pipelineId: '${pipeline.id}',`);
  console.log(`      stageIds: {`);
  pipeline.stages.forEach((s: { label: string; id: string }) =>
    console.log(`        ${s.label.toLowerCase()}: '${s.id}',`),
  );
  console.log(`      },`);
  console.log(`    },`);
}

function printPortalConfig(objectTypeId: string, contentPipeline: any, changelogPipeline: any): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(`\n  Paste this into src/app/lib/portal-config.ts → content:`);
  console.log(`    content: {`);
  console.log(`      objectTypeId: '${objectTypeId}',`);
  console.log(`      pipelines: {`);
  printPipelineBlock('content', contentPipeline);
  printPipelineBlock('changelog', changelogPipeline);
  console.log(`      },`);
  console.log(`    },`);
}

async function provisionContent(): Promise<void> {
  console.log('\n--- Content custom object ---');

  let objectTypeId = await findExistingSchema('content_piece', 'Content Piece');
  if (objectTypeId) {
    console.log('  Already exists. objectTypeId:', objectTypeId);
  } else {
    const schema = await client.crm.schemas.coreApi.create({
      name: 'content_piece',
      labels: { singular: 'Content Piece', plural: 'Content Pieces' },
      primaryDisplayProperty: 'title',
      requiredProperties: [],
      properties: [
        { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'content_type', label: 'Content Type', type: 'enumeration', fieldType: 'select', groupName: 'content_pieceinformation',
          options: [
            { label: 'Blog Post', value: 'blog_post', displayOrder: 0, hidden: false },
            { label: 'Video', value: 'video', displayOrder: 1, hidden: false },
            { label: 'Tutorial', value: 'tutorial', displayOrder: 2, hidden: false },
            { label: 'Talk', value: 'talk', displayOrder: 3, hidden: false },
            { label: 'Changelog', value: 'changelog', displayOrder: 4, hidden: false },
            { label: 'Documentation', value: 'documentation', displayOrder: 5, hidden: false },
            { label: 'Social', value: 'social', displayOrder: 6, hidden: false },
          ],
        },
        { name: 'source_url', label: 'Source URL', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'published_url', label: 'Published URL', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'linear_issue_url', label: 'Linear Issue URL', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation', hasUniqueValue: true },
        { name: 'asana_task_url', label: 'Asana Task URL', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'asana_task_id', label: 'Asana Task ID', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'target_date', label: 'Target Date', type: 'date', fieldType: 'date', groupName: 'content_pieceinformation' },
        { name: 'actual_date', label: 'Actual Publish Date', type: 'date', fieldType: 'date', groupName: 'content_pieceinformation' },
        { name: 'topic_tags', label: 'Topic Tags', type: 'enumeration', fieldType: 'checkbox', groupName: 'content_pieceinformation',
          options: [
            { label: 'API', value: 'api', displayOrder: 0, hidden: false },
            { label: 'CRM', value: 'crm', displayOrder: 1, hidden: false },
            { label: 'Workflows', value: 'workflows', displayOrder: 2, hidden: false },
            { label: 'UI Extensions', value: 'ui_extensions', displayOrder: 3, hidden: false },
            { label: 'Integrations', value: 'integrations', displayOrder: 4, hidden: false },
            { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
          ],
        },
        { name: 'enterpret_theme', label: 'Enterpret Theme', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'enterpret_quote_count', label: 'Enterpret Quote Count', type: 'number', fieldType: 'number', groupName: 'content_pieceinformation' },
        { name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea', groupName: 'content_pieceinformation' },
        { name: 'social_post_draft', label: 'Social Post Draft', type: 'string', fieldType: 'textarea', groupName: 'content_pieceinformation' },
        { name: 'social_published_at', label: 'Social Published At', type: 'datetime', fieldType: 'date', groupName: 'content_pieceinformation' },
        { name: 'social_post_url', label: 'Social Post URL', type: 'string', fieldType: 'text', groupName: 'content_pieceinformation' },
        { name: 'social_engagement_score', label: 'Social Engagement Score', type: 'number', fieldType: 'number', groupName: 'content_pieceinformation' },
      ],
      associatedObjects: ['CONTACT', 'COMPANY'],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    objectTypeId = schema.objectTypeId as string;
    console.log('  Created. objectTypeId:', objectTypeId);
  }

  let contentPipeline = await findExistingPipeline(objectTypeId, 'Content Lifecycle');
  if (contentPipeline) {
    console.log('  Content Lifecycle pipeline already exists. pipelineId:', contentPipeline.id);
  } else {
    contentPipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Content Lifecycle',
      displayOrder: 0,
      stages: [
        { label: 'Idea', displayOrder: 0, metadata: { probability: '0.1' } },
        { label: 'Outline', displayOrder: 1, metadata: { probability: '0.2' } },
        { label: 'Drafting', displayOrder: 2, metadata: { probability: '0.4' } },
        { label: 'Editing', displayOrder: 3, metadata: { probability: '0.6' } },
        { label: 'Review', displayOrder: 4, metadata: { probability: '0.8' } },
        { label: 'Published', displayOrder: 5, metadata: { probability: '1.0' } },
        { label: 'Archived', displayOrder: 6, metadata: { probability: '0.0' } },
      ],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log('  Created Content Lifecycle pipeline. pipelineId:', contentPipeline.id);
  }

  let changelogPipeline = await findExistingPipeline(objectTypeId, 'Changelog Lifecycle');
  if (changelogPipeline) {
    console.log('  Changelog Lifecycle pipeline already exists. pipelineId:', changelogPipeline.id);
  } else {
    changelogPipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Changelog Lifecycle',
      displayOrder: 1,
      stages: [
        { label: 'Identified', displayOrder: 0, metadata: { probability: '0.2' } },
        { label: 'Drafting', displayOrder: 1, metadata: { probability: '0.5' } },
        { label: 'Reviewing', displayOrder: 2, metadata: { probability: '0.8' } },
        { label: 'Published', displayOrder: 3, metadata: { probability: '1.0' } },
      ],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log('  Created Changelog Lifecycle pipeline. pipelineId:', changelogPipeline.id);
  }

  printPortalConfig(objectTypeId, contentPipeline, changelogPipeline);
}

async function provisionVideo(): Promise<void> {
  console.log('\n--- Video custom object ---');

  let objectTypeId = await findExistingSchema('video', 'Video');
  if (objectTypeId) {
    console.log('  Already exists. objectTypeId:', objectTypeId);
  } else {
    const schema = await client.crm.schemas.coreApi.create({
      name: 'video',
      labels: { singular: 'Video', plural: 'Videos' },
      primaryDisplayProperty: 'title',
      requiredProperties: [],
      properties: [
        { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'youtube_video_id', label: 'YouTube Video ID', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'youtube_url', label: 'YouTube URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'video_description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: 'videoinformation' },
        { name: 'thumbnail_url', label: 'Thumbnail URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'tags', label: 'Tags', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'published_at', label: 'Published At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
        { name: 'scheduled_publish_at', label: 'Scheduled Publish At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
        { name: 'view_count', label: 'View Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'like_count', label: 'Like Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'comment_count', label: 'Comment Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'impressions', label: 'Impressions', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'click_through_rate', label: 'Click Through Rate', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'average_view_duration', label: 'Avg View Duration (sec)', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'utm_link', label: 'UTM Link', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'website_url', label: 'Website URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'campaign_name', label: 'Campaign Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'series_name', label: 'Series Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
        { name: 'series_order', label: 'Series Order', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
        { name: 'google_doc_url', label: 'Script / Google Doc URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      ],
      associatedObjects: ['CONTACT', 'COMPANY'],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    objectTypeId = schema.objectTypeId as string;
    console.log('  Created. objectTypeId:', objectTypeId);
  }

  let pipeline = await findExistingPipeline(objectTypeId, 'Video Lifecycle');
  if (pipeline) {
    console.log('  Pipeline already exists. pipelineId:', pipeline.id);
  } else {
    pipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Video Lifecycle',
      displayOrder: 0,
      stages: [
        { label: 'Draft', displayOrder: 0, metadata: { probability: '0.2' } },
        { label: 'Scheduled', displayOrder: 1, metadata: { probability: '0.5' } },
        { label: 'Public', displayOrder: 2, metadata: { probability: '1.0' } },
      ],
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log('  Created pipeline. pipelineId:', pipeline.id);
  }

  printVideoConfig(objectTypeId, pipeline);
}

async function main() {
  if (!process.env.HUBSPOT_ACCESS_KEY) {
    console.error('Error: HUBSPOT_ACCESS_KEY environment variable is not set.');
    console.error('Export it first: export HUBSPOT_ACCESS_KEY=your-service-key-here');
    process.exit(1);
  }

  try {
    await listAllSchemas();
    await provisionContent();
    await provisionVideo();
    console.log('\n✓ Provisioning complete. Update portal-config.ts with the values above.');
  } catch (err: unknown) {
    console.error('Provisioning failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
