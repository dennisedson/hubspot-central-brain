const FELLOW_BASE = 'https://api.fellow.app/hapi/v2';

export interface FellowAssignee {
  name: string;
  status: 'done' | 'not_done';
}

export interface FellowActionItem {
  text: string;
  updatedAt: string;
  assignees: FellowAssignee[];
}

export interface FellowActionItemGroup {
  noteTitle: string;
  meetingId: string;
  meetingStartTime: string;
  actionItems: FellowActionItem[];
}

export interface FellowParticipant {
  email: string;
  name: string;
  isAttendee: boolean;
  isExternal: boolean;
}

async function fellowGet(apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${FELLOW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Fellow API ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function pollFellowActionItems(
  apiKey: string,
  since: string | null,
): Promise<FellowActionItemGroup[]> {
  const from = since
    ? since.slice(0, 10)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const data = await fellowGet(apiKey, `/action_items?from_date=${from}&to_date=${to}`);
  const raw = (Array.isArray(data) ? data : [data]) as Array<{
    note_title: string;
    meeting_id: string;
    meeting_start_time: string;
    action_items: Array<{
      text: string;
      updated_at: string;
      assignees: Array<{ name: string; status: string }>;
    }>;
  }>;

  return raw
    .filter(g => Array.isArray(g.action_items) && g.action_items.length > 0)
    .map(g => ({
      noteTitle: g.note_title ?? '',
      meetingId: String(g.meeting_id ?? ''),
      meetingStartTime: g.meeting_start_time ?? '',
      actionItems: g.action_items.map(item => ({
        text: item.text ?? '',
        updatedAt: item.updated_at ?? '',
        assignees: (item.assignees ?? []).map(a => ({
          name: a.name ?? '',
          status: (a.status === 'done' ? 'done' : 'not_done') as 'done' | 'not_done',
        })),
      })),
    }));
}

export async function getFellowMeetingParticipants(
  apiKey: string,
  meetingId: string,
): Promise<FellowParticipant[]> {
  const data = await fellowGet(apiKey, `/meetings/${meetingId}/participants`);
  const raw = (Array.isArray(data) ? data : []) as Array<{
    email: string;
    name: string;
    is_attendee: boolean;
    is_external: boolean;
  }>;
  return raw.map(p => ({
    email: p.email ?? '',
    name: p.name ?? '',
    isAttendee: Boolean(p.is_attendee),
    isExternal: Boolean(p.is_external),
  }));
}
