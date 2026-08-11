import { Client } from '@hubspot/api-client';

const client = new Client({ accessToken: process.env.HUBSPOT_DEV_PERSONAL_ACCESS_KEY });

async function createContentObject() {
  console.log('\n--- Creating Content custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'content',
    labels: { singular: 'Content', plural: 'Content' },
    primaryDisplayProperty: 'title',
    requiredProperties: [],
    properties: [
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'content_type', label: 'Content Type', type: 'enumeration', fieldType: 'select', groupName: 'contentinformation',
        options: [
          { label: 'Blog Post', value: 'blog_post', displayOrder: 0, hidden: false },
          { label: 'Video', value: 'video', displayOrder: 1, hidden: false },
          { label: 'Tutorial', value: 'tutorial', displayOrder: 2, hidden: false },
          { label: 'Talk', value: 'talk', displayOrder: 3, hidden: false },
          { label: 'Changelog', value: 'changelog', displayOrder: 4, hidden: false },
          { label: 'Documentation', value: 'documentation', displayOrder: 5, hidden: false },
          { label: 'Social', value: 'social', displayOrder: 6, hidden: false },
        ]
      },
      { name: 'source_url', label: 'Source URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'published_url', label: 'Published URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'linear_issue_url', label: 'Linear Issue URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'asana_task_url', label: 'Asana Task URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'asana_task_id', label: 'Asana Task ID', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'target_date', label: 'Target Date', type: 'date', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'actual_date', label: 'Actual Publish Date', type: 'date', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'topic_tags', label: 'Topic Tags', type: 'enumeration', fieldType: 'checkbox', groupName: 'contentinformation',
        options: [
          { label: 'API', value: 'api', displayOrder: 0, hidden: false },
          { label: 'CRM', value: 'crm', displayOrder: 1, hidden: false },
          { label: 'Workflows', value: 'workflows', displayOrder: 2, hidden: false },
          { label: 'UI Extensions', value: 'ui_extensions', displayOrder: 3, hidden: false },
          { label: 'Integrations', value: 'integrations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'enterpret_theme', label: 'Enterpret Theme', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'enterpret_quote_count', label: 'Enterpret Quote Count', type: 'number', fieldType: 'number', groupName: 'contentinformation' },
      { name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea', groupName: 'contentinformation' },
      { name: 'social_post_draft', label: 'Social Post Draft', type: 'string', fieldType: 'textarea', groupName: 'contentinformation' },
      { name: 'social_published_at', label: 'Social Published At', type: 'datetime', fieldType: 'date', groupName: 'contentinformation' },
      { name: 'social_post_url', label: 'Social Post URL', type: 'string', fieldType: 'text', groupName: 'contentinformation' },
      { name: 'social_engagement_score', label: 'Social Engagement Score', type: 'number', fieldType: 'number', groupName: 'contentinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const objectTypeId = schema.objectTypeId as string;
  const pipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
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

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('  Stage IDs:');
  pipeline.stages.forEach((s: { label: string; id: string }) => console.log(`    ${s.label}: ${s.id}`));

  console.log('\n  Paste this into src/app/lib/portal-config.ts → content:');
  console.log(`    objectTypeId: '${objectTypeId}',`);
  console.log(`    pipelineId: '${pipeline.id}',`);
  console.log(`    stageIds: {`);
  pipeline.stages.forEach((s: { label: string; id: string }) => console.log(`      ${s.label.toLowerCase()}: '${s.id}',`));
  console.log(`    },`);

  return { objectTypeId, pipelineId: pipeline.id, stages: pipeline.stages };
}

async function createChangelogObject() {
  console.log('\n--- Creating Changelog Entry custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'changelog_entry',
    labels: { singular: 'Changelog Entry', plural: 'Changelog Entries' },
    primaryDisplayProperty: 'title',
    requiredProperties: [],
    properties: [
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'product_area', label: 'Product Area', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'CRM', value: 'crm', displayOrder: 0, hidden: false },
          { label: 'Marketing', value: 'marketing', displayOrder: 1, hidden: false },
          { label: 'Sales', value: 'sales', displayOrder: 2, hidden: false },
          { label: 'Service', value: 'service', displayOrder: 3, hidden: false },
          { label: 'Operations', value: 'operations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'change_type', label: 'Change Type', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'New Feature', value: 'new_feature', displayOrder: 0, hidden: false },
          { label: 'Improvement', value: 'improvement', displayOrder: 1, hidden: false },
          { label: 'Deprecation', value: 'deprecation', displayOrder: 2, hidden: false },
          { label: 'Bug Fix', value: 'bug_fix', displayOrder: 3, hidden: false },
          { label: 'Breaking Change', value: 'breaking_change', displayOrder: 4, hidden: false },
        ]
      },
      { name: 'linear_issue_url', label: 'Linear Issue URL', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'published_url', label: 'Published URL', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
      { name: 'release_date', label: 'Release Date', type: 'date', fieldType: 'date', groupName: 'changelog_entryinformation' },
      { name: 'publish_date', label: 'Publish Date', type: 'date', fieldType: 'date', groupName: 'changelog_entryinformation' },
      { name: 'developer_impact', label: 'Developer Impact', type: 'enumeration', fieldType: 'select', groupName: 'changelog_entryinformation',
        options: [
          { label: 'Breaking', value: 'breaking', displayOrder: 0, hidden: false },
          { label: 'Action Required', value: 'action_required', displayOrder: 1, hidden: false },
          { label: 'Informational', value: 'informational', displayOrder: 2, hidden: false },
        ]
      },
      { name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea', groupName: 'changelog_entryinformation' },
      { name: 'topic_tags', label: 'Topic Tags', type: 'enumeration', fieldType: 'checkbox', groupName: 'changelog_entryinformation',
        options: [
          { label: 'API', value: 'api', displayOrder: 0, hidden: false },
          { label: 'CRM', value: 'crm', displayOrder: 1, hidden: false },
          { label: 'Workflows', value: 'workflows', displayOrder: 2, hidden: false },
          { label: 'UI Extensions', value: 'ui_extensions', displayOrder: 3, hidden: false },
          { label: 'Integrations', value: 'integrations', displayOrder: 4, hidden: false },
          { label: 'Developer Platform', value: 'developer_platform', displayOrder: 5, hidden: false },
        ]
      },
      { name: 'enterpret_theme', label: 'Enterpret Theme', type: 'string', fieldType: 'text', groupName: 'changelog_entryinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const objectTypeId = schema.objectTypeId as string;
  const pipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
    label: 'Changelog Lifecycle',
    displayOrder: 0,
    stages: [
      { label: 'Identified', displayOrder: 0, metadata: { probability: '0.2' } },
      { label: 'Drafting', displayOrder: 1, metadata: { probability: '0.5' } },
      { label: 'Reviewing', displayOrder: 2, metadata: { probability: '0.8' } },
      { label: 'Published', displayOrder: 3, metadata: { probability: '1.0' } },
    ],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('\n  Paste this into src/app/lib/portal-config.ts → changelog:');
  console.log(`    objectTypeId: '${objectTypeId}',`);
  console.log(`    pipelineId: '${pipeline.id}',`);
  console.log(`    stageIds: {`);
  pipeline.stages.forEach((s: { label: string; id: string }) => console.log(`      ${s.label.toLowerCase()}: '${s.id}',`));
  console.log(`    },`);

  return { objectTypeId };
}

async function createVideoObject() {
  console.log('\n--- Creating Video custom object ---');
  const schema = await client.crm.schemas.coreApi.create({
    name: 'video',
    labels: { singular: 'Video', plural: 'Videos' },
    primaryDisplayProperty: 'title',
    requiredProperties: [],
    properties: [
      // Identity
      { name: 'title', label: 'Title', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'youtube_video_id', label: 'YouTube Video ID', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'youtube_url', label: 'YouTube URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Content
      { name: 'video_description', label: 'Description', type: 'string', fieldType: 'textarea', groupName: 'videoinformation' },
      { name: 'thumbnail_url', label: 'Thumbnail URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'tags', label: 'Tags', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Lifecycle
      { name: 'published_at', label: 'Published At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
      { name: 'scheduled_publish_at', label: 'Scheduled Publish At', type: 'datetime', fieldType: 'date', groupName: 'videoinformation' },
      // Metrics
      { name: 'view_count', label: 'View Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'like_count', label: 'Like Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'comment_count', label: 'Comment Count', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      // Analytics
      { name: 'impressions', label: 'Impressions', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'click_through_rate', label: 'Click Through Rate', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'average_view_duration', label: 'Avg View Duration (sec)', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      // Attribution
      { name: 'utm_link', label: 'UTM Link', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'website_url', label: 'Website URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'campaign_name', label: 'Campaign Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      // Content Studio
      { name: 'series_name', label: 'Series Name', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
      { name: 'series_order', label: 'Series Order', type: 'number', fieldType: 'number', groupName: 'videoinformation' },
      { name: 'google_doc_url', label: 'Script / Google Doc URL', type: 'string', fieldType: 'text', groupName: 'videoinformation' },
    ],
    associatedObjects: ['CONTACT', 'COMPANY'],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log('  Created schema. objectTypeId:', schema.objectTypeId);

  const objectTypeId = schema.objectTypeId as string;
  const pipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
    label: 'Video Lifecycle',
    displayOrder: 0,
    stages: [
      { label: 'Draft', displayOrder: 0, metadata: { probability: '0.2' } },
      { label: 'Scheduled', displayOrder: 1, metadata: { probability: '0.5' } },
      { label: 'Public', displayOrder: 2, metadata: { probability: '1.0' } },
    ],
  } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

  console.log('  Created pipeline. pipelineId:', pipeline.id);
  console.log('\n  Add this to src/app/lib/portal-config.ts → video: { objectTypeId, pipelineId, stageIds }');
  console.log(`    objectTypeId: '${objectTypeId}'`);
  console.log(`    pipelineId: '${pipeline.id}'`);
  pipeline.stages.forEach((s: { label: string; id: string }) => console.log(`    ${s.label.toLowerCase()}: '${s.id}'`));
}

async function main() {
  if (!process.env.HUBSPOT_DEV_PERSONAL_ACCESS_KEY) {
    console.error('Error: HUBSPOT_DEV_PERSONAL_ACCESS_KEY environment variable is not set.');
    console.error('Export it first: export HUBSPOT_DEV_PERSONAL_ACCESS_KEY=your-pak-here');
    process.exit(1);
  }

  try {
    await createContentObject();
    await createChangelogObject();
    await createVideoObject();
    console.log('\n✓ Provisioning complete. Update portal-config.ts with the values above.');
  } catch (err: unknown) {
    console.error('Provisioning failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
